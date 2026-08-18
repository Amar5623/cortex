// src/components/RegionPills.jsx
// Compact topbar region health indicators with regional kill & restore controls.

import { useState } from "react";
import { api } from "../lib/api";

export default function RegionPills({ health = {}, onHealthUpdated = null }) {
  const [busyRegion, setBusyRegion] = useState(null);

  async function handleToggleRegion(region, isAlive) {
    const adminKey = prompt(`Enter Cortex Admin Key to ${isAlive ? "KILL" : "RESTORE"} ${region}:`, "cortex-admin-secret");
    if (!adminKey) return;

    setBusyRegion(region);
    try {
      if (isAlive) {
        await api.adminKillRegion(region, adminKey);
      } else {
        await api.adminRestoreRegion(region, adminKey);
      }
      if (onHealthUpdated) onHealthUpdated();
    } catch (err) {
      alert(`Admin Action Failed: ${err.message}`);
    } finally {
      setBusyRegion(null);
    }
  }

  return (
    <div className="cx-region-pills">
      {Object.entries(health).map(([region, data]) => {
        const alive = data?.alive !== false;
        const latency = data?.latencyMs;
        const isEast = region === "us-east-1";
        const isBusy = busyRegion === region;

        return (
          <div
            key={region}
            className={`cx-region-pill ${isEast ? "cx-region-pill-east" : "cx-region-pill-west"}`}
          >
            <span className={`cx-status-dot ${alive ? "online" : "offline"}`} />
            <span style={{ fontWeight: 600, color: "var(--text)" }}>
              {isEast ? "us-east-1" : "us-west-2"}
            </span>
            <span style={{ color: "var(--text-dim)" }}>
              {alive ? (latency ? `${latency}ms` : "OK") : "DEAD"}
            </span>

            <button
              className="cx-btn cx-btn-sm cx-btn-ghost"
              disabled={isBusy}
              onClick={() => handleToggleRegion(region, alive)}
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                marginLeft: "4px",
                color: alive ? "var(--alert)" : "#2ED573",
                borderColor: alive ? "rgba(255, 59, 92, 0.3)" : "rgba(46, 213, 115, 0.3)",
              }}
            >
              {isBusy ? "..." : alive ? "Kill" : "Restore"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
