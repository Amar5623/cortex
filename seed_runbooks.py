"""
Seeds the runbooks table with realistic (but fully synthetic — no real
company/client names) SRE runbook content, so the runbook-retrieval agent
has something non-trivial to find via vector search.

Deliberately hand-authored content, not Faker-generated lorem-ipsum: a
vector embedding of random text produces a semantically meaningless
embedding, which would make vector search return near-random results —
exactly wrong for a demo whose point is "here's a real, relevant prior
fix." Faker would be the right tool for structured fields with no
semantic content (e.g. an on-call contact name or ticket ID), but the
runbooks schema doesn't have columns for those, so it isn't used here.

Deliberately NOT seeding fake postmortems here, only runbooks. Postmortems
should only ever be written by the postmortem-writer agent as incidents
actually resolve — pre-seeding fake incident history would fabricate the
"agent memory builds on itself" story instead of demonstrating it live.

Flow per runbook: upload raw content to S3 (source_s3_key) -> embed
locally (sentence-transformers, 384-dim) -> insert into cortex.runbooks
via the Managed MCP Server.
"""

import asyncio
import re
from dotenv import load_dotenv
load_dotenv()

from agents import mcp_client
from agents import s3_client
from agents.mcp_client import Raw
from agents.embeddings import embed_text


RUNBOOKS = [
    {
        "title": "Checkout Service 5xx Error Spike",
        "service_name": "checkout",
        "content": """SYMPTOMS
Checkout service returns a sustained spike in 5xx responses, typically starting within
seconds of a deploy or a downstream payment-gateway timeout. Error rate crosses 5% of
total checkout traffic within a 2-minute window; p99 latency on POST /checkout/complete
climbs above 3s.

DIAGNOSIS
1. Check the checkout service's dependency health dashboard first -- this pattern is
   most commonly caused by the payment-gateway client's connection pool being exhausted,
   not by a bug in checkout itself.
2. Grep recent checkout service logs for "PoolTimeoutException" or "circuit breaker open".
   If present, the payment gateway is the root cause, not checkout.
3. If no pool exhaustion signature, check for a recent deploy in the last 30 minutes --
   a bad deploy is the second most common cause.

REMEDIATION
- If payment-gateway pool exhaustion: bump the checkout service's outbound connection
  pool size via the CHECKOUT_PG_POOL_SIZE env var (default 20, safe to double under
  load) and restart the affected instances. This buys headroom while the gateway
  team investigates their own latency.
- If bad deploy: roll back to the previous known-good revision immediately rather than
  attempting a forward fix under incident pressure.
- Do not scale out checkout instances alone without addressing the pool exhaustion --
  more instances just exhaust the shared payment-gateway connection quota faster.
""",
    },
    {
        "title": "Payments API Elevated Latency",
        "service_name": "payments-api",
        "content": """SYMPTOMS
payments-api p95 latency exceeds 800ms (baseline ~150ms) without a corresponding
increase in error rate. Requests succeed, just slowly. Usually correlates with a
spike in database connection wait time on the payments-api's primary write path.

DIAGNOSIS
1. Check the database connection pool metrics for payments-api first -- this is
   almost always a connection pool starvation issue, not a query performance issue.
2. Look at active vs idle connections in the pool. If active is pegged at the pool max
   with a growing wait queue, that confirms starvation.
3. Rule out a long-running migration or backup job holding connections open --
   check for any scheduled jobs that started around the same time as the latency spike.

REMEDIATION
- If a scheduled job is holding connections: that job should be paused/killed first,
  latency should recover within a minute of the connections being released.
- If genuine starvation under normal load: temporarily raise the pool's max_connections
  by 25% as a stopgap, then file a follow-up to profile actual query patterns --
  raising pool size treats the symptom, not the cause, and shouldn't be left in place
  permanently without understanding why demand grew.
- Do not restart payments-api instances as a first response -- in-flight payment
  requests risk being dropped mid-transaction, which is worse than the latency itself.
""",
    },
    {
        "title": "Auth Service Token Validation Failures",
        "service_name": "auth-service",
        "content": """SYMPTOMS
Sudden spike in 401 responses across multiple downstream services simultaneously,
even for users with valid, unexpired sessions. Distinguishing signature: it affects
many unrelated services at once rather than one service's users specifically.

DIAGNOSIS
1. This cross-service pattern almost always means the auth service's signing key
   rotation went wrong, not a bug in any individual downstream service.
2. Check auth-service's key rotation logs for a rotation event in the last 15 minutes.
3. Confirm whether downstream services have picked up the new public key yet --
   if auth-service rotated but downstream JWKS caches haven't refreshed, tokens
   signed with the new key fail validation everywhere until caches expire.

REMEDIATION
- If it's a JWKS cache propagation lag: this is usually self-healing within the
  cache TTL (typically 5-10 minutes) -- confirm the TTL rather than taking action,
  since manual intervention here risks making things worse.
- If genuinely stuck (cache TTL has passed and failures persist): manually trigger a
  JWKS cache refresh on the affected downstream services rather than rolling back
  the auth-service key rotation, since rolling back mid-rotation can leave some
  already-issued tokens permanently unverifiable.
- Never disable token validation as a stopgap, even temporarily, even under
  significant pressure to restore service -- that trades an availability incident
  for a security incident, which is a worse trade.
""",
    },
    {
        "title": "Primary Database High Replication Lag",
        "service_name": "database",
        "content": """SYMPTOMS
Read replicas fall significantly behind the primary (lag > 30s), causing stale reads
on read-heavy endpoints. Often first noticed as "users report seeing old data after
an action that should have updated it immediately."

DIAGNOSIS
1. Check the primary's write volume first -- a sustained burst of large writes
   (e.g. a batch job, a bulk import) is the most common cause, not replica hardware
   issues.
2. Check replica CPU/IO utilization -- if replicas are saturated rather than merely
   behind, that points to replica-side resource pressure instead.
3. Check for long-running transactions on the primary that could be delaying WAL
   shipping.

REMEDIATION
- If caused by a batch job: that job should be throttled or paused, lag typically
  recovers on its own once write volume drops, no direct intervention on the
  replicas needed.
- If replicas are resource-saturated: route read traffic away from the lagging
  replica(s) at the load balancer level while they catch up, rather than trying to
  scale replica hardware mid-incident.
- If a long-running transaction is the cause: identify and, if safe, terminate it --
  but confirm with the owning team first if at all possible, since killing the wrong
  transaction can cause its own data consistency issues.
""",
    },
    {
        "title": "API Gateway Rate Limit False Positives",
        "service_name": "api-gateway",
        "content": """SYMPTOMS
Legitimate traffic starts receiving 429 (rate limited) responses despite being well
under normal per-client limits. Often follows shortly after a client-side retry
storm or a shared-IP scenario (e.g. many users behind one corporate NAT).

DIAGNOSIS
1. Check whether the rate limiting is keyed by IP or by authenticated client ID --
   IP-based limiting is far more prone to this false-positive pattern.
2. If IP-keyed, check whether the affected traffic is coming from a small number of
   source IPs relative to the number of distinct users/requests -- a shared corporate
   NAT or a misconfigured client library retrying aggressively both produce this
   signature.
3. Check gateway logs for retry patterns -- rapid identical repeated requests from
   the same client suggest a client-side bug is amplifying its own rate limiting.

REMEDIATION
- If shared-NAT false positive: add a temporary allowlist/limit exception for the
  specific affected IP(s) while the longer-term fix (switching that traffic to
  client-ID-based limiting) is scheduled -- don't raise the global rate limit, which
  weakens protection for everyone.
- If client-side retry storm: reach out to the client/team responsible if identifiable,
  since raising limits without fixing the retry behavior just delays the same problem
  at a higher traffic volume.
- Do not disable rate limiting entirely, even temporarily -- that removes a real
  protection for the sake of an incident whose root cause is usually narrow and
  fixable without doing so.
""",
    },
    {
        "title": "Cache Service Cold Start Thundering Herd",
        "service_name": "cache-service",
        "content": """SYMPTOMS
Sudden, severe latency spike and CPU saturation on backing database services
immediately following a cache service restart, cache cluster failover, or a mass
cache eviction. Symptoms resemble a database overload incident but the actual
trigger is upstream, in the cache layer.

DIAGNOSIS
1. Check cache hit rate first -- a sudden drop from a normal ~90%+ hit rate toward
   0% strongly indicates a cold cache, not a database-side problem.
2. Correlate the timing with any recent cache service deploy, restart, or failover
   event -- these are the near-universal trigger for this pattern.
3. Confirm the database itself has no independent issue (no slow query plan changes,
   no lock contention) -- if the database is otherwise healthy and only overloaded
   by request volume, this confirms the thundering-herd diagnosis.

REMEDIATION
- Enable or verify request coalescing / cache stampede protection is active on the
  cache layer (so concurrent requests for the same missing key trigger one backend
  fetch, not N concurrent fetches) -- this is the correct long-term fix if not
  already in place.
- As an immediate stopgap during the incident, temporarily throttle traffic to the
  affected endpoints at the gateway level to let the cache repopulate under reduced
  load, rather than scaling the database, which treats the symptom.
- Consider a warm-up/pre-population step before any future planned cache restarts,
  to prevent recurrence, and note this as a postmortem action item rather than
  something to improvise mid-incident.
""",
    },
]


async def main():
    bucket = s3_client.bucket_name()
    print(f"Seeding {len(RUNBOOKS)} runbooks (S3 bucket: {bucket}) ...")

    for rb in RUNBOOKS:
        slug = re.sub(r"[^a-z0-9]+", "-", rb["title"].lower()).strip("-")
        s3_key = f"runbooks/{slug}.txt"

        s3_client.upload_text(s3_key, rb["content"])
        print(f"  [s3]     uploaded s3://{bucket}/{s3_key}")

        embed_source = f"{rb['title']} {rb['service_name']} {rb['content']}"
        embedding = embed_text(embed_source)
        print(f"  [embed]  {rb['title']}")

        row = {
            "title": rb["title"],
            "service_name": rb["service_name"],
            "content": rb["content"],
            "embedding": Raw(mcp_client.format_vector(embedding)),
            "source_s3_key": s3_key,
        }
        # One insert per row (not batched) — 384-dim vector literals make
        # each query string long enough that batching several together
        # isn't worth the marginal round-trip savings for a one-time seed.
        await mcp_client.insert("cortex", "runbooks", [row])
        print(f"  [insert] {rb['title']}")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())