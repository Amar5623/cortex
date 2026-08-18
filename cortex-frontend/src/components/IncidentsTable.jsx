// src/components/IncidentsTable.jsx
import { memo, useState } from "react";

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const PAGE_SIZE = 5;

function IncidentsTable({ incidents = [], selectedId, onSelect, loading }) {
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(incidents.length / PAGE_SIZE) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const displayIncidents = incidents.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="cx-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <div className="cx-panel-header">
          <div className="cx-panel-title">
            <span>📋 CockroachDB Incident Log</span>
          </div>
          <span className="cx-panel-subtitle">
            {incidents.length} RECORDED ENTRIES
          </span>
        </div>

        {displayIncidents.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
            {loading ? "Polling CockroachDB..." : "No active incidents recorded. Use the scenario trigger below."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Service</th>
                  <th>Sev</th>
                  <th>Status</th>
                  <th>Origin</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {displayIncidents.map((inc) => {
                  const isSelected = inc.incident_id === selectedId;
                  const isEast = inc.origin_region === "us-east-1";

                  return (
                    <tr
                      key={inc.incident_id}
                      className={isSelected ? "selected" : ""}
                      onClick={() => onSelect(inc.incident_id)}
                    >
                      <td style={{ fontWeight: 600 }}>{inc.title}</td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{inc.service_name}</td>
                      <td>
                        <span
                          className="cx-badge"
                          style={{
                            backgroundColor: inc.severity === "Sev1" ? "rgba(255, 59, 92, 0.15)" : "rgba(255, 106, 61, 0.15)",
                            color: inc.severity === "Sev1" ? "var(--alert)" : "var(--line-east)",
                          }}
                        >
                          {inc.severity}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`cx-badge ${
                            inc.status === "closed" ? "cx-badge-closed" : inc.status === "remediating" ? "cx-badge-remediating" : "cx-badge-open"
                          }`}
                        >
                          {inc.status}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: isEast ? "var(--line-east)" : "var(--line-west)",
                          }}
                        >
                          {isEast ? "EAST" : "WEST"}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{timeAgo(inc.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

export default memo(IncidentsTable);
