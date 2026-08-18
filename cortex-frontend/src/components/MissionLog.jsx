// src/components/MissionLog.jsx
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

export default function MissionLog({ events = [], auditLog = [], loading }) {
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
          maxHeight: 220,
          overflowY: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: "16px 0", color: "var(--text-dim)" }}>
            {loading ? "Polling global mission log..." : "No events recorded yet."}
          </div>
        ) : (
          rows.slice(0, 60).map((r) => (
            <div key={r.key} style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border-light)", paddingBottom: 4 }}>
              <span style={{ color: "var(--text-dim)", minWidth: 70 }}>{fmtTime(r.ts)}</span>
              <span>{r.node}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
