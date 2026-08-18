"""
Cortex agent graph.

Flow:
    START -> ingest -> { triage, runbook } -> merge -> remediation -> postmortem -> END

Design notes (see project kickoff doc for full context):

- ingest_node runs alone, before the fan-out, specifically so incident_id
  exists and the incidents/incident_locks rows are committed before either
  parallel branch reads or references them. Doing this inside triage_node
  instead (with runbook_node racing it) risked an FK failure on
  incident_events.incident_id if runbook_node's branch reached the DB
  first in a given superstep.

- triage_node and runbook_node are BOTH READ-ONLY. This is deliberate: it's
  what actually makes them safe to run concurrently. All status-mutating
  writes those two stages need (open->triaging, triaging->diagnosing) are
  moved into merge_node, which by LangGraph's Pregel superstep semantics
  only runs once, after both predecessors have completed -- so those two
  UPDATEs execute sequentially with no concurrent writer. Putting them
  inside the parallel branches themselves would race: e.g. runbook_node's
  `UPDATE ... WHERE status='triaging'` could fire before triage_node's own
  `UPDATE ... WHERE status='open'` commits, matching 0 rows, silently
  losing the diagnosing transition.

- remediation_node is the only place a lock is acquired, and it acquires
  AFTER merge_node has already run (graph edges enforce this ordering) --
  never racing ahead of the parallel branches.

- No LangGraph checkpointer is configured (see build_graph() below). This
  is deliberate, not an oversight: the graph's own execution state is
  disposable. If a Lambda instance is killed mid-remediation, the resuming
  instance never tries to resume a LangGraph checkpoint -- it re-derives
  everything by reading the incident_locks/incidents rows fresh, because
  CockroachDB is the only durable memory here, not LangGraph. Wiring a
  CockroachDB-backed checkpointer would undercut this story, since it
  would just be regular checkpoint-replay instead of true agentic memory.

- Lock heartbeat (renew_lock) is NOT called from inside remediation_node.
  It belongs in the Lambda handler that wraps a single graph invocation,
  as a background task alongside whatever long-running remediation step is
  in flight -- not modeled in-graph, since a killed process takes any
  in-graph heartbeat loop down with it, which is exactly the point of the
  kill-and-recover demo moment.
"""

import uuid
from typing import TypedDict

from langgraph.graph import StateGraph, START, END

from agents import db
from agents import mcp_client
from agents.mcp_client import Raw
from agents.embeddings import embed_text
from agents import llm

# Shared mutable dict for the heartbeat side-channel. The Lambda handler
# creates this and passes it to run_incident(), which stores it here.
# remediation_node writes {pool, incident_id, token} into it after
# acquiring the lock, and clears it after releasing. The handler's
# background heartbeat loop reads from the same dict to call renew_lock.
# This works because Lambda runs one request per execution environment
# at a time (same event loop, same process).
_heartbeat_lock_state: dict | None = None


class IncidentState(TypedDict, total=False):
    # set by caller before invocation
    fingerprint: str
    title: str
    service_name: str
    severity: str
    origin_region: str
    raw_alert: dict
    agent_instance_id: str
    agent_region: str

    # set by ingest_node
    incident_id: str

    # set by triage_node
    seen_before: bool
    prior_incident_ids: list[str]

    # set by runbook_node
    matched_runbooks: list[dict]
    matched_postmortems: list[dict]

    # set by remediation_node
    lock_token: str | None
    remediation_notes: str | None

    # set by postmortem_node
    postmortem_id: str | None


def _rows_from_result(result) -> list[dict]:
    """Extraction of row dicts from select_query CallToolResult or direct fallback SQL results."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        if "rows" in result:
            return result["rows"]
        if "incidents" in result:
            return result["incidents"]
        return [result]
    import json as _json
    content = getattr(result, "content", None) or []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            try:
                parsed = _json.loads(text)
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict) and "rows" in parsed:
                return parsed["rows"]
    return []

async def ingest_node(state: IncidentState) -> dict:
    # Idempotent on fingerprint: if an incident with this fingerprint is
    # already open (not resolved/closed), reuse its incident_id instead of
    # minting a new one. This is what makes "retry the same alert against
    # a different region" actually contend for the SAME lock, instead of
    # silently creating a second, unlocked incident.
    existing = await mcp_client.select(
        "cortex", "incidents",
        where={"fingerprint": state["fingerprint"]},
        columns="incident_id",
        extra_sql="AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1",
    )
    existing_rows = _rows_from_result(existing)
    if existing_rows:
        incident_id = existing_rows[0]["incident_id"]
        await mcp_client.insert("cortex", "incident_events", [{
            "incident_id": incident_id,
            "agent_name": "ingest",
            "agent_instance_id": state["agent_instance_id"],
            "agent_region": state["agent_region"],
            "event_type": "incident_retriggered",
            "payload": {"fingerprint": state["fingerprint"]},
        }])
        return {"incident_id": incident_id}

    incident_id = str(uuid.uuid4())
    await mcp_client.insert("cortex", "incidents", [{
        "incident_id": incident_id,
        "fingerprint": state["fingerprint"],
        "title": state["title"],
        "service_name": state["service_name"],
        "severity": state["severity"],
        "status": "open",
        "origin_region": state["origin_region"],
        "raw_alert": state["raw_alert"],
    }])
    await mcp_client.insert("cortex", "incident_locks", [{
        "incident_id": incident_id,
        "locked_by_agent": None, "locked_by_instance": None, "locked_by_region": None,
        "lock_token": None, "acquired_at": None, "lease_expires_at": None, "released_at": None,
    }])
    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": incident_id,
        "agent_name": "ingest",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "incident_created",
        "payload": {"fingerprint": state["fingerprint"], "severity": state["severity"]},
    }])
    return {"incident_id": incident_id}

async def triage_node(state: IncidentState) -> dict:
    """Read-only for incident state -- no status writes here, see module
    docstring for why. Still writes its own live trace event to
    incident_events via the shared MCP service account (cortex-mcp-agent),
    the same mcp_client.insert() pattern ingest_node/merge_node already use
    in production -- this is not a per-agent SQL role write, so it needs no
    new grant in grants.sql."""
    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "triage",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "triage_started",
        "payload": {},
    }])
    result = await mcp_client.select(
        "cortex", "incidents",
        where={"fingerprint": state["fingerprint"]},
        extra_sql=f"AND incident_id != '{state['incident_id']}' ORDER BY created_at DESC LIMIT 5",
    )
    rows = _rows_from_result(result)
    prior_ids = [r["incident_id"] for r in rows]
    seen_before = len(prior_ids) > 0

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "triage",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "triage_completed",
        "payload": {"seen_before": seen_before, "prior_incident_ids": prior_ids},
    }])

    return {"seen_before": seen_before, "prior_incident_ids": prior_ids}

async def runbook_node(state: IncidentState) -> dict:
    """Read-only for incident state -- no status writes here, see module
    docstring. Vector search over runbooks and postmortems for relevant
    prior fixes, then writes its own live trace event the same way
    triage_node does."""
    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "runbook",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "runbook_started",
        "payload": {},
    }])
    query_text = f"{state['title']} {state['service_name']}"
    embedding = embed_text(query_text)
    vector_literal = mcp_client.format_vector(embedding)

    runbook_result = await mcp_client.select(
        "cortex", "runbooks",
        where={"service_name": state["service_name"]},
        columns="runbook_id, title, content",
        extra_sql=f"ORDER BY embedding <-> {vector_literal} LIMIT 3",
    )
    postmortem_result = await mcp_client.select(
        "cortex", "postmortems",
        columns="postmortem_id, incident_id, summary, root_cause, remediation_taken",
        extra_sql=f"ORDER BY embedding <-> {vector_literal} LIMIT 3",
    )
    matched_runbooks = _rows_from_result(runbook_result)
    matched_postmortems = _rows_from_result(postmortem_result)

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "runbook",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "runbook_completed",
        "payload": {"matched_runbook_ids": [r.get("runbook_id") for r in matched_runbooks]},
    }])

    return {
        "matched_runbooks": matched_runbooks,
        "matched_postmortems": matched_postmortems,
    }

async def merge_node(state: IncidentState) -> dict:
    """Single writer, runs once both triage_node and runbook_node have
    completed (Pregel superstep semantics). Safe place for the two
    status transitions that grants.sql assigns to triage_agent and
    runbook_agent -- doing them here, sequentially, is what avoids the
    race described in the module docstring."""
    triage_pool = await db.get_pool("triage_agent")
    await db.set_status(
        triage_pool, state["incident_id"], "triage_agent", state["agent_instance_id"],
        expected_current="open", new_status="triaging",
    )
    runbook_pool = await db.get_pool("runbook_agent")
    await db.set_status(
        runbook_pool, state["incident_id"], "runbook_agent", state["agent_instance_id"],
        expected_current="triaging", new_status="diagnosing",
    )
    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "merge",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "context_merged",
        "payload": {
            "seen_before": state.get("seen_before", False),
            "prior_incident_ids": state.get("prior_incident_ids", []),
            "matched_runbook_ids": [r.get("runbook_id") for r in state.get("matched_runbooks", [])],
            "matched_postmortem_ids": [p.get("postmortem_id") for p in state.get("matched_postmortems", [])],
        },
    }])
    return {}

async def remediation_node(state: IncidentState) -> dict:
    """Only node that touches incident_locks. Acquires the lock, moves
    status diagnosing->remediating, applies a Groq-generated remediation,
    then remediating->resolved. If the lock is already held by a live
    instance, this returns without acting -- no double-act."""
    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "remediation",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "remediation_lock_attempt",
        "payload": {},
    }])
    pool = await db.get_pool("remediation_agent")
    token = await db.acquire_or_steal_lock(
        pool, state["incident_id"], "remediation_agent",
        state["agent_instance_id"], state["agent_region"],
    )
    if token is None:
        await mcp_client.insert("cortex", "incident_events", [{
            "incident_id": state["incident_id"],
            "agent_name": "remediation",
            "agent_instance_id": state["agent_instance_id"],
            "agent_region": state["agent_region"],
            "event_type": "remediation_stood_down",
            "payload": {"reason": "lock held by another live instance"},
        }])
        return {"lock_token": None, "remediation_notes": "lock held by another live instance; not acting"}

    # Tell the handler's heartbeat loop what to renew. This dict is the
    # same object the handler created and passed to run_incident() —
    # mutating it here is visible to the heartbeat immediately.
    if _heartbeat_lock_state is not None:
        _heartbeat_lock_state["pool"] = pool
        _heartbeat_lock_state["incident_id"] = state["incident_id"]
        _heartbeat_lock_state["token"] = token

    await db.fenced_status_update(pool, state["incident_id"], token, "remediating")

    incident = {
        "title": state["title"],
        "service": state["service_name"],
        "severity": state["severity"],
    }
    remediation_notes = await llm.generate_remediation(
        incident,
        state.get("matched_runbooks", []),
        state.get("matched_postmortems", []),
        state.get("seen_before", False),
        state.get("prior_incident_ids", []),
    )

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "remediation",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "remediation_applied",
        "payload": {"notes": remediation_notes},
    }])

    await db.fenced_status_update(pool, state["incident_id"], token, "resolved")

    # Clean release on the normal (non-kill-demo) path -- without this the
    # lock only ever clears via the 20s lease timeout, which is correct
    # behavior for the kill-demo but wrong for every other successful run.
    await db.release_lock(pool, state["incident_id"], token)

    # Clear the heartbeat side-channel so the handler stops renewing.
    if _heartbeat_lock_state is not None:
        _heartbeat_lock_state.clear()

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "remediation",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "remediation_completed",
        "payload": {"remediation_notes": remediation_notes, "lock_token": str(token)},
    }])

    return {"lock_token": str(token), "remediation_notes": remediation_notes}

async def postmortem_node(state: IncidentState) -> dict:
    """Writes the postmortem (becomes searchable context for the next
    incident via runbook_node's vector search) and closes the incident.
    No lock token needed -- the lock was already released once remediation
    reached 'resolved', so this uses db.close_incident()'s plain
    status-conditional guard instead of fenced_status_update()."""
    if state.get("lock_token") is None:
        # remediation_node didn't act (lock contention) — nothing to
        # write a postmortem about yet.
        return {"postmortem_id": None}

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "postmortem",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "postmortem_started",
        "payload": {},
    }])

    events_result = await mcp_client.select(
        "cortex", "incident_events",
        where={"incident_id": state["incident_id"]},
        columns="event_type, payload, created_at",
        extra_sql="ORDER BY created_at ASC",
    )
    events = _rows_from_result(events_result)

    incident = {
        "title": state["title"],
        "service": state["service_name"],
        "severity": state["severity"],
    }
    postmortem_fields = await llm.generate_postmortem(incident, events)

    postmortem_id = str(uuid.uuid4())
    content = (
        f"{state['title']}\n\n"
        f"{postmortem_fields['summary']}\n\n"
        f"{state.get('remediation_notes', '')}"
    )
    embedding = embed_text(content)

    await mcp_client.insert("cortex", "postmortems", [{
        "postmortem_id": postmortem_id,
        "incident_id": state["incident_id"],
        "summary": postmortem_fields["summary"],
        "root_cause": postmortem_fields["root_cause"],
        "remediation_taken": state.get("remediation_notes", ""),
        "content": content,
        "embedding": Raw(mcp_client.format_vector(embedding)),
    }])

    pool = await db.get_pool("postmortem_agent")
    await db.close_incident(pool, state["incident_id"], "postmortem_agent", state["agent_instance_id"])

    await mcp_client.insert("cortex", "incident_events", [{
        "incident_id": state["incident_id"],
        "agent_name": "postmortem",
        "agent_instance_id": state["agent_instance_id"],
        "agent_region": state["agent_region"],
        "event_type": "postmortem_written",
        "payload": {"postmortem_id": postmortem_id},
    }])

    return {"postmortem_id": postmortem_id}

def build_graph() -> StateGraph:
    g = StateGraph(IncidentState)

    g.add_node("ingest", ingest_node)
    g.add_node("triage", triage_node)
    g.add_node("runbook", runbook_node)
    g.add_node("merge", merge_node)
    g.add_node("remediation", remediation_node)
    g.add_node("postmortem", postmortem_node)

    g.add_edge(START, "ingest")
    g.add_edge("ingest", "triage")
    g.add_edge("ingest", "runbook")
    g.add_edge("triage", "merge")
    g.add_edge("runbook", "merge")
    g.add_edge("merge", "remediation")
    g.add_edge("remediation", "postmortem")
    g.add_edge("postmortem", END)

    return g


async def run_incident(
    alert: dict,
    agent_instance_id: str,
    agent_region: str,
    lock_state: dict | None = None,
) -> IncidentState:
    """Entry point. alert must have: fingerprint, title, service_name,
    severity, and optionally origin_region (defaults to agent_region).

    lock_state: if provided, a mutable dict that remediation_node will
    populate with {pool, incident_id, token} while a lock is held, so
    the caller's heartbeat loop can call renew_lock. Cleared by
    remediation_node after the lock is released."""
    global _heartbeat_lock_state
    _heartbeat_lock_state = lock_state

    graph = build_graph()
    # No checkpointer passed — deliberate, see module docstring.
    compiled = graph.compile()

    initial_state: IncidentState = {
        "fingerprint": alert["fingerprint"],
        "title": alert["title"],
        "service_name": alert["service_name"],
        "severity": alert["severity"],
        "origin_region": alert.get("origin_region", agent_region),
        "raw_alert": alert,
        "agent_instance_id": agent_instance_id,
        "agent_region": agent_region,
    }
    try:
        final_state = await compiled.ainvoke(initial_state)
    finally:
        _heartbeat_lock_state = None
    return final_state