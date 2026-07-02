"""
Seed script for usage_logs table.
Generates ~300 synthetic calls spread over the last 30 days to populate charts.
"""
import sqlite3
import os
import random
import json
from datetime import datetime, timedelta, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "configurator.db")

def seed_usage():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    config_name = "hello_llm"
    endpoints = ["/chat", "/vision"]
    
    # Primary and fallback models
    models = {
        "/chat": ["gemini/gemini-2.5-flash", "ollama/llama3.1"],
        "/vision": ["gemini/gemini-2.5-flash", "ollama/llama3.1"] # Assuming these support vision for mock purposes
    }
    
    agents = ["agent_a", "agent_b", None]
    
    error_types = ["rate_limit", "timeout", "auth_error", "provider_error"]
    
    now = datetime.now(timezone.utc)
    
    calls = []
    
    for _ in range(300):
        # Spread over last 30 days
        days_ago = random.uniform(0, 30)
        created_at = (now - timedelta(days=days_ago)).isoformat()
        
        endpoint = random.choice(endpoints)
        agent_id = random.choice(agents)
        
        # 10% failure rate
        success = random.random() > 0.10
        
        if success:
            # 80% primary, 20% fallback
            is_fallback = random.random() > 0.80
            model_used = models[endpoint][1] if is_fallback else models[endpoint][0]
            
            prompt_tokens = random.randint(10, 500)
            completion_tokens = random.randint(10, 1000)
            total_tokens = prompt_tokens + completion_tokens
            
            latency_ms = random.uniform(500, 5000)
            if "ollama" in model_used:
                latency_ms += random.uniform(5000, 15000) # Local is slower
                
            cost = 0.0
            if "gemini" in model_used:
                # Rough synthetic cost
                cost = (prompt_tokens * 0.00000015) + (completion_tokens * 0.0000006)
                
            finish_reason = random.choice(["stop", "stop", "stop", "length"])
            error_type = None
            error_msg = None
            
            raw_metadata = {
                "litellm_call_id": f"mock-{random.randint(1000,9999)}",
                "litellm_model_name": model_used,
                "provider": "gemini" if "gemini" in model_used else "ollama",
                "provider_response_ms": latency_ms - 100
            }
        else:
            is_fallback = False
            model_used = None
            prompt_tokens = 0
            completion_tokens = 0
            total_tokens = 0
            latency_ms = random.uniform(100, 1000)
            cost = 0.0
            finish_reason = None
            error_type = random.choice(error_types)
            error_msg = f"Mock {error_type} exception"
            raw_metadata = None

        calls.append((
            config_name, agent_id, endpoint, model_used, prompt_tokens,
            completion_tokens, total_tokens, latency_ms, success, error_msg,
            created_at, cost, finish_reason, error_type, is_fallback,
            json.dumps(raw_metadata) if raw_metadata else None
        ))
    
    # Sort by created_at ascending
    calls.sort(key=lambda x: x[10])
    
    cursor.executemany('''
        INSERT INTO usage_logs 
        (config_full_name, agent_id, endpoint, model_used, prompt_tokens, 
         completion_tokens, total_tokens, latency_ms, success, error, created_at,
         cost, finish_reason, error_type, fallback_triggered, raw_metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', calls)
    
    conn.commit()
    print(f"Inserted {len(calls)} synthetic logs.")
    conn.close()

if __name__ == "__main__":
    seed_usage()
