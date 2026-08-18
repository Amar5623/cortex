// src/components/EventTicker.jsx
// Persistent live scrolling ticker feed with improved visual design and full container height utilization.

import { useEffect, useRef } from "react";
import { bubbleFor } from "../lib/eventBubbles";

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

export default function EventTicker({ events = [] }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events]);

  if (!events || !events.length) {
    return (
      <div className="cx-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="cx-panel-header">
          <div className="cx-panel-title">
            <span>📡 Live Event Ticker</span>
          </div>
        </div>
        <div style={{ padding: "16px 0", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "12px", flex: 1 }}>
          Select or trigger an incident to stream real-time agent handoff messages.
        </div>
      </div>
    );
  }

  return (
    <div className="cx-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="cx-panel-header">
        <div className="cx-panel-title">
          <span>📡 Live Event Ticker</span>
        </div>
        <span className="cx-panel-subtitle">{events.length} EVENTS CAPTURED</span>
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 340,
          maxHeight: 520,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {events.map((ev, i) => {
          const msg = bubbleFor(ev) || ev.event_type;
          const reg = ev.agent_region || "us-east-1";
          const isEast = reg === "us-east-1";
          const agentName = ev.agent_name || ev.event_type.split("_")[0];
          const time = ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : "--:--:--";
          const icon = EVENT_ICONS[ev.event_type] || "•";
          const isDone = ev.event_type.includes("completed") || ev.event_type.includes("written") || ev.event_type === "context_merged";

          return (
            <div
              key={ev.event_id || i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderBottom: "1px solid var(--border-light)",
                borderLeft: `3px solid ${isEast ? "var(--line-east)" : "var(--line-west)"}`,
                background: i === events.length - 1 ? "rgba(255, 255, 255, 0.02)" : "transparent",
                transition: "background 0.3s ease",
              }}
            >
              {/* Timestamp */}
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--text-dim)",
                minWidth: 72,
                flexShrink: 0,
              }}>
                {time}
              </span>

              {/* Region + Agent pill */}
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                fontWeight: 700,
                color: isEast ? "var(--line-east)" : "var(--line-west)",
                minWidth: 36,
                flexShrink: 0,
              }}>
                {isEast ? "EAST" : "WEST"}
              </span>

              {/* Icon + Agent Name */}
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                minWidth: 90,
                flexShrink: 0,
              }}>
                {agentName}
              </span>

              {/* Event message */}
              <span style={{
                fontSize: "12px",
                color: isDone ? "#2ED573" : "var(--text-dim)",
                fontWeight: isDone ? 600 : 400,
                lineHeight: 1.4,
              }}>
                {icon} {msg}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
