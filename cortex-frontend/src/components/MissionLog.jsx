// src/components/MissionLog.jsx
import { useState } from "react";

const EVENT_ICON = {
  incident_created: "🆕",
  incident_retriggered: "🔁",
  triage_started: "🔎",
  triage_completed: "🩺",
  runbook_started: "📡",
  runbook_completed: "📚",
  context_merged: "🔀",
  remediation_lock_attempt: "🔐",
  remediation_stood_down: "🧍",
  remediation_applied: "🛠️",
  remediation_completed: "✅",
  postmortem_started: "📝",
  postmortem_written: "📓",
};

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return "—";
  }
}

const PAGE_SIZE = 8;

export default function MissionLog({ events = [], auditLog = [], loading }) {
  const [page, setPage] = useState(0);

  const rows = [];

  for (const e of events) {
    rows.push({
      ts: e.created_at,
      key: `ev-${e.event_id}`,
      node: (
        <>
          {EVENT_ICON[e.event_type] || "•"} <b style={{ color: "var(--text)" }}>{e.agent_name}</b> · {e.event_type}{" "}
          <span style={{ color: e.agent_region?.includes("west") ? "var(--line-west)" : "var(--line-east)", fontWeight: 600 }}>
            {e.agent_region === "us-east-1" ? "EAST" : "WEST"}
          </span>{" "}
          · incident {String(e.incident_id).slice(0, 8)}…
        </>
      ),
    });
  }

  for (const a of auditLog) {
    rows.push({
      ts: a.occurred_at,
      key: `au-${a.audit_id}`,
      node: (
        <>
          🔐 <b style={{ color: "var(--text)" }}>{a.agent_name}</b> → {a.mcp_tool_name}{" "}
          <span style={{ color: a.success ? "#2ED573" : "var(--alert)", fontWeight: 700 }}>
            {a.success ? "OK" : "FAILED"}
          </span>{" "}
          · incident {String(a.incident_id || "").slice(0, 8)}…
        </>
      ),
    });
  }

  rows.sort((x, y) => new Date(y.ts) - new Date(x.ts));

  const totalPages = Math.ceil(rows.length / PAGE_SIZE) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const displayRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="cx-panel">
      <div className="cx-panel-header">
        <div className="cx-panel-title">
          <span>📡 CockroachDB Global Audit & Handoff Log</span>
        </div>
        <span className="cx-panel-subtitle">{rows.length} RECORDED ENTRIES</span>
      </div>

      <div
        className="cx-panel-2"
        style={{
          minHeight: 180,
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {displayRows.length === 0 ? (
          <div style={{ padding: "16px 0", color: "var(--text-dim)" }}>
            {loading ? "Polling global mission log..." : "No events recorded yet."}
          </div>
        ) : (
          displayRows.map((r) => (
            <div key={r.key} style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border-light)", paddingBottom: 4 }}>
              <span style={{ color: "var(--text-dim)", minWidth: 70 }}>{fmtTime(r.ts)}</span>
              <span>{r.node}</span>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
          <button
            className="cx-btn cx-btn-sm cx-btn-ghost"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{ opacity: safePage === 0 ? 0.4 : 1 }}
          >
            ◀ Prev
          </button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-dim)" }}>
            Page {safePage + 1} of {totalPages}
          </span>
          <button
            className="cx-btn cx-btn-sm cx-btn-ghost"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            style={{ opacity: safePage >= totalPages - 1 ? 0.4 : 1 }}
          >
            Next ▶
          </button>
        </div>
      )}
    </div>
  );
}
