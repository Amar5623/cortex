// src/lib/eventPlayback.js
// Decouples high-frequency API polling from visual UI rendering using an ordered playback queue.
// Guarantees bursty backend events render as distinct, human-readable handoff animations.

import { useEffect, useRef, useState } from "react";

export function useEventPlaybackQueue({
  events = [],
  speedMs = 450, // 450ms normal, 700ms cinematic
  onEventProcessed = null,
}) {
  const [processedEvents, setProcessedEvents] = useState([]);
  const [activePackets, setActivePackets] = useState([]);
  const seenEventIdsRef = useRef(new Set());
  const queueRef = useRef([]);
  const tickerRef = useRef(null);

  // Sync incoming events into queue
  useEffect(() => {
    if (!events || !events.length) {
      if (processedEvents.length > 0) {
        setProcessedEvents([]);
        setActivePackets([]);
        seenEventIdsRef.current.clear();
        queueRef.current = [];
      }
      return;
    }

    const newItems = events.filter((ev) => {
      const id = ev.event_id || `${ev.event_type}-${ev.agent_region}-${ev.created_at}`;
      if (seenEventIdsRef.current.has(id)) return false;
      seenEventIdsRef.current.add(id);
      return true;
    });

    if (newItems.length > 0) {
      // Sort chronologically
      newItems.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      queueRef.current.push(...newItems);
    }
  }, [events]);

  // Ticker loop draining queue at fixed speedMs cadence
  useEffect(() => {
    let timer = null;

    function processNext() {
      if (queueRef.current.length > 0) {
        const nextEv = queueRef.current.shift();
        
        setProcessedEvents((prev) => [...prev, nextEv]);

        // Create packet animation trigger based on event type
        const packet = createPacketFromEvent(nextEv);
        if (packet) {
          setActivePackets((prev) => [...prev, packet]);
          // Expire packet after 400ms
          setTimeout(() => {
            setActivePackets((prev) => prev.filter((p) => p.id !== packet.id));
          }, 420);
        }

        if (onEventProcessed) {
          onEventProcessed(nextEv);
        }
      }

      timer = setTimeout(processNext, speedMs);
    }

    timer = setTimeout(processNext, speedMs);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [speedMs, onEventProcessed]);

  return {
    processedEvents,
    activePackets,
    queueLength: queueRef.current.length,
  };
}

function createPacketFromEvent(event) {
  const type = event.event_type;
  const region = event.agent_region || "us-east-1";
  const timestamp = Date.now();

  if (type === "incident_created" || type === "incident_retriggered") {
    return { id: `pkt-fanout-${timestamp}`, region, from: "ingest", to: ["triage", "runbook"] };
  } else if (type === "triage_completed") {
    return { id: `pkt-triage-${timestamp}`, region, from: "triage", to: ["merge"] };
  } else if (type === "runbook_completed") {
    return { id: `pkt-runbook-${timestamp}`, region, from: "runbook", to: ["merge"] };
  } else if (type === "context_merged") {
    return { id: `pkt-merge-${timestamp}`, region, from: "merge", to: ["remediation"] };
  } else if (type.includes("remediation")) {
    return { id: `pkt-remediation-${timestamp}`, region, from: "remediation", to: ["postmortem"] };
  }
  return null;
}
