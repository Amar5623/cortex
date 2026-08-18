"""
Verifies the runbook seeding actually worked correctly, not just that it
ran without crashing:
  1. Row count matches what was seeded.
  2. S3 objects are actually present (not just claimed in source_s3_key).
  3. Vector search returns SEMANTICALLY RELEVANT results — e.g. a query
     about checkout 5xx errors should return the checkout runbook as the
     #1 match, not just "some runbook or other." This is the check that
     actually matters for the demo: an empty or irrelevant result set
     would look identical to a working seed unless we check content, not
     just presence.
"""

import asyncio
from dotenv import load_dotenv
load_dotenv()

from agents import mcp_client, s3_client
from agents.embeddings import embed_text

# (query text, service_name hint, expected top-match title substring)
RELEVANCE_CHECKS = [
    ("checkout service returning server errors", "checkout", "Checkout"),
    ("database replicas falling behind stale reads", "database", "Replication Lag"),
    ("users getting logged out token invalid everywhere", "auth-service", "Token Validation"),
    ("getting rate limited even though under my usage limit", "api-gateway", "Rate Limit"),
]


def _rows_from_result(result) -> list[dict]:
    import json
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if text:
            parsed = json.loads(text)
            if isinstance(parsed, dict) and "rows" in parsed:
                return parsed["rows"]
    return []


async def main():
    print("=== 1. Row count ===")
    result = await mcp_client.select("cortex", "runbooks", columns="count(*) AS n")
    rows = _rows_from_result(result)
    print(f"runbooks table row count: {rows[0]['n'] if rows else '???'}")

    print("\n=== 2. S3 objects present ===")
    result = await mcp_client.select("cortex", "runbooks", columns="title, source_s3_key")
    for row in _rows_from_result(result):
        key = row["source_s3_key"]
        try:
            s3_client._get_client().head_object(Bucket=s3_client.bucket_name(), Key=key)
            print(f"  OK    {key}")
        except Exception as e:
            print(f"  FAIL  {key}  ({e})")

    print("\n=== 3. Semantic relevance of vector search ===")
    for query_text, service_hint, expected_substring in RELEVANCE_CHECKS:
        embedding = embed_text(query_text)
        vector_literal = mcp_client.format_vector(embedding)
        result = await mcp_client.select(
            "cortex", "runbooks",
            columns="title, service_name",
            extra_sql=f"ORDER BY embedding <-> {vector_literal} LIMIT 3",
        )
        matches = _rows_from_result(result)
        top = matches[0]["title"] if matches else None
        passed = top is not None and expected_substring.lower() in top.lower()
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] query={query_text!r}")
        print(f"           top match: {top!r} (expected to contain {expected_substring!r})")
        print(f"           all 3: {[m['title'] for m in matches]}")


if __name__ == "__main__":
    asyncio.run(main())