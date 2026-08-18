#!/usr/bin/env python3
"""
trigger_incident.py — POST a synthetic alert to a Cortex Lambda region.

Matches agents/lambda_handler.py's @app.post("/incidents") exactly:
    payload keys used by ingest_node: fingerprint, title, service_name,
    severity, origin_region (optional, defaults to the handler's AWS_REGION).
incident_id is NOT sent — ingest_node generates it server-side (uuid4) and
returns it in the response body under result["incident_id"].

USAGE
-----
    export CORTEX_LAMBDA_URL_EAST="https://xeahnwt3lma4k6vter7xrrntx40ndmsp.lambda-url.us-east-1.on.aws"
    export CORTEX_LAMBDA_URL_WEST="https://yglq3yz45aja3y2m6asrplc6vu0azitk.lambda-url.us-west-2.on.aws"

    # first call — creates a NEW incident, prints its server-generated incident_id
    python scripts/trigger_incident.py --region east --fingerprint payments-api-oom

    # to test the "seen_before" triage path, reuse the same --fingerprint;
    # triage_node will find the prior incident_id via triage_node's own read
"""

import argparse
import json
import os
import sys

import requests

URLS = {
    "east": os.environ.get("CORTEX_LAMBDA_URL_EAST", "").rstrip("/"),
    "west": os.environ.get("CORTEX_LAMBDA_URL_WEST", "").rstrip("/"),
}
REGION_NAME = {"east": "us-east-1", "west": "us-west-2"}


def main():
    p = argparse.ArgumentParser(description="POST a synthetic alert to Cortex's /incidents endpoint.")
    p.add_argument("--region", choices=["east", "west"], required=True)
    p.add_argument("--service-name", default="payments-api")
    p.add_argument("--title", default=None, help="defaults to 'High memory usage — <service-name>'")
    p.add_argument("--severity", default="sev2", choices=["sev1", "sev2", "sev3", "sev4"])
    p.add_argument("--fingerprint", default=None, help="defaults to '<service-name>-oom'; reuse across calls to trigger the seen_before path")
    args = p.parse_args()

    url = URLS[args.region]
    if not url:
        env_name = "CORTEX_LAMBDA_URL_EAST" if args.region == "east" else "CORTEX_LAMBDA_URL_WEST"
        print(f"ERROR: {env_name} is not set.", file=sys.stderr)
        sys.exit(1)

    service_name = args.service_name
    payload = {
        "fingerprint": args.fingerprint or f"{service_name}-oom",
        "title": args.title or f"High memory usage — {service_name}",
        "service_name": service_name,
        "severity": args.severity,
        "origin_region": REGION_NAME[args.region],
    }

    endpoint = f"{url}/incidents"
    print(f"→ POST {endpoint}")
    print(f"  payload: {json.dumps(payload)}")
    try:
        resp = requests.post(endpoint, json=payload, timeout=30)
        print(f"← {resp.status_code}")
        try:
            body = resp.json()
            print(json.dumps(body, indent=2)[:2000])
            incident_id = (body.get("result") or {}).get("incident_id")
            if incident_id:
                print(f"\nincident_id: {incident_id}")
        except ValueError:
            print(resp.text[:500])
    except requests.exceptions.RequestException as e:
        print(f"✗ request failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()