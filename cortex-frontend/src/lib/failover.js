// src/lib/failover.js
// Detects a lock steal for the report/banner — compares the first region
// that ever acquired the lock (from the earliest remediation_* event) to
// the lock row's current locked_by_region.

export function detectFailover(events, lock) {
  const remediationEvents = events
    .filter((e) => e.agent_name === "remediation")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const firstRegion = remediationEvents[0]?.agent_region;
  const currentRegion = lock?.locked_by_region;

  if (firstRegion && currentRegion && firstRegion !== currentRegion) {
    return { failedOver: true, from: firstRegion, to: currentRegion };
  }
  return { failedOver: false };
}
