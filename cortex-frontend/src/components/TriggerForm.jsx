// src/components/TriggerForm.jsx
import { memo, useState } from "react";
import { REGIONS, api } from "../lib/api";

const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];

function TriggerForm({ onFired }) {
  const [region, setRegion] = useState(Object.keys(REGIONS)[0]);
  const [service, setService] = useState("payments-api");
  const [title, setTitle] = useState("High memory usage — payments-api");
  const [severity, setSeverity] = useState("sev2");
  const [fingerprint, setFingerprint] = useState("payments-api-oom");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  async function fire(e) {
    e.preventDefault();
    setBusy(true);
    setToast(null);
    const uniqueFp = `${fingerprint.replace(/-\d+$/, "")}-${Date.now()}`;
    try {
      const result = await api.triggerIncident(region, {
        fingerprint: uniqueFp,
        title,
        service_name: service,
        severity,
        origin_region: region,
      });
      const incidentId = result.incident_id || result.result?.incident_id;
      setToast({ ok: true, msg: `Incident Triggered! ID: ${incidentId ? incidentId.slice(0, 8) : "ok"}` });
      if (incidentId) onFired?.(incidentId);
    } catch (err) {
      setToast({ ok: false, msg: err.message });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "8px 12px",
    backgroundColor: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
  };

  const labelStyle = {
    display: "block",
    marginBottom: "4px",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    color: "var(--text-dim)",
    textTransform: "uppercase",
  };

  return (
    <div style={{ padding: "8px 0" }}>
      <form onSubmit={fire} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Target Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} style={inputStyle}>
              {Object.keys(REGIONS).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={inputStyle}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Service Name</label>
          <input value={service} onChange={(e) => setService(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Incident Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Fingerprint</label>
          <input value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} style={inputStyle} />
        </div>

        <button className="cx-btn cx-btn-secondary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Executing..." : "Fire Custom Incident Payload"}
        </button>
      </form>

      {toast && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            backgroundColor: toast.ok ? "rgba(46, 213, 115, 0.1)" : "rgba(255, 59, 92, 0.1)",
            color: toast.ok ? "#2ED573" : "var(--alert)",
            border: `1px solid ${toast.ok ? "rgba(46, 213, 115, 0.3)" : "rgba(255, 59, 92, 0.3)"}`,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default memo(TriggerForm);
