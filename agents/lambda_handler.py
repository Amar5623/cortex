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

from fastapi import FastAPI, Request
from mangum import Mangum

from agents.graph import run_incident
from agents.db import renew_lock

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
    payload = await request.json()
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
    finally:
        # CRITICAL: stop and await the heartbeat before the handler returns.
        # Lambda freezes the execution environment immediately after the
        # response is sent -- anything still running gets frozen mid-task,
        # and on a reused warm container that frozen task can resume in a
        # confusing state on the *next* invocation. Always tear it down here,
        # never rely on it dying naturally.
        stop_event.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass


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