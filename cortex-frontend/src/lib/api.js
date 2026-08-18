// Thin fetch wrapper over the two Lambda Function URLs. No middle-tier
// backend -- the browser talks directly to *.lambda-url.*.on.aws (see
// template.yaml FunctionUrlConfig.Cors).

export const REGIONS = {
  "us-east-1": import.meta.env.VITE_LAMBDA_URL_EAST?.replace(/\/$/, "") || "",
  "us-west-2": import.meta.env.VITE_LAMBDA_URL_WEST?.replace(/\/$/, "") || "",
};

async function req(baseUrl, path, opts = {}) {
  if (!baseUrl) throw new Error("no Lambda URL configured for that region");
  const { headers: callerHeaders, ...rest } = opts;
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...callerHeaders },
    ...rest,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const api = {
  health: (region) => req(REGIONS[region], "/health"),
  incidents: (region) => req(REGIONS[region], "/incidents"),
  incident: (region, id) => req(REGIONS[region], `/incidents/${id}`),
  locks: (region) => req(REGIONS[region], "/locks"),
  postmortems: (region) => req(REGIONS[region], "/postmortems"),
  auditLog: (region) => req(REGIONS[region], "/audit-log"),
  triggerIncident: (region, payload) =>
    req(REGIONS[region], "/incidents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  adminKillRegion: async (region, adminKey) => {
    const otherRegion = Object.keys(REGIONS).find((r) => r !== region);
    try {
      return await req(REGIONS[region], "/admin/kill-region", {
        method: "POST",
        headers: { "x-cortex-admin-key": adminKey },
        body: JSON.stringify({ region }),
      });
    } catch (err) {
      if (otherRegion && REGIONS[otherRegion]) {
        return await req(REGIONS[otherRegion], "/admin/kill-region", {
          method: "POST",
          headers: { "x-cortex-admin-key": adminKey },
          body: JSON.stringify({ region }),
        });
      }
      throw err;
    }
  },
  adminRestoreRegion: async (region, adminKey) => {
    // When region concurrency is 0, its Lambda URL throws 429 because it cannot invoke.
    // Send restore request to the surviving live region, which calls AWS Lambda API cross-region!
    const otherRegion = Object.keys(REGIONS).find((r) => r !== region);
    const targetUrl = (otherRegion && REGIONS[otherRegion]) ? REGIONS[otherRegion] : REGIONS[region];
    try {
      return await req(targetUrl, "/admin/restore-region", {
        method: "POST",
        headers: { "x-cortex-admin-key": adminKey },
        body: JSON.stringify({ region }),
      });
    } catch (err) {
      return await req(REGIONS[region], "/admin/restore-region", {
        method: "POST",
        headers: { "x-cortex-admin-key": adminKey },
        body: JSON.stringify({ region }),
      });
    }
  },
};

// Merge same-shaped lists fetched from both regions, deduped by a key fn,
// newest first. CockroachDB is the single source of truth so /incidents
// from EITHER region returns the same underlying rows -- but if one
// region is down (kill-demo), we still want whatever the live region has.
export async function fetchFromLiveRegions(fn, keyFn, sortKey) {
  const settled = await Promise.allSettled(
    Object.keys(REGIONS).map((r) => fn(r))
  );
  const byKey = new Map();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const rows = s.value;
    for (const row of rows) byKey.set(keyFn(row), row);
  }
  return [...byKey.values()].sort((a, b) =>
    a[sortKey] < b[sortKey] ? 1 : -1
  );
}
