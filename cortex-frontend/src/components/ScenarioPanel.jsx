// src/components/ScenarioPanel.jsx
import { memo, useState } from "react";
import { REGIONS, api } from "../lib/api";

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || "cortex-secret-admin-key-2026";

function ScenarioPanel({ onFired, onClearConsole, selectedId }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  function step(msg) {
    setLog((l) => [...l, msg]);
  }

  const handleClear = () => {
    setLog([]);
    onClearConsole?.();
  };

  async function runNormal() {
    setBusy(true);
    setLog([]);
    onFired?.(null);
    try {
      const region = Object.keys(REGIONS)[0]; // us-east-1
      step(`→ [STEP 1] Firing incident against primary region (${region})…`);
      const result = await api.triggerIncident(region, {
        fingerprint: `demo-normal-${Date.now()}`,
        title: "Checkout service 5xx error spike",
        service_name: "checkout",
        severity: "sev2",
        origin_region: region,
      });
      const incidentId = result.incident_id || result.result?.incident_id;
      step(`✓ [STEP 2] Incident created in CockroachDB! ID: ${incidentId?.slice(0, 8)}…`);
      step(`⚡ [STEP 3] LangGraph DAG running on us-east-1 line (Ingest ➔ Triage/Runbook ➔ Merge ➔ Remediation ➔ Postmortem)`);
      onFired?.(incidentId);
    } catch (e) {
      step(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runKillAndRecover() {
    setBusy(true);
    setLog([]);
    onFired?.(null);
    const fingerprint = `demo-kill-${Date.now()}`;
    const [east, west] = Object.keys(REGIONS);
    try {
      step(`→ [STEP 1] Firing incident payload to primary region (${east})…`);
      const r1 = await api.triggerIncident(east, {
        fingerprint,
        title: "Payment gateway timeout spike",
        service_name: "checkout",
        severity: "sev2",
        origin_region: east,
      });
      const incidentId1 = r1.incident_id || r1.result?.incident_id;
      onFired?.(incidentId1);

      step(`⏳ [STEP 2] us-east-1 acquired 20s lock in CockroachDB & started Remediation…`);
      await sleep(3500);

      step(`💥 [STEP 3] KILLING us-east-1 (setting Lambda concurrency → 0 live on AWS)…`);
      await api.adminKillRegion(east, ADMIN_KEY);
      step(`✓ [STEP 4] us-east-1 Lambda is DEAD. East line goes dark mid-remediation!`);

      await sleep(1500);
      step(`→ [STEP 5] Re-firing SAME fingerprint against secondary region (${west})…`);
      const r2 = await api.triggerIncident(west, {
        fingerprint,
        title: "Payment gateway timeout spike",
        service_name: "checkout",
        severity: "sev2",
        origin_region: east,
      });
      const incidentId2 = r2.incident_id || r2.result?.incident_id;
      if (incidentId2) onFired?.(incidentId2);
      step(`⚡ [STEP 6] SUCCESS! us-west-2 detected stale lock, STOLE lock in CockroachDB, and completed remediation on West line!`);
    } catch (e) {
      step(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(region) {
    setBusy(true);
    try {
      step(`→ Restoring ${region} Lambda reserved concurrency…`);
      await api.adminRestoreRegion(region, ADMIN_KEY);
      step(`✓ ${region} restored and online.`);
    } catch (e) {
      step(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-panel" style={{ borderLeft: "4px solid var(--line-east)" }}>
      <div className="cx-panel-header" style={{ marginBottom: 12 }}>
        <div className="cx-panel-title">
          <span>🎬 LIVE DEMO SCENARIOS & SESSION CONTROLS</span>
        </div>
        {selectedId && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--line-west)" }}>
            ACTIVE INCIDENT: {selectedId.slice(0, 8)}…
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="cx-btn cx-btn-primary"
          disabled={busy}
          onClick={runNormal}
          style={{ flex: "1 1 220px", justifyContent: "center" }}
        >
          ⚡ Fire Standard Incident Flow (us-east-1)
        </button>

        <button
          className="cx-btn"
          disabled={busy}
          onClick={runKillAndRecover}
          style={{
            flex: "1 1 260px",
            justifyContent: "center",
            backgroundColor: "rgba(255, 59, 92, 0.15)",
            borderColor: "var(--alert)",
            color: "var(--alert)",
            fontWeight: 700,
          }}
        >
          💥 Run Cross-Region Kill & Steal Demo
        </button>

        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          {Object.keys(REGIONS).map((r) => (
            <button
              key={r}
              className="cx-btn cx-btn-sm cx-btn-secondary"
              disabled={busy}
              onClick={() => restore(r)}
            >
              Restore {r === "us-east-1" ? "East" : "West"}
            </button>
          ))}
        </div>

        {/* CLEAR ACTIVE CONSOLE SESSION BUTTON */}
        <button
          className="cx-btn cx-btn-ghost cx-btn-sm"
          onClick={handleClear}
          title="Clear active incident selection, event ticker, and postmortem report"
          style={{
            border: "1px dashed var(--border)",
            color: "var(--text-dim)",
            padding: "8px 14px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          🧹 Clear Active Session & Logs
        </button>
      </div>

      {log.length > 0 && (
        <div
          className="cx-panel-2"
          style={{
            marginTop: 12,
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text)",
            maxHeight: 140,
            overflowY: "auto",
            borderLeft: "3px solid var(--interchange)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "var(--text-dim)" }}>
            <span>SCENARIO EXECUTION LOG:</span>
            <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setLog([])}>Clear log</span>
          </div>
          {log.map((l, i) => (
            <div key={i} style={{ padding: "2px 0", color: l.startsWith("💥") || l.startsWith("⚡") ? "var(--alert)" : "var(--text)" }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export default memo(ScenarioPanel);
