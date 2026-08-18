// src/components/ConsolePage.jsx
// Live Operations Console displaying real-time dual-region Transit Map execution.

import { useState } from "react";
import LineMap from "./LineMap";
import RegionPills from "./RegionPills";
import EventTicker from "./EventTicker";
import IncidentReport from "./IncidentReport";
import IncidentsTable from "./IncidentsTable";
import LockPanel from "./LockPanel";
import ScenarioPanel from "./ScenarioPanel";
import TriggerForm from "./TriggerForm";
import MissionLog from "./MissionLog";
import { useEventPlaybackQueue } from "../lib/eventPlayback";

export default function ConsolePage({
  incidents = [],
  incidentsLoading = false,
  selectedId = null,
  detail = null,
  detailLoading = false,
  locks = [],
  auditLog = [],
  regionHealth = {},
  onSelectIncident,
  onFiredIncident,
  onClearSelection,
  onNavigateHome,
}) {
  const [speedMs, setSpeedMs] = useState(450); // 450ms standard, 700ms cinematic

  // Event playback queue engine
  const { processedEvents, activePackets } = useEventPlaybackQueue({
    events: detail?.events || [],
    speedMs,
  });

  return (
    <div className="cx-console-page">
      {/* CONSOLE TOPBAR */}
      <div className="cx-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onNavigateHome}>
            ← Back to Home
          </button>
          <div className="cx-brand">
            <div className="cx-brand-logo">⚡</div>
            <div>
              <div className="cx-brand-title">CORTEX CONSOLE</div>
              <div className="cx-brand-badge">LIVE DAG TRANSIT MAP</div>
            </div>
          </div>
        </div>

        <div className="cx-topbar-actions">
          {/* Playback Pacing Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel-2)", padding: "2px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-dim)" }}>SPEED:</span>
            <button
              className={`cx-btn cx-btn-sm ${speedMs === 450 ? "cx-btn-secondary" : "cx-btn-ghost"}`}
              onClick={() => setSpeedMs(450)}
            >
              Normal (450ms)
            </button>
            <button
              className={`cx-btn cx-btn-sm ${speedMs === 700 ? "cx-btn-secondary" : "cx-btn-ghost"}`}
              onClick={() => setSpeedMs(700)}
            >
              Cinematic (700ms)
            </button>
          </div>

          <RegionPills health={regionHealth} />
        </div>
      </div>

      {/* CONSOLE CONTENT CONTAINER */}
      <div style={{ maxWidth: 1400, margin: "24px auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 1. HERO: LIVE LINE TRANSIT MAP */}
        <div>
          <LineMap
            events={detail?.events || []}
            detail={detail}
            activePackets={activePackets}
            locks={locks}
            regionHealth={regionHealth}
          />
        </div>

        {/* 2. JUST BELOW THE GRAPH: LIVE DEMO SCENARIOS & SESSION CONTROLS */}
        <div>
          <ScenarioPanel
            onFired={onFiredIncident}
            onClearConsole={onClearSelection}
            selectedId={selectedId}
          />
        </div>

        {/* 3. LIVE EVENT TICKER & POSTMORTEM REPORT */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          <EventTicker events={processedEvents.length ? processedEvents : detail?.events || []} />
          <IncidentReport detail={detail} />
        </div>

        {/* 4. INCIDENTS TABLE & COCKROACHDB LOCK PANEL */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          <IncidentsTable
            incidents={incidents}
            selectedId={selectedId}
            onSelect={onSelectIncident}
            loading={incidentsLoading}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <LockPanel locks={locks} loading={incidentsLoading} />

            <details className="cx-panel">
              <summary style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-dim)", textTransform: "uppercase" }}>
                🔧 Custom Incident Payload Trigger
              </summary>
              <div style={{ marginTop: 12 }}>
                <TriggerForm onFired={onFiredIncident} />
              </div>
            </details>
          </div>
        </div>

        {/* 5. MISSION AUDIT LOG */}
        <MissionLog events={detail?.events || []} auditLog={auditLog} loading={incidentsLoading} />
      </div>
    </div>
  );
}
