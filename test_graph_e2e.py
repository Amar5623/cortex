import asyncio
import json
from dotenv import load_dotenv
load_dotenv()
import agents.mcp_client
from agents.graph import run_incident


async def main():
    alert = {
        "fingerprint": "svc-checkout-5xx-spike",
        "title": "Checkout service 5xx error spike",
        "service_name": "checkout",
        "severity": "sev2",
        "origin_region": "us-east-1",
    }
    final_state = await run_incident(alert, agent_instance_id="local-test-1", agent_region="us-east-1")
    print(json.dumps(final_state, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())