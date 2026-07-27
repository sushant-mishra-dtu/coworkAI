# Project Context: AI Cowork Core Platform (Chat, Models, MCP, Agents, RAG, Auth, Admin)

## 1. Overview & Architecture

**AI Cowork** is a team-based AI assistant platform where multiple teams share an LLM-powered workspace with document grounding (RAG), multi-provider model selection, MCP server tool integration, and Agent-to-Agent (A2A) communication. Access is team-scoped with JWT authentication, monthly token budgets, and role-based admin controls.

### Tech Stack
* **Backend**: Python, FastAPI, LiteLLM SDK, SQLite (`cowork.db`), ChromaDB (vector store), SentenceTransformers, Pydantic v2, Fernet encryption.
* **Frontend**: React 19 (Vite 8), TailwindCSS v4, Framer Motion, Heroicons, Axios.
* **Ports**:
  * Main Backend: `http://localhost:8000`
  * Frontend Dev Server: `http://localhost:5173`
  * Ollama (local LLMs): `http://localhost:11434`

### System Architecture
```text
                    ┌─────────────────────────────┐
                    │     FastAPI (port 8000)      │
                    │     backend/main.py          │
                    └──────────┬──────────────────┘
                               │
    ┌──────────┬───────────┬───┴───┬────────────┬──────────┬──────────┐
    │          │           │       │            │          │          │
  /auth     /chat       /models  /mcp       /a2a       /rag      /admin
   Auth      Chat+MCP    Provider MCP Server  Agent      Document  Team
   JWT       Tool Loop   Creds    Registry    Registry   Upload    Stats
    │          │           │       │            │          │          │
    └──────────┴───────────┴───┴───┴────────────┴──────────┴──────────┘
                               │
                    ┌──────────┴──────────────────┐
                    │  SQLite (cowork.db)          │
                    │  10 tables: teams, users,    │
                    │  chat_history, usage_logs,   │
                    │  documents, credit_requests, │
                    │  configured_models,          │
                    │  provider_credentials,       │
                    │  mcp_servers,                │
                    │  registered_agents           │
                    └─────────────────────────────┘
```

---

## 2. Database Schema (cowork.db)

Managed by `backend/database.py`. 10 tables:

| Table | Purpose |
|---|---|
| `teams` | Team names, monthly budget/token limits |
| `users` | Email/password/name, FK to team, role (admin/member) |
| `chat_history` | Full Q&A log per user/team, with sources and tokens |
| `usage_logs` | Per-call token usage tracking (user, team, model, tokens) |
| `documents` | Uploaded file metadata (filename, chunk_count, uploader) |
| `credit_requests` | Token budget increase requests (pending/approved/denied) |
| `configured_models` | Team-activated cloud model strings (provider, litellm_model_string, is_active) |
| `provider_credentials` | Encrypted API keys per provider per team (Fernet-encrypted at rest) |
| `mcp_servers` | Registered MCP server endpoints (name, url, transport, encrypted auth) |
| `registered_agents` | Registered A2A agents (name, url, provider type, description) |

---

## 3. Module-by-Module Breakdown

### A. Authentication & Security (`backend/auth/`)

| File | Key Functions/Classes |
|---|---|
| `routes.py` | `POST /auth/signup` — creates user + JWT; `POST /auth/login` — verifies bcrypt hash + JWT; `GET /auth/me` — returns current user |
| `utils.py` | `hash_password()`, `verify_password()` (passlib/bcrypt), `create_token()` (python-jose JWT), `get_current_user()` (FastAPI dependency extracts user from JWT header) |
| `encryption.py` | `encrypt_secret(plain)` / `decrypt_secret(cipher)` — Fernet symmetric encryption for API keys stored in DB. Auto-generates key to `.env` if missing. |
| `models.py` | Pydantic models: `UserCreate`, `UserLogin`, `UserResponse`, `TokenResponse` |

---

### B. Chat System (`backend/chat/`)

| File | Key Functions |
|---|---|
| `routes.py` | `POST /chat/ask` — main chat endpoint; `GET /chat/models` — list Ollama models; `GET /chat/usage` — team monthly token usage |
| `memory.py` | `get_history(user_id)` — retrieves last N Q&A pairs; `save_turn(...)` — logs chat + tokens to DB |

#### `POST /chat/ask` — Full Execution Flow:
```text
1. Budget Check → monthly_used >= token_limit? → HTTP 429
2. RAG Retrieval → if use_documents=true, fetch relevant chunks from ChromaDB
3. History Assembly → last 6 messages from chat_history
4. Prompt Construction → RAG mode (cite documents) or Knowledge mode (general)
5. Model Routing:
   ├── custom_a2a/{id} → Direct JSON-RPC to external agent (bypass LiteLLM)
   ├── ollama/* → litellm.completion(api_base=OLLAMA_URL)
   └── provider/* → load_team_credentials() → litellm.completion()
6. MCP Tool Discovery → get_all_mcp_tools(db) → inject as OpenAI tools
7. Tool Calling Loop (max 5 iterations):
   ├── LLM requests tool call → execute_mcp_tool() on correct server
   ├── Append tool result → re-call LLM
   └── If no more tool calls → break
8. Error Fallback → if tool calling fails, retry WITHOUT tools
9. Save Turn → chat_history + usage_logs
```

---

### C. Models Management (`backend/models/`)

| File | Key Functions |
|---|---|
| `providers.py` | `BASE_PROVIDERS` dict (13 providers), `_build_supported_providers()` — dynamically enriches with `litellm.models_by_provider`, `SUPPORTED_PROVIDERS` — exported constant |
| `routes.py` | CRUD for provider credentials and model activation per team |

**Supported Providers (13):**
* **Cloud LLMs**: OpenAI, Anthropic, Azure OpenAI, Google Gemini, Groq, Mistral, Cohere, Together AI
* **Agent Frameworks**: LangGraph, Pydantic AI, Bedrock Agent, Vertex AI Agent, Azure AI Agent

---

### D. MCP Server Integration (`backend/mcp_client/`)

| File | Key Functions |
|---|---|
| `routes.py` | CRUD for MCP server registrations + tool discovery + manual tool execution |
| `utils.py` | `_build_headers()`, `_parse_sse_response()`, `get_all_mcp_tools()`, `execute_mcp_tool()` |

---

### E. Agent-to-Agent Framework (`backend/a2a/`)

| File | Key Functions |
|---|---|
| `routes.py` | Agent CRUD, invocation, testing, credential management |

---

### F. RAG / Knowledge Base (`backend/rag/`)

| File | Key Functions |
|---|---|
| `indexer.py` | `load_file()` (PDF/TXT extraction), `chunk_text()` (langchain splitter), `embed_and_store()` (SentenceTransformers → ChromaDB) |
| `retriever.py` | `retrieve(query, team_id)` — cosine similarity search against team's ChromaDB collection |
| `routes.py` | `POST /rag/upload`, `GET /rag/documents`, `DELETE /rag/documents/{id}` |

---

### G. Admin Dashboard & Credits (`backend/admin/`, `backend/credit/`)

| File | Key Functions |
|---|---|
| `admin/routes.py` | `GET /admin/stats`, `POST /admin/teams`, `PUT /admin/teams/{id}/limit`, `GET /admin/credit-requests`, `PUT /admin/credit-requests/{id}` |
| `credit/routes.py` | `POST /credit/request`, `GET /credit/requests` |
