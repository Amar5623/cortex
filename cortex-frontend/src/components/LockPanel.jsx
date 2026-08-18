// src/components/LockPanel.jsx
function lockStatus(lock) {
  if (!lock || !lock.locked_by_agent) return null;
  if (lock.released_at) return { label: "RELEASED", color: "var(--done)" };
  const expired = lock.lease_expires_at && new Date(lock.lease_expires_at) < new Date();
  if (expired) return { label: "EXPIRED (STEALABLE)", color: "var(--alert)" };
  return { label: "HELD", color: "#2ED573" };
}

export default function LockPanel({ locks = [], loading }) {
  return (
    <div className="cx-panel">
      <div className="cx-panel-header">
        <div className="cx-panel-title">
          <span>🔒 CockroachDB Distributed Locks</span>
        </div>
        <span className="cx-panel-subtitle">{locks.length} ACTIVE</span>
      </div>

      {locks.length === 0 ? (
        <div style={{ padding: "16px 0", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
          {loading ? "Polling locks..." : "No active or leased locks in CockroachDB."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {locks.map((lock) => {
            const st = lockStatus(lock);
            const region = lock.locked_by_region || "";
            const isEast = region.includes("east");

            return (
              <div
                key={`${lock.incident_id}-${lock.lock_token}`}
                className="cx-panel-2"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justify: "space-between",
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: isEast ? "var(--line-east)" : "var(--line-west)", fontWeight: 700 }}>
                    {isEast ? "EAST" : "WEST"}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{lock.locked_by_agent}</span>
                  <span style={{ color: "var(--text-dim)" }}>→ {String(lock.incident_id).slice(0, 8)}...</span>
                </div>

                {st && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: st.color,
                      border: `1px solid ${st.color}`,
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {st.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
