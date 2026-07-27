# 🚀 AI Cowork — Dual Architecture Workspace

**AI Cowork** is an enterprise-grade AI collaboration platform split into two decoupled micro-services sharing a unified React frontend:

1. **Part 1: Core AI Cowork Platform** (Port 8000) — Team workspace with RAG document grounding, Model Context Protocol (MCP) tools, Agent-to-Agent (A2A) orchestration, user authentication, and team credit budgets.
2. **Part 2: LLM Configurator & Analytics Engine** (Port 8001) — Enterprise LLM gateway manager supporting fallback chains, PII/profanity guardrails, sliding-window rate limits, and real-time per-config usage dashboards.

---

## 📊 System Architecture & Project Differentiation

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Vite + React Frontend                            │
│                            http://localhost:5173                            │
└──────────────────────┬───────────────────────────────┬──────────────────────┘
                       │                               │
        API Calls (port 8000)                   API Calls (port 8001)
                       │                               │
                       ▼                               ▼
┌───────────────────────────────────────────┐ ┌───────────────────────────────────────────┐
│     PART 1: AI COWORK CORE PLATFORM       │ │   PART 2: LLM CONFIGURATOR & ANALYTICS    │
│            (backend/main.py)              │ │     (llm-configurator/backend/main.py)    │
├───────────────────────────────────────────┤ ├───────────────────────────────────────────┤
│ • Chat Workspace & History                │ │ • Dynamic Multi-Model Fallback Chains     │
│ • Document RAG (ChromaDB + Vector Store)  │ │ • Enterprise Restrictions (TPM/RPM/TPR)   │
│ • MCP Server Protocol Integration         │ │ • Guardrails (PII Masking, Profanity)     │
│ • Agent-to-Agent (A2A) Framework          │ │ • Per-Config Analytics Dashboard          │
│ • Team Credit Budgets & Auth (JWT)        │ │ • Global LLM Credentials Catalogue        │
├───────────────────────────────────────────┤ ├───────────────────────────────────────────┤
│ 📂 Requirements:                          │ │ 📂 Requirements:                          │
│    ./requirements.txt                     │ │    ./llm-configurator/backend/            │
│                                           │ │    requirements.txt                       │
├───────────────────────────────────────────┤ ├───────────────────────────────────────────┤
│ 💾 Database:                              │ │ 💾 Database:                              │
│    ./data/cowork.db (SQLite)              │ │    ./llm-configurator/backend/            │
│                                           │ │    configurator.db (SQLite)               │
└───────────────────────────────────────────┘ └───────────────────────────────────────────┘
```

---

## 📋 Requirements & Dependencies

The project maintains **two independent `requirements.txt` files** tailored to each service:

### 1️⃣ Core Platform Requirements (`requirements.txt`)
Contains full dependencies for RAG (ChromaDB, SentenceTransformers), Auth (Bcrypt, JWT), and LiteLLM integration.

* **File Location**: [`./requirements.txt`](file:///c:/Users/IT/Documents/ai-cowork/requirements.txt)
* **Key Dependencies**: `fastapi`, `uvicorn`, `litellm`, `chromadb`, `sentence-transformers`, `pypdf`, `python-jose`, `passlib`, `cryptography`

### 2️⃣ LLM Configurator Requirements (`llm-configurator/backend/requirements.txt`)
Contains lightweight dependencies focused strictly on high-performance LLM routing, validation, and execution analytics.

* **File Location**: [`./llm-configurator/backend/requirements.txt`](file:///c:/Users/IT/Documents/ai-cowork/llm-configurator/backend/requirements.txt)
* **Key Dependencies**: `fastapi`, `uvicorn`, `pydantic`, `litellm`, `python-dotenv`, `cryptography`

---

## 🛠️ Quick Start Guide

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

*(Optional: Seed synthetic usage data for the Configurator Dashboard)*
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

## 📖 Deep-Dive Documentation

For detailed architectural walkthroughs, API specs, database schemas, and data flow diagrams, refer to the generated context documents:

* 📄 **Part 1 Core Platform Context**: [`project_context_core.md`](file:///C:/Users/IT/.gemini/antigravity/brain/3d15d1d8-09d6-4d88-8239-a5dac60f0b35/project_context_core.md)
* 📄 **Part 2 LLM Configurator Context**: Refer to the LLM Configurator section in project transcripts or specs.
