// src/lib/eventBubbles.js
// Pure mapping from a raw incident_events row to bubble text. This is the
// only place bubble copy lives — AgentDesk, MissionLog, and IncidentReport
// all call into it, so the "office" view and the "logs" view never say
// different things about the same event.

const short = (id) => (id ? `${String(id).slice(0, 8)}…` : "?");

export const EVENT_BUBBLES = {
  incident_created:     (p) => `🆕 New alert: "${p.fingerprint}" (${p.severity})`,
  incident_retriggered: () => `🔁 Same fingerprint again — resuming this incident`,

  triage_started:   () => `🔎 Checking CockroachDB for prior incidents…`,
  triage_completed: (p) => p.seen_before
    ? `⚠️ Seen before — ${(p.prior_incident_ids || []).length} prior incident(s)`
    : `✅ First sighting of this fingerprint`,

  runbook_started:   () => `📡 Vector search over runbooks + postmortems…`,
  runbook_completed: (p) => `📚 Matched ${(p.matched_runbook_ids || []).filter(Boolean).length} runbook(s)`,

  context_merged: (p) =>
    `🔀 Merged: ${(p.matched_runbook_ids || []).filter(Boolean).length} runbook(s), ` +
    `${(p.matched_postmortem_ids || []).filter(Boolean).length} postmortem(s)`,

  remediation_lock_attempt: () => `🔐 Attempting to acquire the incident lock…`,
  remediation_stood_down:   () => `🧍 Lock already held elsewhere — standing down`,
  remediation_applied:      (p) => `🛠️ ${(p.notes || "Applying remediation…").slice(0, 90)}`,
  remediation_completed:    () => `✅ Remediation complete — resolved`,

  postmortem_started: () => `📝 Drafting postmortem from the full timeline…`,
  postmortem_written: (p) => `📓 Postmortem saved (${short(p.postmortem_id)}) — closed`,
};

export function bubbleFor(event) {
  const fn = event && EVENT_BUBBLES[event.event_type];
  return fn ? fn(event.payload || {}, event) : null;
}
