// src/components/LineMap.jsx
// Transit Map visualization for Cortex dual-region DAG.
// CockroachDB memory beams connect every station to central hub.
// No hover tooltip on stations — just callout badges for active/done nodes.

import { useMemo } from "react";
import { AGENT_ROSTER } from "../lib/agentRoster";
import { computeLineStates } from "../lib/lineState";

export default function LineMap({
  events = [],
  detail = null,
  activePackets = [],
  locks = [],
  regionHealth = {},
}) {
  const eastStates = useMemo(() => computeLineStates(events, "us-east-1", detail), [events, detail]);
  const westStates = useMemo(() => computeLineStates(events, "us-west-2", detail), [events, detail]);

  const eastAlive = regionHealth["us-east-1"]?.alive !== false;
  const westAlive = regionHealth["us-west-2"]?.alive !== false;

  const activeRegion = useMemo(() => {
    if (detail?.incident?.origin_region) return detail.incident.origin_region;
    if (events && events.length > 0) {
      const lastEvent = events[events.length - 1];
      return lastEvent.agent_region || "us-east-1";
    }
    return "us-east-1";
  }, [detail, events]);

  const activeLock = useMemo(() => {
    return locks && locks.length ? locks[0] : null;
  }, [locks]);

  const isLockStolen = useMemo(() => {
    if (!activeLock) return false;
    return activeLock.stolen || (!eastAlive && activeLock.acquired_by_region === "us-west-2") || (!westAlive && activeLock.acquired_by_region === "us-east-1");
  }, [activeLock, eastAlive, westAlive]);

  const crdbX = 500;
  const crdbY = 230;

  return (
    <div className="cx-line-map-wrapper">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", letterSpacing: "0.08em", color: "var(--text-dim)", textTransform: "uppercase" }}>
            🚈 LIVE TRANSIT DAG MAP // COCKROACHDB MEMORY CORE
          </span>
          <span className="cx-badge cx-badge-closed" style={{ background: "var(--panel-2)", borderColor: "var(--interchange)", color: "var(--interchange)" }}>
            🪳 SHARED SERIALIZABLE MEMORY
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isLockStolen && (
            <div className="cx-badge cx-badge-alert" style={{ animation: "pulseGlow 1s infinite alternate" }}>
              ⚡ LOCK STOLEN → {activeLock?.acquired_by_region?.toUpperCase()}
            </div>
          )}

          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-dim)" }}>
            ACTIVE REGION: <span style={{ color: activeRegion === "us-east-1" ? "var(--line-east)" : "var(--line-west)", fontWeight: 700 }}>{activeRegion.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <svg viewBox="0 0 1000 460" style={{ width: "100%", height: "auto", overflow: "visible" }}>
        <defs>
          <filter id="glow-east" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-west" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-crdb" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* MEMORY BEAMS — East line */}
        <RenderMemoryBeams crdbX={crdbX} crdbY={crdbY} baseY={90} states={eastStates} lineColor="var(--line-east)" />
        {/* MEMORY BEAMS — West line */}
        <RenderMemoryBeams crdbX={crdbX} crdbY={crdbY} baseY={370} states={westStates} lineColor="var(--line-west)" />

        {/* CENTRAL COCKROACHDB HUB */}
        <g transform={`translate(${crdbX}, ${crdbY})`} filter="url(#glow-crdb)">
          <circle r="42" fill="var(--panel)" stroke="var(--interchange)" strokeWidth="2.5" />
          <circle r="32" fill="none" stroke="var(--interchange)" strokeWidth="1.5" strokeDasharray="4,4" className="cx-animated-dash" />
          <text y="-4" textAnchor="middle" fill="var(--interchange)" fontSize="22">🪳</text>
          <text y="14" textAnchor="middle" fill="var(--interchange)" fontFamily="var(--font-display)" fontWeight="800" fontSize="10" letterSpacing="0.05em">
            COCKROACHDB
          </text>
          <text y="26" textAnchor="middle" fill="var(--text-dim)" fontFamily="var(--font-mono)" fontSize="8">
            SERIALIZABLE MEMORY
          </text>
        </g>

        {/* LINE 1: US-EAST-1 */}
        <RenderRegionLine
          region="us-east-1"
          lineColor="var(--line-east)"
          baseY={90}
          states={eastStates}
          alive={eastAlive}
          isPrimary={activeRegion === "us-east-1"}
        />

        {/* LINE 2: US-WEST-2 */}
        <RenderRegionLine
          region="us-west-2"
          lineColor="var(--line-west)"
          baseY={370}
          states={westStates}
          alive={westAlive}
          isPrimary={activeRegion === "us-west-2"}
        />

        {/* FAILOVER LOCK-STEAL REROUTE */}
        {isLockStolen && activeLock && (
          <g>
            <path
              d={activeLock.acquired_by_region === "us-west-2" ? "M 680 90 Q 500 230 680 370" : "M 680 370 Q 500 230 680 90"}
              fill="none"
              stroke="var(--alert)"
              strokeWidth="3"
              strokeDasharray="6 4"
              className="cx-animated-dash"
            />
            <rect x="420" y="218" width="160" height="24" rx="4" fill="var(--alert)" />
            <text x="500" y="234" textAnchor="middle" fill="#FFF" fontFamily="var(--font-mono)" fontWeight="800" fontSize="9">
              ⚡ LOCK STOLEN → {activeLock.acquired_by_region.toUpperCase()}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* Memory beam lines from every station to CockroachDB hub */
function RenderMemoryBeams({ crdbX, crdbY, baseY, states, lineColor }) {
  const coords = [
    { key: "ingest", x: 80 },
    { key: "triage", x: 260, yOff: -40 },
    { key: "runbook", x: 260, yOff: 40 },
    { key: "merge", x: 460 },
    { key: "remediation", x: 680 },
    { key: "postmortem", x: 880 },
  ];

  return (
    <g>
      {coords.map((st) => {
        const state = states.find((s) => s.key === st.key);
        const isActive = state?.status === "active";
        const isDone = state?.status === "done";
        const sx = st.x;
        const sy = baseY + (st.yOff || 0);
        const opacity = isActive ? 0.8 : isDone ? 0.35 : 0.1;
        const strokeW = isActive ? 2 : isDone ? 1 : 0.5;

        return (
          <line key={`beam-${st.key}`}
            x1={sx} y1={sy} x2={crdbX} y2={crdbY}
            stroke={isActive ? lineColor : isDone ? "var(--interchange)" : "var(--pending)"}
            strokeWidth={strokeW}
            strokeDasharray={isActive ? "5 4" : "2 3"}
            opacity={opacity}
            className={isActive ? "cx-animated-dash" : ""}
          />
        );
      })}
    </g>
  );
}

function RenderRegionLine({ region, lineColor, baseY, states, alive, isPrimary }) {
  const stationMap = useMemo(() => Object.fromEntries(states.map((s) => [s.key, s])), [states]);

  const ingestX = 80;
  const triageX = 260, triageY = baseY - 40;
  const runbookX = 260, runbookY = baseY + 40;
  const mergeX = 460;
  const remediationX = 680;
  const postmortemX = 880;

  const segColor = (fromKey, toKey) => {
    if (!alive) return "var(--pending)";
    const fromOk = stationMap[fromKey]?.status === "done" || stationMap[fromKey]?.status === "active";
    const toOk = stationMap[toKey]?.status === "done" || stationMap[toKey]?.status === "active";
    if (fromOk && toOk) return "var(--done)";
    if (fromOk) return lineColor;
    return "var(--pending)";
  };

  const sw = isPrimary ? 4 : 2.5;

  return (
    <g opacity={alive ? (isPrimary ? 1 : 0.6) : 0.3}>
      {/* Region Label */}
      <g transform={`translate(18, ${baseY - 12})`}>
        <rect width="46" height="24" rx="4" fill="var(--panel-2)" stroke={lineColor} strokeWidth={isPrimary ? "2" : "1"} />
        <text x="23" y="16" textAnchor="middle" fill={lineColor} fontFamily="var(--font-mono)" fontWeight="800" fontSize="10">
          {region === "us-east-1" ? "EAST" : "WEST"}
        </text>
      </g>

      {/* Track segments */}
      <path d={`M ${ingestX} ${baseY} L 160 ${baseY}`} stroke={segColor("ingest", "triage")} strokeWidth={sw} fill="none" />
      <path d={`M 160 ${baseY} C 200 ${baseY}, 220 ${triageY}, ${triageX} ${triageY}`} stroke={segColor("ingest", "triage")} strokeWidth={sw} fill="none" />
      <path d={`M 160 ${baseY} C 200 ${baseY}, 220 ${runbookY}, ${runbookX} ${runbookY}`} stroke={segColor("ingest", "runbook")} strokeWidth={sw} fill="none" />
      <path d={`M ${triageX} ${triageY} C 380 ${triageY}, 400 ${baseY}, ${mergeX} ${baseY}`} stroke={segColor("triage", "merge")} strokeWidth={sw} fill="none" />
      <path d={`M ${runbookX} ${runbookY} C 380 ${runbookY}, 400 ${baseY}, ${mergeX} ${baseY}`} stroke={segColor("runbook", "merge")} strokeWidth={sw} fill="none" />
      <line x1={mergeX} y1={baseY} x2={remediationX} y2={baseY} stroke={segColor("merge", "remediation")} strokeWidth={sw} />
      <line x1={remediationX} y1={baseY} x2={postmortemX} y2={baseY} stroke={segColor("remediation", "postmortem")} strokeWidth={sw} />

      {/* Stations */}
      {AGENT_ROSTER.map((agent) => {
        const state = stationMap[agent.key] || {};
        let cx = ingestX, cy = baseY;
        if (agent.key === "triage") { cx = triageX; cy = triageY; }
        else if (agent.key === "runbook") { cx = runbookX; cy = runbookY; }
        else if (agent.key === "merge") { cx = mergeX; }
        else if (agent.key === "remediation") { cx = remediationX; }
        else if (agent.key === "postmortem") { cx = postmortemX; }

        const isActive = state.status === "active";
        const isDone = state.status === "done";

        return (
          <g key={agent.key} transform={`translate(${cx}, ${cy})`}>
            {isActive && (
              <circle r="22" fill="none" stroke={lineColor} strokeWidth="2"
                filter={region === "us-east-1" ? "url(#glow-east)" : "url(#glow-west)"}>
                <animate attributeName="r" values="16;26;16" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle r="13"
              fill={isDone ? "var(--done)" : isActive ? lineColor : "var(--panel-2)"}
              stroke={isActive ? "#FFF" : isDone ? "var(--done)" : lineColor}
              strokeWidth={isActive ? "3" : "2"}
            />
            <text y="4" textAnchor="middle"
              fill={isDone || isActive ? "var(--ink)" : lineColor}
              fontFamily="var(--font-mono)" fontWeight="800" fontSize="11">
              {agent.index + 1}
            </text>
            <text x="0" y={agent.key === "triage" ? -20 : agent.key === "runbook" ? 28 : -20}
              textAnchor="middle" fill="var(--text)"
              fontFamily="var(--font-display)" fontWeight="700" fontSize="11">
              {agent.role}
            </text>

            {/* CRDB operation badge — only when active */}
            {isActive && (
              <g transform={`translate(0, ${agent.key === "triage" ? -36 : agent.key === "runbook" ? 42 : -36})`}>
                <rect x="-56" y="-7" width="112" height="14" rx="3"
                  fill="var(--panel-2)" stroke="var(--interchange)" strokeWidth="0.8" />
                <text x="0" y="4" textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize="7.5" fontWeight="600" fill="var(--interchange)">
                  🪳 {agent.crdbOp.split(":")[0]}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
