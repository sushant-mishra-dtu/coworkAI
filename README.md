# AI Cowork

AI Cowork is a team AI workspace. It runs as two independent backends behind a single React frontend:

1. **Core platform** (port 8000). The team workspace itself: chat, document grounding with RAG, MCP tool calling, agent-to-agent calls, login, and per-team token budgets.
2. **LLM Configurator** (port 8001). A gateway for managing LLM access: fallback chains across models, guardrails, rate limits, and per-config usage analytics.

The two services share nothing but the frontend. They have separate entry points, separate dependency files, and separate databases, so either one can run without the other.

---

## Quick links

| Document | What it covers | Link |
|---|---|---|
| Core platform documentation | Architecture, RAG, MCP tool loop, A2A agents, auth, DB schema | [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md) |
| LLM Configurator documentation | Gateway architecture, fallback chains, guardrails, analytics | [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md) |
| LLM Configurator PDF | Same documentation as a PDF | [`llm-configurator/DOCUMENTATION.pdf`](llm-configurator/DOCUMENTATION.pdf) |
| Core platform requirements | Python dependencies for port 8000 | [`requirements.txt`](requirements.txt) |
| Configurator requirements | Python dependencies for port 8001 | [`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt) |

---

## System architecture

```mermaid
flowchart TD
    subgraph FE["Vite + React frontend, localhost:5173"]
        UI["Chat, Upload, Models,<br/>MCP, Agents, Admin"]
        CFG["LLM Configurator UI<br/>Catalogue, Builder, Dashboard"]
    end

    subgraph P1["Part 1: core platform, port 8000"]
        CORE["backend/main.py<br/>FastAPI"]
        R1["/auth, /chat, /models"]
        R2["/mcp, /a2a, /rag, /admin"]
    end

    subgraph P2["Part 2: LLM Configurator, port 8001"]
        GW["llm-configurator/backend/main.py<br/>FastAPI"]
        R3["/configs, /catalog, /guardrails"]
        R4["/llm/config/*, /usage"]
    end

    subgraph DATA["Storage"]
        DB1[("cowork.db<br/>SQLite, 10 tables")]
        VEC[("ChromaDB<br/>vector store")]
        DB2[("configurator.db<br/>SQLite + configs/*.json")]
    end

    subgraph EXT["External services"]
        LLM["LLM providers<br/>OpenAI, Anthropic,<br/>Gemini, Groq, Ollama"]
        MCP["MCP servers"]
        A2A["A2A agents"]
        GUARD["Guardrail<br/>endpoints"]
    end

    UI -->|"REST :8000"| CORE
    CFG -->|"REST :8001"| GW

    CORE --> R1
    CORE --> R2
    GW --> R3
    GW --> R4

    R1 --> DB1
    R2 --> DB1
    R2 --> VEC
    R3 --> DB2
    R4 --> DB2

    R1 -->|"LiteLLM SDK"| LLM
    R2 --> MCP
    R2 --> A2A
    R4 -->|"litellm.Router"| LLM
    R4 --> GUARD

    classDef part1 fill:#1e3a5f,stroke:#4a9eff,stroke-width:2px,color:#fff
    classDef part2 fill:#3d2c52,stroke:#b07ee8,stroke-width:2px,color:#fff
    classDef store fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class CORE,R1,R2 part1
    class GW,R3,R4 part2
    class DB1,VEC,DB2 store
```

---

## What each service does

| | Part 1: core platform | Part 2: LLM Configurator |
|---|---|---|
| Port | `8000` | `8001` |
| Entry point | [`backend/main.py`](backend/main.py) | [`llm-configurator/backend/main.py`](llm-configurator/backend/main.py) |
| Handles | Chat workspace and history<br>Document RAG (ChromaDB + vector store)<br>MCP server integration<br>Agent-to-agent (A2A) calls<br>Team credit budgets and JWT auth | Multi-model fallback chains<br>TPM/RPM/TPR restrictions<br>Guardrails (PII masking, profanity)<br>Per-config analytics dashboard<br>Global LLM credentials catalogue |
| Requirements | [`requirements.txt`](requirements.txt) | [`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt) |
| Documentation | [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md) | [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md) |
| Database | `./data/cowork.db` (SQLite) plus ChromaDB | `./llm-configurator/backend/configurator.db` (SQLite) plus `configs/*.json` |

---

## How a chat request is handled

`POST /chat/ask` on the core platform:

```mermaid
flowchart TD
    A["Client request<br/>POST /chat/ask"] --> B{"Budget<br/>exceeded?"}
    B -->|"Yes"| B1["HTTP 429<br/>budget exceeded"]
    B -->|"No"| C{"use_documents?"}
    C -->|"Yes"| C1["RAG retrieval<br/>ChromaDB similarity search"]
    C -->|"No"| D["Assemble history<br/>last 6 messages"]
    C1 --> D
    D --> E["Build prompt<br/>RAG mode or knowledge mode"]
    E --> F{"Model routing"}

    F -->|"custom_a2a"| G1["Direct JSON-RPC<br/>to external agent"]
    F -->|"ollama/*"| G2["litellm.completion<br/>api_base = OLLAMA_URL"]
    F -->|"provider/*"| G3["load_team_credentials<br/>litellm.completion"]

    G2 --> H["Discover MCP tools,<br/>inject as OpenAI tools"]
    G3 --> H
    H --> I{"Tool loop<br/>max 5 rounds"}
    I -->|"Tool requested"| I1["execute_mcp_tool,<br/>append result, re-call LLM"]
    I1 --> I
    I -->|"Tool call failed"| I2["Retry without tools"]
    I -->|"No more tool calls"| J["Save turn to<br/>chat_history + usage_logs"]
    I2 --> J
    G1 --> J
    J --> K["Response to client"]

    classDef err fill:#4a1d1d,stroke:#f87171,stroke-width:2px,color:#fff
    classDef ok fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class B1,I2 err
    class J,K ok
```

## How a Configurator request is handled

`POST /{config_name}/chat` on the gateway:

```mermaid
flowchart TD
    A["Client request<br/>POST /config_name/chat"] --> B["pre_flight_check"]
    B --> C{"Config<br/>active?"}
    C -->|"No"| X1["404 / 403"]
    C -->|"Yes"| D{"Operation<br/>supported?"}
    D -->|"No"| X2["400 unsupported operation"]
    D -->|"Yes"| E{"RPM<br/>limit OK?"}
    E -->|"Exceeded"| X3["429 rate limited"]
    E -->|"OK"| F{"TPR<br/>cap OK?"}
    F -->|"Exceeded"| X4["Token cap exceeded"]
    F -->|"OK"| G["PII masking<br/>regex redaction"]
    G --> H{"Pre-stage<br/>guardrails"}
    H -->|"Blocked"| X5["Blocked, reason returned"]
    H -->|"Passed"| I["litellm.Router<br/>acompletion with fallback chain"]
    I --> J{"Primary<br/>model OK?"}
    J -->|"Fails"| J1["Fail over to priority 2, 3, ..."]
    J -->|"OK"| K["Provider response"]
    J1 --> K
    K --> L{"Post-stage<br/>guardrails"}
    L -->|"Blocked"| X6["Blocked, reason returned"]
    L -->|"Passed"| M["log_usage to configurator.db"]
    M --> N["JSON response to client"]

    classDef err fill:#4a1d1d,stroke:#f87171,stroke-width:2px,color:#fff
    classDef ok fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class X1,X2,X3,X4,X5,X6 err
    class M,N ok
```

---

## Requirements

There are two separate `requirements.txt` files, one per service. Install whichever service you are running.

**Core platform** ([`requirements.txt`](requirements.txt)) covers RAG (ChromaDB, SentenceTransformers), auth (bcrypt, JWT), and LiteLLM:

`fastapi`, `uvicorn`, `litellm`, `chromadb`, `sentence-transformers`, `pypdf`, `python-jose`, `passlib`, `cryptography`

**LLM Configurator** ([`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt)) is lighter, covering routing, validation, and usage logging only:

`fastapi`, `uvicorn`, `pydantic`, `litellm`, `python-dotenv`, `cryptography`

---

## Running it

```mermaid
flowchart LR
    S1["1. Core platform<br/>pip install -r requirements.txt<br/>uvicorn backend.main:app --port 8000"]
    S2["2. LLM Configurator<br/>cd llm-configurator/backend<br/>uvicorn main:app --port 8001"]
    S3["3. Frontend<br/>cd frontend<br/>npm install, npm run dev"]
    S4["Open<br/>http://localhost:5173"]

    S1 --> S2 --> S3 --> S4

    classDef step fill:#1e3a5f,stroke:#4a9eff,stroke-width:2px,color:#fff
    classDef done fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class S1,S2,S3 step
    class S4 done
```

### 1. Core platform backend

```bash
# from the workspace root
pip install -r requirements.txt
python -m uvicorn backend.main:app --port 8000 --reload
```

### 2. LLM Configurator backend

```bash
cd llm-configurator/backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8001 --reload
```

To populate the Configurator dashboard with synthetic usage data, run this from `llm-configurator/backend`:

```bash
python scripts/seed_usage.py
```

### 3. Frontend

```bash
# from the workspace root
cd frontend
npm install
npm run dev
```

The frontend serves on port 5173 and talks to both backends.

---

## Comprehensive Documentation Links

* **Core Platform Documentation**: [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md)
* **LLM Configurator Documentation**: [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md)
* **LLM Configurator PDF Document**: [`llm-configurator/DOCUMENTATION.pdf`](llm-configurator/DOCUMENTATION.pdf)
