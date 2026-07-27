import re
import time
import httpx
from typing import Dict, Any, Tuple, Optional, List
from db import log_guardrail_event
from ssrf import validate_url
from encryption import decrypt_secret

# In-memory circuit breaker: (config_full_name, guardrail_name) -> consecutive_failures
circuit_breaker_failures: Dict[Tuple[str, str], int] = {}
# (config_full_name, guardrail_name) -> timestamp_when_cooldown_ends
circuit_breaker_cooldown: Dict[Tuple[str, str], float] = {}

CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_BREAKER_COOLDOWN_SEC = 60

# ---------------------------------------------------------------------------
# Verdict parser for openai_chat_safety adapter
# ---------------------------------------------------------------------------

# Matches lines like "User Safety: safe", "Response Safety: unsafe", etc.
_VERDICT_RE = re.compile(
    r"(?:user|response|assistant|overall|content)\s*safety\s*:\s*(safe|unsafe)",
    re.IGNORECASE,
)

# Matches lines like "Prompt harm: harmful" / "Prompt harm: unharmful"
_HARM_RE = re.compile(
    r"prompt\s*harm\s*:\s*(harmful|unharmful)",
    re.IGNORECASE,
)

# Matches a bare leading safe/unsafe token (first non-whitespace word)
_BARE_VERDICT_RE = re.compile(
    r"^\s*(safe|unsafe)\b",
    re.IGNORECASE,
)

# Matches "Safety Categories: cat1, cat2, ..."
_CATEGORIES_RE = re.compile(
    r"safety\s*categories\s*:\s*(.+)",
    re.IGNORECASE,
)


def parse_safety_verdict(text: str) -> Dict[str, Any]:
    """Parse the text output from a safety model into a structured verdict.
    
    Returns:
        {
            "parsed": bool,       # True if a known verdict pattern was found
            "allowed": bool,      # True if safe, False if unsafe/harmful
            "categories": list,   # safety categories if present
            "reason": str,        # raw verdict text
        }
    """
    result = {
        "parsed": False,
        "allowed": True,
        "categories": [],
        "reason": text.strip(),
    }
    
    # Try structured verdict lines first (highest confidence)
    verdicts = _VERDICT_RE.findall(text)
    if verdicts:
        result["parsed"] = True
        # If ANY verdict is "unsafe", the overall result is unsafe
        for v in verdicts:
            if v.lower() == "unsafe":
                result["allowed"] = False
                break
    
    # Try prompt harm pattern
    if not result["parsed"]:
        harm_matches = _HARM_RE.findall(text)
        if harm_matches:
            result["parsed"] = True
            for h in harm_matches:
                if h.lower() == "harmful":
                    result["allowed"] = False
                    break
    
    # Try bare leading token
    if not result["parsed"]:
        bare = _BARE_VERDICT_RE.match(text)
        if bare:
            result["parsed"] = True
            if bare.group(1).lower() == "unsafe":
                result["allowed"] = False
    
    # Extract categories if present
    cat_match = _CATEGORIES_RE.search(text)
    if cat_match:
        raw_cats = cat_match.group(1).strip()
        result["categories"] = [c.strip() for c in raw_cats.split(",") if c.strip()]
    
    return result


async def run_guardrails(stage: str, config_full_name: str, text: str, config: Any) -> Dict[str, Any]:
    """
    Runs custom guardrails for the given stage (pre or post).
    Returns a dict with:
    - blocked: bool
    - reason: str (if blocked)
    - modified_text: str (if redacted)
    """
    result = {
        "blocked": False,
        "reason": None,
        "modified_text": None
    }
    
    if not hasattr(config, "guardrails") or not hasattr(config.guardrails, "custom"):
        return result
        
    custom_guardrails = config.guardrails.custom
    if not custom_guardrails:
        return result
        
    # Filter enabled and matching stage
    active_guardrails = [
        cg for cg in custom_guardrails
        if cg.enabled and cg.stage in (stage, "both")
    ]
    
    if not active_guardrails:
        return result
        
    # Sort by priority ascending
    active_guardrails.sort(key=lambda cg: cg.priority)
    
    current_text = text
    
    for cg in active_guardrails:
        cb_key = (config_full_name, cg.name)
        
        # Check circuit breaker
        if circuit_breaker_cooldown.get(cb_key, 0) > time.time():
            decision = f"error (circuit_breaker_open, {cg.fail_mode})"
            log_guardrail_event(config_full_name, cg.name, stage, decision, 0.0)
            if cg.fail_mode == "fail_closed":
                result["blocked"] = True
                result["reason"] = f"Guardrail {cg.name} is failing (circuit breaker). Fail mode: closed."
                return result
            continue
            
        try:
            validate_url(cg.url, allow_local=cg.allow_local)
        except ValueError as e:
            decision = f"error (ssrf_blocked, {cg.fail_mode})"
            log_guardrail_event(config_full_name, cg.name, stage, decision, 0.0)
            if cg.fail_mode == "fail_closed":
                result["blocked"] = True
                result["reason"] = f"Guardrail {cg.name} failed SSRF validation."
                return result
            continue

        token = cg.secret_ciphertext
        if token and token.startswith("gAAAAA"):
            token = decrypt_secret(token)

        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        # ---- Build adapter-specific payload ----
        if cg.adapter_type == "openai_chat_safety":
            messages = []
            if cg.system_prompt:
                messages.append({"role": "system", "content": cg.system_prompt})
            messages.append({"role": "user", "content": current_text})
            payload = {
                "model": cg.model or "",
                "messages": messages,
                "max_tokens": 400,
                "stream": False
            }
        elif cg.adapter_type == "huggingface_inference":
            payload = {"inputs": current_text}
        else:
            # http_generic
            payload = {
                "text": current_text,
                "role": "input" if stage == "pre" else "output",
                "context": {
                    "operation": stage,
                    "config_id": config_full_name
                }
            }

        start_time = time.time()
        success = False
        decision = "error"
        data = None

        try:
            async with httpx.AsyncClient(timeout=cg.timeout_ms / 1000.0) as client:
                resp = await client.post(cg.url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                success = True
                # reset circuit breaker
                circuit_breaker_failures[cb_key] = 0
                if cb_key in circuit_breaker_cooldown:
                    del circuit_breaker_cooldown[cb_key]
        except httpx.TimeoutException:
            decision = f"timeout ({cg.fail_mode})"
            circuit_breaker_failures[cb_key] = circuit_breaker_failures.get(cb_key, 0) + 1
        except Exception as e:
            decision = f"error ({cg.fail_mode})"
            circuit_breaker_failures[cb_key] = circuit_breaker_failures.get(cb_key, 0) + 1
            
        latency_ms = (time.time() - start_time) * 1000

        # apply circuit breaker threshold
        if not success and circuit_breaker_failures.get(cb_key, 0) >= CIRCUIT_BREAKER_THRESHOLD:
            circuit_breaker_cooldown[cb_key] = time.time() + CIRCUIT_BREAKER_COOLDOWN_SEC

        if not success:
            log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
            if cg.fail_mode == "fail_closed":
                result["blocked"] = True
                result["reason"] = f"Guardrail {cg.name} failed. Fail mode: closed."
                return result
            continue

        # ---- Normalize response per adapter ----
        allowed = True
        modified_text = None
        reason = None
        
        if cg.adapter_type == "http_generic":
            allowed = data.get("allowed", True)
            modified_text = data.get("modified_text")
            reason = data.get("reason")

        elif cg.adapter_type == "huggingface_inference":
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                for item in data[0]:
                    if "toxic" in item.get("label", "").lower() and item.get("score", 0) > 0.5:
                        allowed = False
                        reason = f"HuggingFace label: {item.get('label')}"
                        break

        elif cg.adapter_type == "openai_chat_safety":
            # Extract the model's text reply
            try:
                content_text = data["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError):
                # Malformed response — treat as error, apply fail_mode
                decision = f"error (unparseable_response, {cg.fail_mode})"
                log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
                circuit_breaker_failures[cb_key] = circuit_breaker_failures.get(cb_key, 0) + 1
                if circuit_breaker_failures.get(cb_key, 0) >= CIRCUIT_BREAKER_THRESHOLD:
                    circuit_breaker_cooldown[cb_key] = time.time() + CIRCUIT_BREAKER_COOLDOWN_SEC
                if cg.fail_mode == "fail_closed":
                    result["blocked"] = True
                    result["reason"] = f"Guardrail {cg.name}: unparseable response. Fail mode: closed."
                    return result
                continue

            verdict = parse_safety_verdict(content_text)
            
            if not verdict["parsed"]:
                # Unknown format — NEVER silently allow. Treat as error.
                decision = f"error (unknown_verdict_format, {cg.fail_mode})"
                log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
                circuit_breaker_failures[cb_key] = circuit_breaker_failures.get(cb_key, 0) + 1
                if circuit_breaker_failures.get(cb_key, 0) >= CIRCUIT_BREAKER_THRESHOLD:
                    circuit_breaker_cooldown[cb_key] = time.time() + CIRCUIT_BREAKER_COOLDOWN_SEC
                if cg.fail_mode == "fail_closed":
                    result["blocked"] = True
                    result["reason"] = f"Guardrail {cg.name}: could not parse verdict. Raw: {content_text[:200]}"
                    return result
                continue
            
            allowed = verdict["allowed"]
            reason = verdict["reason"]
        
        if not allowed:
            if cg.action == "block":
                decision = "blocked"
                log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
                result["blocked"] = True
                result["reason"] = reason or f"Blocked by guardrail {cg.name}"
                return result
            elif cg.action == "warn" or cg.action == "log_only":
                decision = "warned" if cg.action == "warn" else "allowed"
                # For warn/log_only, we just log it and continue
                log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
            elif cg.action == "redact":
                decision = "redacted"
                log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
                if modified_text:
                    current_text = modified_text
                    result["modified_text"] = current_text
        else:
            decision = "allowed"
            if cg.action == "redact" and modified_text:
                decision = "redacted"
                current_text = modified_text
                result["modified_text"] = current_text
            log_guardrail_event(config_full_name, cg.name, stage, decision, latency_ms)
            
    return result
