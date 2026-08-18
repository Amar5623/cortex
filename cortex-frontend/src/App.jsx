// src/App.jsx — Cortex Application Core & Router
import { useCallback, useEffect, useRef, useState } from "react";
import HomePage from "./components/HomePage";
import ConsolePage from "./components/ConsolePage";
import { REGIONS, api, fetchFromLiveRegions } from "./lib/api";

const INCIDENTS_POLL_MS = 1000;
const ACTIVE_DETAIL_POLL_MS = 300; // Fast 300ms poll for active DAG execution
const IDLE_DETAIL_POLL_MS = 3000;  // Backoff when completed
const SIDE_POLL_MS = 2500;
const HEALTH_POLL_MS = 3000;

export default function App() {
  const [route, setRoute] = useState(() => {
    return window.location.pathname.startsWith("/console") ? "console" : "home";
  });

  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [locks, setLocks] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const userClearedRef = useRef(false);

  const [regionHealth, setRegionHealth] = useState(
    Object.fromEntries(
      Object.keys(REGIONS).map((r) => [r, { alive: null, latencyMs: null }])
    )
  );

  const regionHealthRef = useRef(regionHealth);
  useEffect(() => {
    regionHealthRef.current = regionHealth;
  }, [regionHealth]);

  // Sync route with browser history
  const navigate = useCallback((targetRoute) => {
    setRoute(targetRoute);
    const path = targetRoute === "console" ? "/console" : "/";
    window.history.pushState({}, "", path);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname.startsWith("/console") ? "console" : "home");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Poll Region Health
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      await Promise.all(
        Object.keys(REGIONS).map(async (region) => {
          const t0 = performance.now();
          try {
            await api.health(region);
            if (cancelled) return;
            setRegionHealth((h) => ({
              ...h,
              [region]: { alive: true, latencyMs: Math.round(performance.now() - t0) },
            }));
          } catch {
            if (cancelled) return;
            setRegionHealth((h) => ({ ...h, [region]: { alive: false, latencyMs: null } }));
          }
        })
      );
    }
    poll();
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll Incidents List
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const rows = await fetchFromLiveRegions(
          async (r) => (await api.incidents(r)).incidents,
          (row) => row.incident_id,
          "created_at"
        );
        if (cancelled) return;
        setIncidents(rows);
        setIncidentsLoading(false);

        // Auto-select ONLY if a brand new incident was created within last 4 seconds
        setSelectedId((curr) => {
          if (userClearedRef.current) {
            // User explicitly clicked clear — do not auto-select unless a brand new incident is fired
            const newest = rows[0];
            const isBrandNew = newest && Math.abs(Date.now() - new Date(newest.created_at).getTime()) < 4000;
            if (isBrandNew) {
              userClearedRef.current = false;
              return newest.incident_id;
            }
            return null;
          }

          const newest = rows[0];
          const isBrandNew = newest && Math.abs(Date.now() - new Date(newest.created_at).getTime()) < 4000;
          if (isBrandNew) return newest.incident_id;
          return curr; // Keep current selection or null if cleared
        });
      } catch {
        if (!cancelled) setIncidentsLoading(false);
      }
    }
    poll();
    const id = setInterval(poll, INCIDENTS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll Incident Details with fast 300ms active interval
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    if (!detail || detail.incident?.incident_id !== selectedId) {
      setDetailLoading(true);
    }

    async function pollDetail() {
      const currentHealth = regionHealthRef.current;
      const sortedRegions = Object.keys(REGIONS).sort((a, b) => {
        const aAlive = currentHealth[a]?.alive !== false ? 1 : 0;
        const bAlive = currentHealth[b]?.alive !== false ? 1 : 0;
        return bAlive - aAlive;
      });

      for (const region of sortedRegions) {
        try {
          const d = await api.incident(region, selectedId);
          if (cancelled) return false;
          if (d && d.incident) {
            setDetail(d);
            setDetailLoading(false);
            return d.incident.status === "closed" || Boolean(d.postmortem);
          }
        } catch {
          // try next region
        }
      }
      if (!cancelled) setDetailLoading(false);
      return false;
    }

    let timer = null;

    async function loop() {
      const isClosed = await pollDetail();
      if (cancelled) return;
      const nextDelay = isClosed ? IDLE_DETAIL_POLL_MS : ACTIVE_DETAIL_POLL_MS;
      timer = setTimeout(loop, nextDelay);
    }

    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedId]);

  // Poll Locks & Audit Log
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [l, a] = await Promise.all([
          fetchFromLiveRegions(async (r) => (await api.locks(r)).locks, (row) => `${row.incident_id}-${row.lock_token}`, "acquired_at"),
          fetchFromLiveRegions(async (r) => (await api.auditLog(r)).audit_log, (row) => row.audit_id, "occurred_at"),
        ]);
        if (cancelled) return;
        setLocks(l);
        setAuditLog(a);
      } catch {
        // region down
      }
    }
    poll();
    const id = setInterval(poll, SIDE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleSelectIncident = useCallback((id) => {
    userClearedRef.current = false;
    setSelectedId(id);
  }, []);

  const handleFiredIncident = useCallback((id) => {
    userClearedRef.current = false;
    if (id) setSelectedId(id);
    navigate("console");
  }, [navigate]);

  const handleClearSelection = useCallback(() => {
    userClearedRef.current = true;
    setSelectedId(null);
    setDetail(null);
  }, []);

  return (
    <div className="cx-app-shell">
      {route === "home" ? (
        <HomePage onNavigateConsole={() => navigate("console")} />
      ) : (
        <ConsolePage
          incidents={incidents}
          incidentsLoading={incidentsLoading}
          selectedId={selectedId}
          detail={detail}
          detailLoading={detailLoading}
          locks={locks}
          auditLog={auditLog}
          regionHealth={regionHealth}
          onSelectIncident={handleSelectIncident}
          onFiredIncident={handleFiredIncident}
          onClearSelection={handleClearSelection}
          onNavigateHome={() => navigate("home")}
        />
      )}
    </div>
  );
}
