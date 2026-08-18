// src/components/HomePage.jsx
// Interactive, animated Landing Infographic explaining Cortex's autonomous SRE swarm.

import { useState, useEffect } from "react";
import { AGENT_ROSTER } from "../lib/agentRoster";

export default function HomePage({ onNavigateConsole }) {
  const [activeStep, setActiveStep] = useState(0);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!simulating) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => {
        if (prev >= 5) {
          setSimulating(false);
          return 5;
        }
        return prev + 1;
      });
    }, 1400);
    return () => clearInterval(interval);
  }, [simulating]);

  const startSimulation = () => {
    setActiveStep(0);
    setSimulating(true);
  };

  const currentAgent = AGENT_ROSTER[activeStep];

  // Station positions laid out horizontally: Ingest -> fork(Triage/Runbook) -> Merge -> Remediation -> Postmortem
  // Triage goes UP, Runbook goes DOWN, rest stay on center line
  const stationPositions = [
    { x: 100, y: 150 },  // 0: Ingest
    { x: 300, y: 70 },   // 1: Triage (above)
    { x: 300, y: 230 },  // 2: Runbook (below)
    { x: 500, y: 150 },  // 3: Merge
    { x: 700, y: 150 },  // 4: Remediation
    { x: 900, y: 150 },  // 5: Postmortem
  ];

  const crdbHub = { x: 500, y: 340 };

  return (
    <div className="cx-home-page" style={{ paddingBottom: 80 }}>
      {/* HERO SECTION */}
      <section className="cx-hero-section" style={{ position: "relative", overflow: "hidden" }}>
        <div className="cx-brand-badge" style={{ display: "inline-block", marginBottom: 16 }}>
          COCKROACHDB × AWS HACKATHON // BUILD WITH AGENTIC MEMORY
        </div>
        <h1 className="cx-hero-title">
          Six agents, one shared memory, two regions that never go down together.
        </h1>
        <p className="cx-hero-subtitle">
          Cortex is an autonomous SRE incident-response swarm. Multiple specialized agents work a live production
          incident together, reading and writing to <strong>one shared CockroachDB serializable memory layer</strong>,
          deployed as stateless AWS Lambda functions across <code>us-east-1</code> and <code>us-west-2</code>.
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 40, flexWrap: "wrap" }}>
          <button className="cx-btn cx-btn-primary" onClick={onNavigateConsole} style={{ padding: "14px 28px", fontSize: "16px" }}>
            Launch Operations Console →
          </button>
          <button
            className="cx-btn cx-btn-secondary"
            onClick={startSimulation}
            disabled={simulating}
            style={{ padding: "14px 28px", fontSize: "16px" }}
          >
            {simulating ? "⚡ Simulating DAG Execution..." : "▶ Simulate Interactive DAG Flow"}
          </button>
        </div>

        {/* INTERACTIVE TRANSIT MAP SIMULATOR */}
        <div className="cx-panel" style={{ maxWidth: 1040, margin: "0 auto", padding: 24, border: "1px solid var(--border-light)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--interchange)", fontWeight: 700 }}>
              🚈 INTERACTIVE SWARM SIMULATOR — STEP {activeStep + 1} OF 6: {currentAgent.role.toUpperCase()}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {AGENT_ROSTER.map((agent, idx) => (
                <button
                  key={agent.key}
                  onClick={() => { setSimulating(false); setActiveStep(idx); }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    backgroundColor: activeStep === idx ? "var(--line-east)" : activeStep > idx ? "rgba(234,230,217,0.15)" : "var(--panel-2)",
                    color: activeStep === idx ? "#FFF" : activeStep > idx ? "var(--done)" : "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: activeStep === idx ? 700 : 400,
                  }}
                >
                  {idx + 1}. {agent.role}
                </button>
              ))}
            </div>
          </div>

          {/* SVG Diagram — clean horizontal layout */}
          <svg viewBox="0 0 1000 400" style={{ width: "100%", height: "auto", overflow: "visible" }}>
            {/* DAG TRACK PATHS */}
            {/* Ingest → fork point */}
            <path d={`M ${stationPositions[0].x} ${stationPositions[0].y} L 200 150`}
              stroke={activeStep >= 1 ? "var(--done)" : "var(--pending)"} strokeWidth="3" fill="none" />
            {/* Fork → Triage (up) */}
            <path d={`M 200 150 C 240 150, 260 ${stationPositions[1].y}, ${stationPositions[1].x} ${stationPositions[1].y}`}
              stroke={activeStep >= 1 ? "var(--done)" : "var(--pending)"} strokeWidth="3" fill="none" />
            {/* Fork → Runbook (down) */}
            <path d={`M 200 150 C 240 150, 260 ${stationPositions[2].y}, ${stationPositions[2].x} ${stationPositions[2].y}`}
              stroke={activeStep >= 2 ? "var(--done)" : "var(--pending)"} strokeWidth="3" fill="none" />
            {/* Triage → Merge */}
            <path d={`M ${stationPositions[1].x} ${stationPositions[1].y} C 400 ${stationPositions[1].y}, 440 150, ${stationPositions[3].x} ${stationPositions[3].y}`}
              stroke={activeStep >= 3 ? "var(--done)" : "var(--pending)"} strokeWidth="3" fill="none" />
            {/* Runbook → Merge */}
            <path d={`M ${stationPositions[2].x} ${stationPositions[2].y} C 400 ${stationPositions[2].y}, 440 150, ${stationPositions[3].x} ${stationPositions[3].y}`}
              stroke={activeStep >= 3 ? "var(--done)" : "var(--pending)"} strokeWidth="3" fill="none" />
            {/* Merge → Remediation */}
            <line x1={stationPositions[3].x} y1={stationPositions[3].y} x2={stationPositions[4].x} y2={stationPositions[4].y}
              stroke={activeStep >= 4 ? "var(--done)" : "var(--pending)"} strokeWidth="3" />
            {/* Remediation → Postmortem */}
            <line x1={stationPositions[4].x} y1={stationPositions[4].y} x2={stationPositions[5].x} y2={stationPositions[5].y}
              stroke={activeStep >= 5 ? "var(--done)" : "var(--pending)"} strokeWidth="3" />

            {/* COCKROACHDB MEMORY BEAMS */}
            {stationPositions.map((pos, idx) => {
              const isActive = activeStep === idx;
              const isPast = activeStep > idx;
              return (
                <line key={`beam-${idx}`}
                  x1={pos.x} y1={pos.y}
                  x2={crdbHub.x} y2={crdbHub.y}
                  stroke={isActive ? "var(--line-east)" : isPast ? "var(--interchange)" : "var(--pending)"}
                  strokeWidth={isActive ? 2.5 : isPast ? 1 : 0.5}
                  strokeDasharray={isActive ? "6 4" : "3 3"}
                  opacity={isActive ? 0.9 : isPast ? 0.4 : 0.12}
                  className={isActive ? "cx-animated-dash" : ""}
                />
              );
            })}

            {/* CockroachDB Central Hub */}
            <g transform={`translate(${crdbHub.x}, ${crdbHub.y})`}>
              <circle r="32" fill="var(--panel)" stroke="var(--interchange)" strokeWidth="2" />
              <circle r="24" fill="none" stroke="var(--interchange)" strokeWidth="1" strokeDasharray="3,3" className="cx-animated-dash" />
              <text y="-4" textAnchor="middle" fill="var(--interchange)" fontSize="18">🪳</text>
              <text y="12" textAnchor="middle" fill="var(--interchange)" fontFamily="var(--font-display)" fontWeight="800" fontSize="9">
                COCKROACHDB
              </text>
            </g>

            {/* Station Nodes */}
            {AGENT_ROSTER.map((agent, idx) => {
              const pos = stationPositions[idx];
              const isActive = activeStep === idx;
              const isPast = activeStep > idx;
              return (
                <g key={agent.key} transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => { setSimulating(false); setActiveStep(idx); }}
                  style={{ cursor: "pointer" }}
                >
                  {isActive && (
                    <circle r="24" fill="none" stroke="var(--line-east)" strokeWidth="2">
                      <animate attributeName="r" values="16;28;16" dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    r="16"
                    fill={isPast ? "var(--done)" : isActive ? "var(--line-east)" : "var(--panel-2)"}
                    stroke={isActive ? "#FFF" : isPast ? "var(--done)" : "var(--line-east)"}
                    strokeWidth={isActive ? "3" : "2"}
                  />
                  <text y="5" textAnchor="middle"
                    fill={isPast || isActive ? "var(--ink)" : "var(--line-east)"}
                    fontFamily="var(--font-mono)" fontWeight="800" fontSize="12">
                    {idx + 1}
                  </text>
                  <text x="0" y={idx === 1 ? -26 : idx === 2 ? 34 : -26}
                    textAnchor="middle" fill="var(--text)"
                    fontFamily="var(--font-display)" fontWeight="700" fontSize="13">
                    {agent.role}
                  </text>
                  {(idx === 1 || idx === 2) && (
                    <text x="0" y={idx === 1 ? -40 : 48}
                      textAnchor="middle" fill="var(--text-dim)"
                      fontFamily="var(--font-mono)" fontSize="9">
                      PARALLEL {agent.readOnly ? "READ-ONLY" : ""}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* ACTIVE STEP COCKROACHDB OPERATION CARD */}
          <div className="cx-panel-2" style={{ marginTop: 20, borderLeft: "4px solid var(--interchange)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--interchange)", fontWeight: 700, marginBottom: 4 }}>
                🪳 COCKROACHDB MEMORY ACTION — STEP {activeStep + 1} ({currentAgent.role}):
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 700, color: "var(--text)" }}>
                {currentAgent.crdbOp}
              </div>
              <p style={{ margin: "4px 0 0 0", color: "var(--text-dim)", fontSize: "13px" }}>
                {currentAgent.crdbDetails}
              </p>
            </div>
            <span className="cx-badge cx-badge-closed">{currentAgent.tag}</span>
          </div>
        </div>
      </section>

      {/* SECTION 1: THE ON-CALL PROBLEM */}
      <section className="cx-section">
        <h2 className="cx-section-title">The On-Call Problem: Cascading Alert Storms</h2>
        <p className="cx-section-desc">
          Modern cloud infrastructure generates hundreds of alerts during a Sev1 outage. Human on-call engineers spend
          precious minutes manually correlating logs, searching Notion for runbooks, and racing against TTL locks.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="cx-panel-2">
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--alert)", marginBottom: 8, fontWeight: 700 }}>
              ❌ TRADITIONAL ON-CALL (MANUAL TRACE)
            </div>
            <pre style={{ color: "var(--text-dim)", lineHeight: 1.6 }}>
{`[03:14:02] ALERT Sev1: PaymentGatewayTimeout
[03:14:15] PagerDuty Paging primary on-call...
[03:17:40] Engineer logs in, opens Datadog...
[03:22:10] Searching Notion for payment runbook...
[03:29:00] Manual AWS CLI restart executed.`}
            </pre>
          </div>

          <div className="cx-panel-2" style={{ borderLeft: "3px solid var(--line-west)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--line-west)", marginBottom: 8, fontWeight: 700 }}>
              ⚡ CORTEX AUTONOMOUS DAG (3.2 SECONDS)
            </div>
            <pre style={{ color: "var(--text)", lineHeight: 1.6 }}>
{`[03:14:02.100] Ingest dedupes fingerprint in CockroachDB
[03:14:02.350] Parallel Triage & Vector Runbook search
[03:14:02.680] Pregel Merge joins agent payloads
[03:14:02.900] Remediation acquires CRDB lease lock
[03:14:03.200] Auto-mitigation applied & postmortem saved`}
            </pre>
          </div>
        </div>
      </section>

      {/* SECTION 2: 6 AGENTS & COCKROACHDB MEMORY ROLE */}
      <section className="cx-section">
        <h2 className="cx-section-title">The 6 Swarm Agents & CockroachDB Memory Operations</h2>
        <p className="cx-section-desc">
          Every node in the LangGraph DAG is backed by stateless AWS Lambda compute with CockroachDB as its sole persistent memory core.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {AGENT_ROSTER.map((agent) => (
            <div key={agent.key} className="cx-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, color: "var(--text)" }}>
                  {agent.index + 1}. {agent.role} ({agent.name})
                </span>
                <span className="cx-badge cx-badge-closed">{agent.tag}</span>
              </div>
              <p style={{ color: "var(--text-dim)", fontSize: "14px", lineHeight: 1.5, marginBottom: 12 }}>
                {agent.shortDesc}
              </p>
              <div className="cx-panel-2" style={{ borderLeft: "3px solid var(--interchange)", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
                <div style={{ color: "var(--interchange)", fontWeight: 700, marginBottom: 2 }}>🪳 MEMORY LAYER ACCESS</div>
                <div style={{ color: "var(--text)" }}>{agent.crdbOp}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: WHY COCKROACHDB MATTERS */}
      <section className="cx-section">
        <div className="cx-panel" style={{ borderLeft: "4px solid var(--interchange)", padding: 32 }}>
          <h2 className="cx-section-title" style={{ color: "var(--interchange)" }}>
            🪳 Why CockroachDB, Not Redis or Mongo?
          </h2>
          <p className="cx-section-desc" style={{ marginBottom: 16 }}>
            Single-writer key-value stores (Redis, Mem0, Pinecone) degrade without real conflict resolution when multiple
            agents concurrently write about the same entity. Cortex's core mechanic — multiple agents concurrently claiming,
            updating, and embedding the same incident record — requires <strong>CockroachDB serializable transactions</strong> and
            governed access models:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="cx-panel-2">
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--interchange)", fontWeight: 700, marginBottom: 6 }}>
                1. GOVERNED MANAGED MCP SERVER
              </div>
              <p style={{ color: "var(--text-dim)", fontSize: "13px", margin: 0 }}>
                Service account <code>cortex-mcp-agent</code> exposes safe <code>select_query</code> and <code>insert_rows</code> tools over
                streamable HTTP for read-only agents and postmortem indexing.
              </p>
            </div>
            <div className="cx-panel-2">
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--line-west)", fontWeight: 700, marginBottom: 6 }}>
                2. DIRECT ASYNCPG LEASE LOCKS
              </div>
              <p style={{ color: "var(--text-dim)", fontSize: "13px", margin: 0 }}>
                Least-privilege regional SQL roles handle high-concurrency <code>UPDATE ... WHERE</code> statements to acquire,
                renew, and steal 20-second incident locks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: CROSS-REGION FAILOVER DEMO MOMENT */}
      <section className="cx-section">
        <h2 className="cx-section-title">The Demo Moment: Cross-Region Lock Steal</h2>
        <p className="cx-section-desc">
          Mid-incident, with the remediation agent actively working in <code>us-east-1</code>, kill the active Lambda region.
          A second instance in <code>us-west-2</code> resumes the exact same incident from CockroachDB — zero duplication, zero state loss.
        </p>

        <div className="cx-panel-2" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ color: "var(--line-east)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              US-EAST-1 (KILLED MID-REMEDIATION)
            </div>
            <div style={{ fontSize: "20px", color: "var(--alert)" }}>⚡ LOCK STOLEN ➔</div>
            <div style={{ color: "var(--line-west)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              US-WEST-2 (RESUMES FROM CRDB MEMORY)
            </div>
          </div>
          <p style={{ color: "var(--text-dim)", fontSize: "14px", maxWidth: 640, margin: "0 auto 20px auto" }}>
            Test this live in the Operations Console with the one-click <strong>Cross-Region Kill & Steal Demo</strong> button.
          </p>
          <button className="cx-btn cx-btn-primary" onClick={onNavigateConsole} style={{ padding: "12px 24px" }}>
            Open Operations Console to Test Failover →
          </button>
        </div>
      </section>

      {/* STACK STRIP — no duplicate CTA button */}
      <section style={{ textAlign: "center", padding: "24px 0 0 0" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-sub)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          LANGGRAPH 1.2 · AWS LAMBDA · COCKROACHDB VECTOR INDEX · GROQ GPT-OSS-120B · FASTEMBED ONNX
        </div>
      </section>
    </div>
  );
}
