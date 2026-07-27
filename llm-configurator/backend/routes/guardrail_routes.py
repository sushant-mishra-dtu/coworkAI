import time
import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from schemas import CustomGuardrail
from ssrf import validate_url
from encryption import decrypt_secret
from guardrail_runner import parse_safety_verdict

router = APIRouter(prefix="/guardrails", tags=["guardrails"])

class GuardrailTestRequest(BaseModel):
    text: str
    role: str = "input"
    guardrail: CustomGuardrail

@router.post("/test")
async def test_guardrail(request: GuardrailTestRequest):
    guardrail = request.guardrail
    try:
        validate_url(guardrail.url, allow_local=guardrail.allow_local)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"SSRF Validation failed: {str(e)}")

    # Resolve token
    token = guardrail.secret_ciphertext
    if token and token.startswith("gAAAAA"):
        token = decrypt_secret(token)

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # ---- Build adapter-specific payload ----
    if guardrail.adapter_type == "openai_chat_safety":
        messages = []
        if guardrail.system_prompt:
            messages.append({"role": "system", "content": guardrail.system_prompt})
        messages.append({"role": "user", "content": request.text})
        payload = {
            "model": guardrail.model or "",
            "messages": messages,
            "max_tokens": 400,
            "stream": False
        }
    elif guardrail.adapter_type == "huggingface_inference":
        payload = {"inputs": request.text}
    else:
        # http_generic — canonical format
        payload = {
            "text": request.text,
            "role": request.role,
            "context": {
                "operation": "test",
                "config_id": "test_config"
            }
        }

    start_time = time.time()
    try:
        async with httpx.AsyncClient(timeout=guardrail.timeout_ms / 1000.0) as client:
            resp = await client.post(guardrail.url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Guardrail endpoint timed out.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Guardrail request failed: {str(e)}")

    latency_ms = (time.time() - start_time) * 1000

    # ---- Normalize response per adapter ----
    normalized = {
        "allowed": True,
        "score": None,
        "categories": [],
        "modified_text": None,
        "reason": None
    }

    raw_response = data

    if guardrail.adapter_type == "http_generic":
        # Assume it already returns the canonical format
        normalized.update(data)

    elif guardrail.adapter_type == "huggingface_inference":
        # HF text classification usually returns [[{"label": "...", "score": ...}]]
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
            normalized["categories"] = data[0]
            for item in data[0]:
                if "toxic" in item.get("label", "").lower() and item.get("score", 0) > 0.5:
                    normalized["allowed"] = False
                    normalized["reason"] = f"HuggingFace label: {item.get('label')}"
                    normalized["score"] = item.get("score")
                    break

    elif guardrail.adapter_type == "openai_chat_safety":
        # Extract content text from chat completion response
        try:
            content_text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return {
                "normalized_response": {
                    "allowed": None,
                    "reason": "Could not extract choices[0].message.content from response",
                    "categories": [],
                    "parse_error": True,
                },
                "latency_ms": latency_ms,
                "raw_response": raw_response
            }

        verdict = parse_safety_verdict(content_text)
        
        if not verdict["parsed"]:
            return {
                "normalized_response": {
                    "allowed": None,
                    "reason": "Could not parse a known safety verdict from model output",
                    "categories": [],
                    "parse_error": True,
                    "raw_model_text": content_text,
                },
                "latency_ms": latency_ms,
                "raw_response": raw_response
            }
        
        normalized["allowed"] = verdict["allowed"]
        normalized["reason"] = verdict["reason"]
        normalized["categories"] = verdict["categories"]

    return {
        "normalized_response": normalized,
        "latency_ms": latency_ms,
        "raw_response": raw_response
    }
