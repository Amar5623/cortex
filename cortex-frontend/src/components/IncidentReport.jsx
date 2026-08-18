// src/components/IncidentReport.jsx
import { memo } from "react";
import { detectFailover } from "../lib/failover";

const EVENT_ICONS = {
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

function IncidentReport({ detail }) {
  const { incident, events = [], lock, postmortem } = detail || {};

  if (!incident && !postmortem) {
    return (
      <div className="cx-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="cx-panel-header">
          <div className="cx-panel-title">📓 Incident Report & Postmortem</div>
        </div>
        <div style={{ padding: "16px 0", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "13px", flex: 1 }}>
          No incident selected — select or trigger an incident to view live postmortem synthesis.
        </div>
      </div>
    );
  }

  const { failedOver, from, to } = detectFailover(events, lock);

  return (
    <div className="cx-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="cx-panel-header">
        <div className="cx-panel-title">
          <span>📓 Postmortem Synthesis</span>
          {incident && (
            <span className={`cx-badge ${incident.status === 'closed' ? 'cx-badge-closed' : 'cx-badge-open'}`} style={{ marginLeft: 8 }}>
              {incident.status}
            </span>
          )}
        </div>
        {postmortem && (
          <span style={{ color: "#2ED573", fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 600 }}>
            ✅ Final Report Ready
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {failedOver && (
          <div className="cx-panel-2" style={{ borderColor: "var(--alert)", background: "rgba(255, 59, 92, 0.08)" }}>
            <span style={{ color: "var(--alert)", fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: "12px" }}>
              🔁 CROSS-REGION FAILOVER DETECTED:
            </span>{" "}
            <span style={{ fontSize: "13px", color: "var(--text)" }}>
              Remediation lock transferred from <strong>{from}</strong> to <strong>{to}</strong> via CockroachDB shared memory.
            </span>
          </div>
        )}

        {!postmortem ? (
          <div className="cx-panel-2" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="cx-status-dot online" style={{ animation: "pulseGlow 1.2s infinite" }} />
              <strong style={{ fontFamily: "var(--font-display)", fontSize: "15px" }}>
                Incident in progress ({incident?.status || "open"})
              </strong>
            </div>
            <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>
              Agents are executing triage and remediation. The final vector-indexed postmortem will automatically render here upon resolution.
            </p>
          </div>
        ) : (
          <div className="cx-panel-2" style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--text)" }}>
              {incident?.title || "Incident Report"}
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, fontSize: "14px" }}>
              <div>
                <strong style={{ color: "var(--line-east)", fontFamily: "var(--font-mono)", fontSize: "12px", textTransform: "uppercase" }}>
                  Root Cause:
                </strong>
                <p style={{ marginTop: 2, color: "var(--text)", lineHeight: 1.4 }}>{postmortem.root_cause}</p>
              </div>

              <div>
                <strong style={{ color: "var(--line-west)", fontFamily: "var(--font-mono)", fontSize: "12px", textTransform: "uppercase" }}>
                  Summary:
                </strong>
                <p style={{ marginTop: 2, color: "var(--text)", lineHeight: 1.4 }}>{postmortem.summary}</p>
              </div>

              <div>
                <strong style={{ color: "var(--done)", fontFamily: "var(--font-mono)", fontSize: "12px", textTransform: "uppercase" }}>
                  Remediation Executed:
                </strong>
                <p style={{ marginTop: 2, color: "var(--text)", lineHeight: 1.4 }}>{postmortem.remediation_taken}</p>
              </div>
            </div>
          </div>
        )}

        {events.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-dim)" }}>
               Full Raw Event Log ({events.length} events)
            </summary>
            <div className="cx-panel-2" style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
              {events.map((e, i) => {
                const icon = EVENT_ICONS[e.event_type] || "•";
                const isEast = e.agent_region === "us-east-1";
                return (
                  <div key={e.event_id || i} style={{
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--border-light)",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    borderLeft: `3px solid ${isEast ? "var(--line-east)" : "var(--line-west)"}`,
                  }}>
                    <span style={{ color: "var(--text-dim)", minWidth: 72, flexShrink: 0 }}>
                      {new Date(e.created_at).toLocaleTimeString()}
                    </span>
                    <span style={{
                      color: isEast ? "var(--line-east)" : "var(--line-west)",
                      fontWeight: 700,
                      minWidth: 80,
                      flexShrink: 0,
                    }}>
                      {icon} {e.agent_name}
                    </span>
                    <span style={{ color: "var(--text-sub)" }}>{e.event_type}</span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default memo(IncidentReport);
