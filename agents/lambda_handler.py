"""
Cortex Lambda entrypoint.

Integration points with the rest of the codebase:

  from agents.graph import run_incident
      async def run_incident(
          alert: dict,
          agent_instance_id: str,
          agent_region: str,
          lock_state: dict | None = None,
      ) -> IncidentState

  from agents.db import renew_lock
      async def renew_lock(pool, incident_id, token) -> bool

The heartbeat side-channel works via a shared mutable `lock_state` dict:
this handler creates it and passes it to run_incident(). Inside the graph,
remediation_node writes {pool, incident_id, token} into it after acquiring
a lock, and clears it after releasing. The heartbeat loop here reads from
the same dict to call renew_lock(). This avoids putting the heartbeat
inside the graph (a killed process takes any in-graph heartbeat down with
it, which is the whole point of the kill-and-recover demo).
"""

import asyncio
import logging
import os
import uuid

from fastapi import FastAPI, HTTPException, Header, Request
from mangum import Mangum

from agents.graph import run_incident, _rows_from_result
from agents.db import renew_lock
from agents import mcp_client

logger = logging.getLogger("cortex.lambda_handler")
logger.setLevel(logging.INFO)

app = FastAPI()

# Lock lease is 20 seconds (confirmed in db.py acquire_or_steal_lock and
# renew_lock). Heartbeat at 8s = well under half the lease, so a single
# missed renewal doesn't let another instance steal a lock that's still
# legitimately in use.
HEARTBEAT_INTERVAL_SECONDS = 8

# AWS_REGION is set automatically by the Lambda runtime. Used as the
# agent_region for every invocation from this deployment.
AGENT_REGION = os.environ.get("AWS_REGION", "local")


async def _heartbeat_loop(lock_state: dict, stop_event: asyncio.Event) -> None:
    """Renews any lock held by this invocation until stop_event is set.

    Runs as a plain asyncio background task for the life of ONE request --
    it is created and torn down inside handle_incident(), never left running
    across invocations. See the try/finally below for why that matters.

    The lock_state dict is populated by remediation_node (via the
    side-channel in graph.py) only while a lock is actually held. Before
    that point and after release, the dict is empty, and this loop is a
    harmless no-op.
    """
    while not stop_event.is_set():
        pool = lock_state.get("pool")
        incident_id = lock_state.get("incident_id")
        token = lock_state.get("token")
        if pool and incident_id and token:
            try:
                await renew_lock(pool, incident_id, token)
            except Exception:
                # A single failed renewal shouldn't kill the whole request --
                # log it and let the next tick retry. If renewals fail repeatedly
                # for longer than the lease duration, the lock will legitimately
                # expire and another instance may steal it, which is correct
                # behavior, not a bug.
                logger.exception("heartbeat: renew_lock failed, retrying")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=HEARTBEAT_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass  # normal wakeup -- time for the next renewal


@app.post("/incidents")
async def handle_incident(request: Request):
    """
    One incident run per call. A fresh instance_id every invocation means two
    concurrently-warm containers handling two different requests can never
    renew or steal each other's locks.
    """
    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON payload: {e}")

    instance_id = str(uuid.uuid4())
    lock_state: dict = {}

    stop_event = asyncio.Event()
    heartbeat_task = asyncio.create_task(_heartbeat_loop(lock_state, stop_event))

    try:
        result = await run_incident(
            payload,
            agent_instance_id=instance_id,
            agent_region=AGENT_REGION,
            lock_state=lock_state,
        )
        return {"status": "ok", "instance_id": instance_id, "result": result}
    except Exception as e:
        logger.exception("Error executing incident graph")
        raise HTTPException(status_code=500, detail=f"Incident execution error: {e}")
    finally:
        stop_event.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass

@app.get("/incidents")
async def list_incidents():
    try:
        result = await mcp_client.select(
            "cortex", "incidents",
            columns="incident_id, fingerprint, title, service_name, severity, "
                    "status, origin_region, created_at, updated_at, resolved_at",
            extra_sql="ORDER BY created_at DESC LIMIT 25",
        )
        return {"incidents": _rows_from_result(result)}
    except Exception as e:
        logger.exception("list_incidents failed")
        return {"incidents": [], "error": str(e)}


@app.get("/incidents/{incident_id}")
async def get_incident(incident_id: str):
    """Main endpoint the React PipelineTrace polls while an incident is
    in flight -- incident row + full ordered event trace + lock row +
    postmortem, in one call."""
    try:
        incident_result = await mcp_client.select(
            "cortex", "incidents", where={"incident_id": incident_id},
        )
        incident_rows = _rows_from_result(incident_result)
        if not incident_rows:
            raise HTTPException(status_code=404, detail="incident not found")

        events_result = await mcp_client.select(
            "cortex", "incident_events", where={"incident_id": incident_id},
            columns="event_id, incident_id, seq, agent_name, agent_instance_id, agent_region, "
                     "event_type, payload, created_at",
            extra_sql="ORDER BY seq ASC",
        )
        lock_result = await mcp_client.select(
            "cortex", "incident_locks", where={"incident_id": incident_id},
        )
        postmortem_result = await mcp_client.select(
            "cortex", "postmortems", where={"incident_id": incident_id},
            extra_sql="ORDER BY created_at DESC LIMIT 1",
        )
        lock_rows = _rows_from_result(lock_result)
        postmortem_rows = _rows_from_result(postmortem_result)

        return {
            "incident": incident_rows[0],
            "events": _rows_from_result(events_result),
            "lock": lock_rows[0] if lock_rows else None,
            "postmortem": postmortem_rows[0] if postmortem_rows else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"get_incident failed for {incident_id}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/locks")
async def list_locks():
    try:
        result = await mcp_client.select(
            "cortex", "incident_locks",
            extra_sql="WHERE locked_by_agent IS NOT NULL ORDER BY acquired_at DESC LIMIT 25",
        )
        return {"locks": _rows_from_result(result)}
    except Exception as e:
        logger.exception("list_locks failed")
        return {"locks": [], "error": str(e)}


@app.get("/postmortems")
async def list_postmortems():
    try:
        result = await mcp_client.select(
            "cortex", "postmortems",
            columns="postmortem_id, incident_id, summary, root_cause, remediation_taken, created_at",
            extra_sql="ORDER BY created_at DESC LIMIT 10",
        )
        return {"postmortems": _rows_from_result(result)}
    except Exception as e:
        logger.exception("list_postmortems failed")
        return {"postmortems": [], "error": str(e)}


@app.get("/audit-log")
async def list_audit_log():
    try:
        result = await mcp_client.select(
            "cortex", "mcp_audit_log",
            columns="audit_id, occurred_at, mcp_tool_name, agent_name, agent_instance_id, "
                     "incident_id, success, error_message",
            extra_sql="ORDER BY occurred_at DESC LIMIT 40",
        )
        return {"audit_log": _rows_from_result(result)}
    except Exception as e:
        logger.exception("list_audit_log failed")
        return {"audit_log": [], "error": str(e)}


@app.get("/health")
async def health():
    return {"status": "alive", "region": AGENT_REGION}


mangum_handler = Mangum(app, lifespan="off")

def handler(event, context):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return mangum_handler(event, context)


# ------------------------------------------------------------------ #
# Admin endpoints — kill/restore a region from the browser            #
# ------------------------------------------------------------------ #

import boto3

ADMIN_KEY = os.environ.get("ADMIN_KEY", "")
MANAGED_REGIONS = ("us-east-1", "us-west-2")


def _require_admin(key: str | None):
    # Deliberately simple shared-secret check, same "known, intentional
    # shortcut" spirit as FunctionUrlConfig.Cors: "*" in template.yaml.
    # A real production version would use AWS_IAM auth on the Function URL
    # instead of an app-level header.
    if not ADMIN_KEY or key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="invalid or missing admin key")


@app.post("/admin/kill-region")
async def kill_region(request: Request, x_cortex_admin_key: str | None = Header(None)):
    _require_admin(x_cortex_admin_key)
    body = await request.json()
    region = body.get("region")
    if region not in MANAGED_REGIONS:
        raise HTTPException(status_code=400, detail=f"region must be one of {MANAGED_REGIONS}")
    client = boto3.client("lambda", region_name=region)
    client.put_function_concurrency(
        FunctionName=f"cortex-agent-{region}", ReservedConcurrentExecutions=0,
    )
    return {"status": "ok", "region": region, "action": "killed"}


@app.post("/admin/restore-region")
async def restore_region(request: Request, x_cortex_admin_key: str | None = Header(None)):
    _require_admin(x_cortex_admin_key)
    body = await request.json()
    region = body.get("region")
    if region not in MANAGED_REGIONS:
        raise HTTPException(status_code=400, detail=f"region must be one of {MANAGED_REGIONS}")
    client = boto3.client("lambda", region_name=region)
    try:
        client.delete_function_concurrency(FunctionName=f"cortex-agent-{region}")
    except Exception as e:
        logger.warning(f"delete_function_concurrency failed ({e}), setting ReservedConcurrentExecutions=10")
        client.put_function_concurrency(
            FunctionName=f"cortex-agent-{region}", ReservedConcurrentExecutions=10,
        )
    return {"status": "ok", "region": region, "action": "restored"}