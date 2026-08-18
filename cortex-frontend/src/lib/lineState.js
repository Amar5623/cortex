// src/lib/lineState.js
// Derives per-station status ('pending', 'active', 'done') for a specific region's transit line.

import { AGENT_ROSTER, STAGE_EVENTS } from "./agentRoster.js";

function parseTime(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

export function computeLineStates(events = [], region, detail = null) {
  const now = Date.now();

  return AGENT_ROSTER.map((agent) => {
    const { started = [], done = [] } = STAGE_EVENTS[agent.key] || { started: [], done: [] };

    // Region-specific events
    const isThisRegion = (e) =>
      e.agent_region ? e.agent_region === region : e.origin_region ? e.origin_region === region : true;

    const regStarted = events.filter((e) => isThisRegion(e) && started.includes(e.event_type));
    const regDone = events.filter((e) => isThisRegion(e) && done.includes(e.event_type));

    // Peer region fallback
    const anyDone = events.filter((e) => done.includes(e.event_type));
    const anyStarted = events.filter((e) => started.includes(e.event_type));

    const latestRegDone = latest(regDone);
    const latestRegStarted = latest(regStarted);
    const latestAnyDone = latest(anyDone);
    const latestAnyStarted = latest(anyStarted);

    let status = "pending";
    let event = null;

    if (latestRegStarted || latestRegDone) {
      const doneTime = parseTime(latestRegDone?.created_at);
      const startTime = parseTime(latestRegStarted?.created_at);

      if (latestRegDone && (!latestRegStarted || doneTime >= startTime)) {
        // Active highlight window for 4.5s post completion
        const justFinished = doneTime > 0 && now - doneTime < 4500;
        status = justFinished ? "active" : "done";
        event = latestRegDone;
      } else if (latestRegStarted) {
        status = "active";
        event = latestRegStarted;
      }
    } else if (latestAnyDone || latestAnyStarted) {
      status = "done";
      event = latestAnyDone || latestAnyStarted;
    } else if (agent.key === "postmortem" && (detail?.postmortem || detail?.incident?.status === "closed")) {
      status = "done";
      event = {
        event_type: "postmortem_written",
        agent_name: "postmortem",
        agent_region: region,
        payload: { postmortem_id: detail?.postmortem?.postmortem_id || "written" },
      };
    }

    return {
      ...agent,
      region,
      status,
      event,
    };
  });
}

function latest(rows) {
  if (!rows || !rows.length) return null;
  return rows.reduce((a, b) => (parseTime(a.created_at) >= parseTime(b.created_at) ? a : b));
}
