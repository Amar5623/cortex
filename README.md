<p align="center">
  <img src="https://img.shields.io/badge/CockroachDB-6933FF?style=for-the-badge&logo=cockroach-labs&logoColor=white" alt="CockroachDB"/>
  <img src="https://img.shields.io/badge/AWS_Lambda-FF9900?style=for-the-badge&logo=aws-lambda&logoColor=white" alt="AWS Lambda"/>
  <img src="https://img.shields.io/badge/LangGraph-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white" alt="LangGraph"/>
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/Python_3.14-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"/>
</p>

<h1 align="center">🧠 Cortex</h1>

<h3 align="center">
  Autonomous Multi-Region SRE Incident-Response Swarm<br/>
  <em>Powered by CockroachDB as the Only Durable Agentic Memory</em>
</h3>

<p align="center">
  <a href="https://cortex-sre.vercel.app"><strong>🌐 Live Demo</strong></a> ·
  <a href="YOUR_YOUTUBE_URL_HERE"><strong>🎬 Demo Video</strong></a> ·
  <a href="#architecture"><strong>📐 Architecture</strong></a> ·
  <a href="#getting-started"><strong>🚀 Setup</strong></a>
</p>

---

## 📋 Table of Contents

- [The Problem](#-the-problem)
- [The Solution](#-cortex-the-solution)
- [Architecture](#architecture)
- [CockroachDB Usage](#-cockroachdb-tools--features-used)
- [AWS Services Usage](#-aws-services-used)
- [The Kill-and-Recover Demo](#-the-kill-and-recover-demo-the-signature-moment)
- [Live Demo & Video](#-live-demo--video)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#getting-started)
- [Database Schema](#-database-schema)
- [Feedback on CockroachDB AI Tools](#-feedback-on-cockroachdb-ai-tools)
- [License](#-license)

---

## 🔥 The Problem

Traditional SRE automation breaks in the exact moment it's needed most — **multi-region outages**.

| Failure Mode | What Goes Wrong |
|---|---|
| **In-Memory Lock-in** | Agent state lives in Redis/local memory. Region goes down → all context, locks, and runbook progress **evaporate**. |
| **Split-Brain Conflicts** | Two isolated agent swarms in different regions attempt conflicting remediation commands simultaneously, **worsening the outage**. |
| **No Institutional Memory** | Each incident starts from scratch. The swarm doesn't learn from past postmortems or recognize recurring failure patterns. |

**The core insight:** if your agent's memory dies with its process, it's not really memory — it's a cache. Real agentic memory must survive process death, region failure, and cross-region handoff.

---

## 🧠 Cortex — The Solution

**Cortex** is a **6-agent autonomous SRE swarm** built on [LangGraph](https://github.com/langchain-ai/langgraph) that offloads **100% of its working memory** — incident state, vector embeddings, distributed locks, event traces, and postmortem knowledge — **exclusively to CockroachDB Serverless**.

There is no Redis. No in-memory cache. No LangGraph checkpointer. **CockroachDB is the only durable state.** When a Lambda instance is killed mid-remediation, the swarm doesn't lose its memory — it reads CockroachDB from another region and **picks up exactly where it left off**.

> **Key differentiator:** Cortex deliberately does NOT use a LangGraph checkpointer. The graph's own execution state is disposable — if a Lambda instance dies, the resuming instance in another region re-derives everything by reading `incident_locks` and `incidents` rows fresh from CockroachDB. This is **true agentic memory**, not checkpoint-replay.

---

<h2 id="architecture">📐 Architecture</h2>

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CORTEX ARCHITECTURE                         │
│                                                                     │
│  ┌──────────────┐                         ┌──────────────┐         │
│  │  React SPA   │  ◄── Vercel CDN ──►     │  React SPA   │         │
│  │  (Browser)   │                         │  (Browser)   │         │
│  └──────┬───────┘                         └──────┬───────┘         │
│         │ HTTPS                                   │ HTTPS           │
│  ┌──────▼───────────┐                   ┌────────▼──────────┐      │
│  │  AWS Lambda      │                   │  AWS Lambda       │      │
│  │  us-east-1       │                   │  us-west-2        │      │
│  │  ┌────────────┐  │                   │  ┌────────────┐   │      │
│  │  │ LangGraph  │  │                   │  │ LangGraph  │   │      │
│  │  │ 6-Agent    │  │                   │  │ 6-Agent    │   │      │
│  │  │ Swarm      │  │                   │  │ Swarm      │   │      │
│  │  └─────┬──────┘  │                   │  └─────┬──────┘   │      │
│  └────────┼─────────┘                   └────────┼──────────┘      │
│           │                                       │                 │
│           │      ┌───────────────────────┐       │                 │
│           └──────►  CockroachDB Serverless ◄─────┘                 │
│                  │  (Multi-Region)        │                         │
│                  │                        │                         │
│                  │  • incidents           │                         │
│                  │  • incident_events     │                         │
│                  │  • incident_locks 🔒   │                         │
│                  │  • runbooks (VECTOR)   │                         │
│                  │  • postmortems (VECTOR)│                         │
│                  │  • mcp_audit_log       │                         │
│                  └────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Agent DAG (LangGraph Flow)

```
              ┌─────────┐
              │  START   │
              └────┬─────┘
                   │
              ┌────▼─────┐
              │  ingest   │  ← Normalize alert, create/reuse incident (idempotent on fingerprint)
              └────┬─────┘
                   │
           ┌───────┴────────┐   ← PARALLEL FAN-OUT (LangGraph Pregel superstep)
           │                │
     ┌─────▼──────┐  ┌──────▼──────┐
     │   triage    │  │   runbook   │
     │  (analyze)  │  │ (RAG search)│  ← Vector search over CockroachDB VECTOR(384) columns
     └─────┬──────┘  └──────┬──────┘
           │                │
           └───────┬────────┘   ← FAN-IN / MERGE
                   │
              ┌────▼─────┐
              │   merge   │  ← Sequential status transitions (open → triaging → diagnosing)
              └────┬─────┘
                   │
           ┌───────▼────────┐
           │  remediation   │  ← Acquire distributed lock, LLM-generated fix, fenced writes
           └───────┬────────┘
                   │
           ┌───────▼────────┐
           │   postmortem   │  ← Generate & embed postmortem (becomes future RAG context)
           └───────┬────────┘
                   │
              ┌────▼─────┐
              │   END    │
              └──────────┘
```

### What Each Agent Does

| Agent | Role | CockroachDB Tables Touched |
|---|---|---|
| **`ingest`** | Normalizes incoming alert payload. Idempotent on `fingerprint` — reuses existing incident if one is already open, preventing duplicate incidents across regions. | `incidents` (INSERT), `incident_locks` (INSERT), `incident_events` (INSERT) |
| **`triage`** | Checks if this alert fingerprint has been seen before by querying historical incidents. Read-only for incident state. | `incidents` (SELECT), `incident_events` (INSERT) |
| **`runbook`** | Performs **semantic vector search** (`<->` cosine distance) over `runbooks` and `postmortems` tables using `VECTOR(384)` columns to find relevant prior fixes. | `runbooks` (SELECT + vector search), `postmortems` (SELECT + vector search), `incident_events` (INSERT) |
| **`merge`** | Fan-in node. Combines triage analysis + runbook matches. Executes sequential status transitions (`open` → `triaging` → `diagnosing`) in a single-writer context. | `incidents` (UPDATE via per-role SQL), `mcp_audit_log` (INSERT) |
| **`remediation`** | **The critical agent.** Acquires a CockroachDB distributed lock with 20s lease + 8s heartbeat. Generates LLM remediation via Groq. Fenced status writes (`diagnosing` → `remediating` → `resolved`). If another region holds a live lock, it **stands down** — no double-act. | `incident_locks` (SELECT, UPDATE — lock acquire/steal/release), `incidents` (UPDATE — fenced by lock token), `incident_events` (INSERT), `mcp_audit_log` (INSERT) |
| **`postmortem`** | Generates a postmortem via LLM, **embeds it as a `VECTOR(384)`**, and stores it. This postmortem becomes searchable context for future incidents via `runbook` agent's vector search — **the memory builds on itself**. | `postmortems` (INSERT + vector embedding), `incidents` (UPDATE — `resolved` → `closed`), `incident_events` (INSERT) |

---

## 🪳 CockroachDB Tools & Features Used

### 1. CockroachDB Cloud Managed MCP Server
All agent reads (SELECT) and inserts (INSERT) route through the **CockroachDB Cloud Managed MCP Server** (`cockroachlabs.cloud/mcp`) using the `select_query` and `insert_rows` tools. This gives every agent standardized, auditable database access without embedding raw SQL in application code.

**Tools used:** `select_query`, `insert_rows`

**Fallback:** If the MCP server is unreachable, agents transparently fall back to direct `asyncpg` connections — the same CockroachDB cluster, just a different wire path. This dual-path design ensures the demo never fails due to a transient MCP hiccup.

### 2. Distributed Vector Indexing (`VECTOR(384)`)
Two tables use CockroachDB's native **vector columns and vector indexes** for semantic search:

- **`runbooks`** — Pre-seeded SRE runbook knowledge base. The `runbook` agent queries this with `ORDER BY embedding <-> $query_vector LIMIT 3` to find the most semantically relevant prior fix.
- **`postmortems`** — Written by the `postmortem` agent after each resolved incident. These accumulate over time, meaning **the swarm's institutional memory grows with every incident it handles**.

**Embedding model:** `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions) via `fastembed` (ONNX runtime, runs locally inside Lambda — no external API dependency, no per-token cost).

```sql
-- Vector search query used by the runbook agent
SELECT runbook_id, title, content
FROM runbooks
WHERE service_name = 'checkout'
ORDER BY embedding <-> '[0.0234, -0.0891, ...]'  -- 384-dim query vector
LIMIT 3;
```

### 3. Distributed Lock Lease Engine (`incident_locks`)
CockroachDB's **serializable transactions** power the cross-region distributed mutex:

```sql
-- Atomic lock acquire-or-steal (only succeeds if lock is unheld OR lease expired)
UPDATE incident_locks
SET locked_by_agent=$2, locked_by_instance=$3, locked_by_region=$4,
    lock_token=$5, acquired_at=now(),
    lease_expires_at=now() + interval '20 seconds', released_at=NULL
WHERE incident_id=$1
  AND (locked_by_agent IS NULL OR lease_expires_at < now())
RETURNING lock_token;
```

- **20-second lease** with **8-second heartbeat renewal** running as an `asyncio` background task in the Lambda handler.
- **Fenced writes:** all status mutations during remediation are guarded by `WHERE EXISTS (SELECT 1 FROM incident_locks WHERE lock_token=$token AND released_at IS NULL)` — a zombie process holding a stale token **structurally cannot mutate state**.

### 4. Per-Agent SQL Roles (Least-Privilege RBAC)
Each agent authenticates to CockroachDB as a **separate SQL role** with minimal grants:

| SQL Role | Grants |
|---|---|
| `triage_agent` | `UPDATE incidents`, `INSERT mcp_audit_log` |
| `runbook_agent` | `UPDATE incidents`, `INSERT mcp_audit_log` |
| `remediation_agent` | `SELECT/INSERT/UPDATE incident_locks`, `UPDATE incidents`, `INSERT mcp_audit_log` |
| `postmortem_agent` | `UPDATE incidents`, `INSERT mcp_audit_log` |
| `dashboard_reader` | `SELECT` only on all 6 tables — **zero write access** |

> Only `remediation_agent` can touch `incident_locks` — even a compromised triage/runbook/postmortem agent **structurally cannot forge a lock**.

### 5. Full Audit Trail (`mcp_audit_log`)
Every database operation — MCP tool call, direct SQL fallback, lock acquire, status transition — is logged with agent name, instance ID, incident ID, success/failure, and timestamp. Complete forensic traceability across regions.

---

## ☁️ AWS Services Used

| Service | How It's Used |
|---|---|
| **AWS Lambda** | Hosts the Cortex agent swarm in **two regions** (`us-east-1` primary, `us-west-2` secondary). Same SAM template deployed twice — both point at the same CockroachDB cluster. Python 3.14 runtime, 1024 MB memory, 90s timeout. |
| **AWS SAM (CloudFormation)** | Infrastructure-as-code for the Lambda function, IAM roles, Function URL config, and SSM parameter resolution. Single `template.yaml` deploys identically to both regions. |
| **AWS SSM Parameter Store** | Securely stores all credentials (CockroachDB passwords, Groq API key, admin key) per-region. CloudFormation resolves `SecureString` parameters at deploy time — no secrets in code or environment variable files. |
| **Amazon S3** | Stores raw runbook text content (`runbooks/{slug}.txt`) as the source-of-truth backing for the vector-embedded runbook entries in CockroachDB. |
| **AWS IAM** | Per-function execution roles with cross-region `lambda:PutFunctionConcurrency` and `lambda:DeleteFunctionConcurrency` permissions — enables the kill-and-recover demo from either region's Lambda. |
| **Lambda Function URLs** | Public HTTPS endpoints for each region's agent, with CORS configured for the React frontend. No API Gateway needed — direct Lambda invocation over HTTPS. |

---

## 💥 The Kill-and-Recover Demo (The Signature Moment)

This is the demo that proves CockroachDB-backed agentic memory is real, not theoretical:

```
  Timeline                    us-east-1 (Primary)              us-west-2 (Secondary)
  ──────────────────────────────────────────────────────────────────────────────────────
  T+0s    Alert fires ──────► ingest → triage/runbook (parallel)
  T+3s                        merge → remediation
                              ╔═══════════════════════════════╗
                              ║  🔒 Lock ACQUIRED             ║
                              ║  Status: remediating           ║
                              ║  Heartbeat: every 8s           ║
                              ╚═══════════════════════════════╝
  T+5s    ☠️ REGION KILLED ──► Concurrency set to 0
                              Heartbeat DIES
                              Lock lease ticking down...

  T+25s   Lock lease EXPIRES                                    ╔═══════════════════════╗
                                                                 ║  Same alert re-fired  ║
  T+26s                                                          ║  Reads CockroachDB:   ║
                                                                 ║  • Lock expired ✓     ║
                                                                 ║  • STEAL lock         ║
                                                                 ║  • Resume remediation ║
                                                                 ╚═══════════════════════╝
  T+30s                                                          postmortem written ✅
                                                                 Incident CLOSED
```

**What makes this work:** CockroachDB's multi-region consistency guarantees that `us-west-2` sees the exact lock state left behind by the dead `us-east-1` instance — no split-brain, no data loss, no conflicting remediation.

---

## 🌐 Live Demo & Video

| | Link |
|---|---|
| **Live App** | [https://cortex-sre.vercel.app](https://cortex-sre.vercel.app) |
| **Demo Video** (< 3 min) | [▶️ Watch on YouTube](YOUR_YOUTUBE_URL_HERE) |

> **To try the live demo:** Navigate to the **Console** → Use the **Live Demo Scenarios** panel to trigger a scenario → Watch the transit map animate the agent DAG in real-time as events stream from CockroachDB.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Agent Framework** | [LangGraph](https://github.com/langchain-ai/langgraph) (StateGraph, Pregel superstep parallelism) |
| **LLM** | [Groq](https://groq.com) — `openai/gpt-oss-120b` (fast inference for remediation + postmortem generation) |
| **Embeddings** | `sentence-transformers/all-MiniLM-L6-v2` via [fastembed](https://github.com/qdrant/fastembed) (ONNX, local, 384-dim) |
| **Database** | [CockroachDB Serverless](https://cockroachlabs.com/product/serverless/) — relational + vector + distributed locks |
| **Database Access** | CockroachDB Cloud Managed MCP Server + direct `asyncpg` fallback |
| **Compute** | AWS Lambda (Python 3.14) × 2 regions |
| **IaC** | AWS SAM (CloudFormation) |
| **Secrets** | AWS SSM Parameter Store (SecureString) |
| **Object Storage** | Amazon S3 (runbook source content) |
| **Frontend** | React 19 + Vite 8 + Vanilla CSS |
| **Frontend Hosting** | Vercel |
| **API Layer** | FastAPI + Mangum (Lambda adapter) |

---

## 📁 Project Structure

```
cortex/
├── agents/                    # Core agent swarm (Python)
│   ├── graph.py               # LangGraph DAG — 6 nodes, fan-out/merge, lock flow
│   ├── lambda_handler.py      # FastAPI app + heartbeat loop + admin endpoints
│   ├── db.py                  # Direct SQL: lock acquire/steal/renew/release, fenced writes
│   ├── mcp_client.py          # CockroachDB MCP Server client + direct SQL fallback
│   ├── embeddings.py          # fastembed wrapper (MiniLM-L6-v2, 384-dim, ONNX)
│   ├── llm.py                 # Groq LLM calls (remediation + postmortem generation)
│   ├── s3_client.py           # S3 client for runbook content storage
│   └── reembed_runbooks.py    # Re-embedding script for production vector refresh
│
├── cortex-frontend/           # React SPA (Vite)
│   ├── src/
│   │   ├── App.jsx            # Router + polling orchestration
│   │   ├── components/
│   │   │   ├── HomePage.jsx       # Landing page with animated hero
│   │   │   ├── ConsolePage.jsx    # SRE console layout
│   │   │   ├── LineMap.jsx        # Transit-map DAG visualization (SVG)
│   │   │   ├── EventTicker.jsx    # Real-time regional event feed
│   │   │   ├── IncidentsTable.jsx # Paginated incident log
│   │   │   ├── LockPanel.jsx      # Distributed lock viewer
│   │   │   ├── MissionLog.jsx     # Global audit trail
│   │   │   ├── ScenarioPanel.jsx  # Demo scenario triggers
│   │   │   ├── IncidentReport.jsx # Detailed incident inspector
│   │   │   ├── RegionPills.jsx    # Region health indicators
│   │   │   └── TriggerForm.jsx    # Custom incident payload form
│   │   ├── lib/
│   │   │   ├── api.js             # Backend API client
│   │   │   ├── agentRoster.js     # Agent metadata
│   │   │   ├── lineState.js       # DAG state machine
│   │   │   ├── eventBubbles.js    # Ticker bubble logic
│   │   │   ├── eventPlayback.js   # Event playback engine
│   │   │   └── failover.js        # Kill/restore region API
│   │   ├── index.css              # Design system (CSS variables, dark theme)
│   │   └── main.jsx               # Entry point
│   └── package.json
│
├── db/
│   ├── schema.sql             # Full CockroachDB schema (6 tables, vector indexes)
│   └── grants.sql             # Per-agent SQL roles (least-privilege RBAC)
│
├── seed_runbooks.py           # Seeds runbook knowledge base (S3 + embeddings + CockroachDB)
├── template.yaml              # AWS SAM template (deploys identically to both regions)
├── deploy_aws.sh              # Deployment helper script
├── requirements.txt           # Python dependencies
├── .env.example               # Environment variable template
├── LICENSE                    # MIT License
└── README.md                  # You are here
```

---

<h2 id="getting-started">🚀 Getting Started</h2>

### Prerequisites

- **Python 3.14+**
- **Node.js 18+** & npm
- **AWS CLI** + **AWS SAM CLI** (for Lambda deployment)
- **CockroachDB Serverless** cluster ([free tier](https://cockroachlabs.com/product/serverless/))
- **Groq API key** ([free tier](https://console.groq.com))

### 1. Clone & Configure

```bash
git clone https://github.com/Amar5623/cortex.git
cd cortex
cp .env.example .env
# Fill in your CockroachDB, Groq, and AWS credentials in .env
```

### 2. Set Up CockroachDB

```bash
# Connect to your CockroachDB cluster and run:
cockroach sql --url "postgresql://..." < db/schema.sql
cockroach sql --url "postgresql://..." < db/grants.sql
```

### 3. Seed the Runbook Knowledge Base

```bash
pip install -r requirements.txt
python seed_runbooks.py
```

This uploads 6 hand-authored SRE runbooks to S3, embeds them locally with `fastembed`, and inserts them into CockroachDB with `VECTOR(384)` embeddings.

### 4. Deploy to AWS (Both Regions)

```bash
# Create SSM parameters in both regions (see DEPLOY.md for full list)
# Then:
sam build --use-container
sam deploy --guided --region us-east-1 --stack-name cortex-us-east-1
sam deploy --guided --region us-west-2 --stack-name cortex-us-west-2 --config-env west
```

### 5. Start the Frontend

```bash
cd cortex-frontend
npm install
# Set VITE_LAMBDA_URL_EAST and VITE_LAMBDA_URL_WEST in .env
npm run dev
```

### 6. Run a Demo

Navigate to **http://localhost:5173** → **Open Console** → Select a scenario → Watch the agents work.

---

## 💾 Database Schema

```sql
-- 6 tables, all in CockroachDB Serverless

incidents              -- Incident lifecycle (open → triaging → diagnosing → remediating → resolved → closed)
incident_events        -- Full event trace per incident (agent name, region, timestamp, payload)
incident_locks         -- Distributed mutex with lease expiry (the lock-steal mechanism)
runbooks               -- SRE knowledge base with VECTOR(384) embeddings + vector index
postmortems            -- AI-generated postmortems with VECTOR(384) (grows with each incident)
mcp_audit_log          -- Complete audit trail of every tool call and status transition
```

Key design decisions:
- **`incident_locks` uses `lease_expires_at`** — not a boolean `is_locked` flag. This is what enables time-based lock stealing without requiring coordination between the dead and live regions.
- **`postmortems.embedding` is `VECTOR(384)`** — the postmortem agent embeds its output and stores it, so the next incident's `runbook` agent can find it via semantic search. **The memory compounds over time.**
- **No `DELETE` grants exist** — agents can only INSERT and UPDATE, never delete. The audit log is append-only by design.

---

## 💬 Feedback on CockroachDB AI Tools

### What Worked Well
- **Managed MCP Server** was excellent for standardizing database access across agents. The `select_query` and `insert_rows` tools gave us a clean, uniform interface without embedding raw SQL in every agent function.
- **Native `VECTOR(384)` columns** with `CREATE VECTOR INDEX` — having vector search built into the same database that handles relational queries and distributed locks eliminated an entire class of infrastructure (no separate Pinecone/Weaviate needed). One database, three workloads.
- **Serializable isolation** made the lock-steal logic trivial to reason about — the `UPDATE ... WHERE lease_expires_at < now()` query is race-free by default, no application-level locking needed on top.

### Suggestions
- **MCP Server currently only supports SELECT** — it would be valuable to support `UPDATE` and `DELETE` as first-class tools, since agent workflows commonly need conditional state mutations (e.g., status transitions, lock releases) that currently require a separate direct SQL connection.
- **Vector search via MCP** — being able to pass a vector literal directly to `select_query` with `ORDER BY embedding <-> $vec` worked, but a dedicated `vector_search` tool with built-in distance metrics would make the RAG pattern more discoverable.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built for the <strong>CockroachDB × AWS Hackathon — Build with Agentic Memory</strong><br/>
  by <a href="https://github.com/Amar5623">Amar</a>
</p>
