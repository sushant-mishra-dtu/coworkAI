# 🚀 AI Cowork — Dual Architecture Workspace

**AI Cowork** is an enterprise-grade AI collaboration platform split into two decoupled micro-services sharing a unified React frontend:

1. **Part 1: Core AI Cowork Platform** (Port 8000) — Team workspace with RAG document grounding, Model Context Protocol (MCP) tools, Agent-to-Agent (A2A) orchestration, user authentication, and team credit budgets.
2. **Part 2: LLM Configurator & Analytics Engine** (Port 8001) — Enterprise LLM gateway manager supporting fallback chains, PII/profanity guardrails, sliding-window rate limits, and real-time per-config usage dashboards.

---

## 📚 Quick Links & Documentation

| Document | Description | Link |
|---|---|---|
| 📄 **Core Platform Documentation** | Full architecture, RAG, MCP tool loop, A2A agents, Auth & DB schema | [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md) |
| 📄 **LLM Configurator Documentation** | Gateway architecture, fallback chains, guardrails & analytics dashboard | [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md) |
| 📑 **LLM Configurator PDF Spec** | PDF documentation artifact | [`llm-configurator/DOCUMENTATION.pdf`](llm-configurator/DOCUMENTATION.pdf) |
| 📦 **Core Platform Requirements** | Python dependencies for Part 1 (Port 8000) | [`requirements.txt`](requirements.txt) |
| 📦 **Configurator Requirements** | Python dependencies for Part 2 (Port 8001) | [`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt) |

---

## 📊 System Architecture

```mermaid
flowchart TD
    subgraph FE["🖥️ Vite + React Frontend — localhost:5173"]
        UI["Chat · Upload · Models<br/>MCP · Agents · Admin"]
        CFG["LLM Configurator UI<br/>Catalogue · Builder · Dashboard"]
    end

    subgraph P1["🧩 PART 1 — AI Cowork Core Platform :8000"]
        CORE["backend/main.py<br/>FastAPI"]
        R1["/auth · /chat · /models"]
        R2["/mcp · /a2a · /rag · /admin"]
    end

    subgraph P2["⚙️ PART 2 — LLM Configurator & Analytics :8001"]
        GW["llm-configurator/backend/main.py<br/>FastAPI"]
        R3["/configs · /catalog · /guardrails"]
        R4["/llm/config/* · /usage"]
    end

    subgraph DATA["💾 Persistence"]
        DB1[("cowork.db<br/>SQLite · 10 tables")]
        VEC[("ChromaDB<br/>Vector Store")]
        DB2[("configurator.db<br/>SQLite + configs/*.json")]
    end

    subgraph EXT["🌐 External Services"]
        LLM["LLM Providers<br/>OpenAI · Anthropic<br/>Gemini · Groq · Ollama"]
        MCP["MCP Servers"]
        A2A["A2A Agents"]
        GUARD["Guardrail<br/>Endpoints"]
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

## 🧭 Project Differentiation

The two services are fully decoupled — separate entry points, separate dependency files, separate databases.

| | 🧩 **Part 1 — Core Platform** | ⚙️ **Part 2 — LLM Configurator** |
|---|---|---|
| **Port** | `8000` | `8001` |
| **Entry Point** | [`backend/main.py`](backend/main.py) | [`llm-configurator/backend/main.py`](llm-configurator/backend/main.py) |
| **Capabilities** | Chat workspace & history<br>Document RAG (ChromaDB + vector store)<br>MCP server protocol integration<br>Agent-to-Agent (A2A) framework<br>Team credit budgets & Auth (JWT) | Dynamic multi-model fallback chains<br>Enterprise restrictions (TPM/RPM/TPR)<br>Guardrails (PII masking, profanity)<br>Per-config analytics dashboard<br>Global LLM credentials catalogue |
| **Requirements** | [`requirements.txt`](requirements.txt) | [`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt) |
| **Documentation** | [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md) | [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md) |
| **Database** | `./data/cowork.db` (SQLite) + ChromaDB | `./llm-configurator/backend/configurator.db` (SQLite) + `configs/*.json` |

---

## 🔄 Core Platform — `POST /chat/ask` Execution Flow

```mermaid
flowchart TD
    A["Client request<br/>POST /chat/ask"] --> B{"Budget<br/>exceeded?"}
    B -->|"Yes"| B1["HTTP 429<br/>Budget exceeded"]
    B -->|"No"| C{"use_documents?"}
    C -->|"Yes"| C1["RAG retrieval<br/>ChromaDB similarity search"]
    C -->|"No"| D["History assembly<br/>last 6 messages"]
    C1 --> D
    D --> E["Prompt construction<br/>RAG mode or Knowledge mode"]
    E --> F{"Model routing"}

    F -->|"custom_a2a"| G1["Direct JSON-RPC<br/>to external agent"]
    F -->|"ollama/*"| G2["litellm.completion<br/>api_base = OLLAMA_URL"]
    F -->|"provider/*"| G3["load_team_credentials<br/>litellm.completion"]

    G2 --> H["MCP tool discovery<br/>inject as OpenAI tools"]
    G3 --> H
    H --> I{"Tool loop<br/>max 5 rounds"}
    I -->|"Tool requested"| I1["execute_mcp_tool<br/>append result · re-call LLM"]
    I1 --> I
    I -->|"Tool call failed"| I2["Fallback: retry without tools"]
    I -->|"No more tool calls"| J["Save turn<br/>chat_history + usage_logs"]
    I2 --> J
    G1 --> J
    J --> K["Response to client"]

    classDef err fill:#4a1d1d,stroke:#f87171,stroke-width:2px,color:#fff
    classDef ok fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class B1,I2 err
    class J,K ok
```

---

## 🛡️ LLM Configurator — Request Pipeline

```mermaid
flowchart TD
    A["Client request<br/>POST /config_name/chat"] --> B["pre_flight_check"]
    B --> C{"Config<br/>active?"}
    C -->|"No"| X1["404 / 403"]
    C -->|"Yes"| D{"Operation<br/>supported?"}
    D -->|"No"| X2["400 Unsupported operation"]
    D -->|"Yes"| E{"RPM<br/>limit OK?"}
    E -->|"Exceeded"| X3["429 Rate limited"]
    E -->|"OK"| F{"TPR<br/>cap OK?"}
    F -->|"Exceeded"| X4["Token cap exceeded"]
    F -->|"OK"| G["PII masking<br/>regex redaction"]
    G --> H{"Pre-stage<br/>guardrails"}
    H -->|"Blocked"| X5["Blocked · reason returned"]
    H -->|"Passed"| I["litellm.Router<br/>acompletion with fallback chain"]
    I --> J{"Primary<br/>model OK?"}
    J -->|"Fails"| J1["Failover to priority 2, 3, …"]
    J -->|"OK"| K["Provider response"]
    J1 --> K
    K --> L{"Post-stage<br/>guardrails"}
    L -->|"Blocked"| X6["Blocked · reason returned"]
    L -->|"Passed"| M["log_usage → configurator.db"]
    M --> N["JSONResponse to client"]

    classDef err fill:#4a1d1d,stroke:#f87171,stroke-width:2px,color:#fff
    classDef ok fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class X1,X2,X3,X4,X5,X6 err
    class M,N ok
```

---

## 📋 Requirements & Dependencies

The project maintains **two independent `requirements.txt` files** tailored to each service:

### 1️⃣ Core Platform Requirements (`requirements.txt`)
Contains full dependencies for RAG (ChromaDB, SentenceTransformers), Auth (Bcrypt, JWT), and LiteLLM integration.

* 🔗 **File Link**: [`requirements.txt`](requirements.txt)
* **Key Dependencies**: `fastapi`, `uvicorn`, `litellm`, `chromadb`, `sentence-transformers`, `pypdf`, `python-jose`, `passlib`, `cryptography`

### 2️⃣ LLM Configurator Requirements (`llm-configurator/backend/requirements.txt`)
Contains lightweight dependencies focused strictly on high-performance LLM routing, validation, and execution analytics.

* 🔗 **File Link**: [`llm-configurator/backend/requirements.txt`](llm-configurator/backend/requirements.txt)
* **Key Dependencies**: `fastapi`, `uvicorn`, `pydantic`, `litellm`, `python-dotenv`, `cryptography`

---

## 🛠️ Quick Start Guide

```mermaid
flowchart LR
    S1["1️⃣ Core Platform<br/>pip install -r requirements.txt<br/>uvicorn backend.main:app --port 8000"]
    S2["2️⃣ LLM Configurator<br/>cd llm-configurator/backend<br/>uvicorn main:app --port 8001"]
    S3["3️⃣ Frontend<br/>cd frontend<br/>npm install then npm run dev"]
    S4["✅ Open<br/>http://localhost:5173"]

    S1 --> S2 --> S3 --> S4

    classDef step fill:#1e3a5f,stroke:#4a9eff,stroke-width:2px,color:#fff
    classDef done fill:#1f3d2b,stroke:#4ade80,stroke-width:2px,color:#fff
    class S1,S2,S3 step
    class S4 done
```

### Step 1: Install & Run Part 1 (Core Platform Backend)

```bash
# From workspace root
pip install -r requirements.txt

# Start Core Platform Backend (Port 8000)
python -m uvicorn backend.main:app --port 8000 --reload
```

### Step 2: Install & Run Part 2 (LLM Configurator Backend)

```bash
# Navigate to configurator backend
cd llm-configurator/backend

# Install configurator dependencies
pip install -r requirements.txt

# Start Configurator Backend (Port 8001)
python -m uvicorn main:app --port 8001 --reload
```

*(Optional: Seed synthetic usage data for the Configurator Dashboard — run from `llm-configurator/backend`)*
```bash
python scripts/seed_usage.py
```

### Step 3: Run the React Frontend

```bash
# From workspace root
cd frontend

# Install node dependencies
npm install

# Start Vite dev server (Port 5173)
npm run dev
```

---

## 📖 Comprehensive Documentation Links

* 📄 **Core Platform Documentation**: [`DOCUMENTATION_CORE.md`](DOCUMENTATION_CORE.md)
* 📄 **LLM Configurator Documentation**: [`llm-configurator/DOCUMENTATION.md`](llm-configurator/DOCUMENTATION.md)
* 📑 **LLM Configurator PDF Document**: [`llm-configurator/DOCUMENTATION.pdf`](llm-configurator/DOCUMENTATION.pdf)
