import os
import uuid
import asyncpg

# Per-role SQL credentials for the direct-connection layer (the handful of
# UPDATEs the Managed MCP Server can't do — see db/grants.sql). Each role
# only has the UPDATE grants it legitimately needs; remediation_agent is
# the only one with any grant on incident_locks. Passwords live in .env as
# <ROLE_NAME_UPPER>_PASSWORD, e.g. TRIAGE_AGENT_PASSWORD.
VALID_ROLES = {"triage_agent", "runbook_agent", "remediation_agent", "postmortem_agent"}

_pools: dict[str, asyncpg.Pool] = {}


async def get_pool(role: str) -> asyncpg.Pool:
    """Get (or lazily create) a connection pool authenticated as the given
    SQL role. Pools are cached per-role per-process so a warm Lambda
    instance reuses connections across invocations instead of reconnecting
    every time."""
    if role not in VALID_ROLES:
        raise ValueError(f"unknown role {role!r}, expected one of {VALID_ROLES}")
    if role not in _pools:
        password_env = f"{role.upper()}_PASSWORD"
        _pools[role] = await asyncpg.create_pool(
            host=os.environ["CRDB_HOST"], port=26257,
            user=role,
            password=os.environ[password_env],
            database="cortex", ssl="require",
            min_size=1, max_size=2,
        )
    return _pools[role]


async def acquire_or_steal_lock(pool, incident_id, agent_name, instance_id, region):
    token = uuid.uuid4()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incident_locks
            SET locked_by_agent=$2, locked_by_instance=$3, locked_by_region=$4,
                lock_token=$5, acquired_at=now(),
                lease_expires_at=now() + interval '20 seconds', released_at=NULL
            WHERE incident_id=$1 AND (locked_by_agent IS NULL OR lease_expires_at < now())
            RETURNING lock_token
        """, incident_id, agent_name, instance_id, region, token)
        await _audit(conn, "acquire_or_steal_lock", agent_name, instance_id, incident_id, row is not None)
        return token if row else None


async def renew_lock(pool, incident_id, token):
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incident_locks SET lease_expires_at = now() + interval '20 seconds'
            WHERE incident_id=$1 AND lock_token=$2
            RETURNING lock_token
        """, incident_id, token)
        return row is not None


async def fenced_status_update(pool, incident_id, token, new_status):
    """Status transition guarded by a still-valid lock token. Only usable
    while a lock is held (i.e. by remediation_agent, between acquire and
    release) -- a revived/zombie instance holding a stale token structurally
    cannot mutate authoritative state this way.

    When new_status='resolved', also stamps incidents.resolved_at -- the
    schema has this column specifically for that transition, and it was
    previously being left NULL forever since nothing set it."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incidents
            SET status=$3, updated_at=now(),
                resolved_at = CASE WHEN $3='resolved' THEN now() ELSE resolved_at END
            WHERE incident_id=$1 AND EXISTS (
                SELECT 1 FROM incident_locks
                WHERE incident_id=$1 AND lock_token=$2 AND released_at IS NULL
            )
            RETURNING incident_id
        """, incident_id, token, new_status)
        return row is not None


async def release_lock(pool, incident_id, token):
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE incident_locks SET released_at = now()
            WHERE incident_id=$1 AND lock_token=$2
        """, incident_id, token)


async def set_status(pool, incident_id, agent_name, instance_id, expected_current, new_status):
    """Unfenced status transition for stages that happen BEFORE any lock is
    held (open->triaging->diagnosing, done inside merge_node where only one
    writer is ever active -- see agents/graph.py for why this is safe to
    call without a lock token). Conditional on expected_current so a
    duplicate/late call is a harmless no-op rather than clobbering a status
    set by a later stage.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incidents SET status=$3, updated_at=now()
            WHERE incident_id=$1 AND status=$2
            RETURNING incident_id
        """, incident_id, expected_current, new_status)
        await _audit(conn, f"set_status:{expected_current}->{new_status}",
                     agent_name, instance_id, incident_id, row is not None)
        return row is not None


async def close_incident(pool, incident_id, agent_name, instance_id):
    """postmortem_agent's final transition: resolved -> closed. No lock
    token involved -- the lock was already released by remediation_agent
    once the incident reached 'resolved', so this is conditional on status
    alone, same pattern as set_status()."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incidents SET status='closed', updated_at=now()
            WHERE incident_id=$1 AND status='resolved'
            RETURNING incident_id
        """, incident_id)
        await _audit(conn, "close_incident", agent_name, instance_id, incident_id, row is not None)
        return row is not None


async def _audit(conn, tool_name, agent_name, instance_id, incident_id, success, error=None):
    await conn.execute("""
        INSERT INTO mcp_audit_log
            (mcp_tool_name, agent_name, agent_instance_id, incident_id, success, error_message)
        VALUES ($1,$2,$3,$4,$5,$6)
    """, tool_name, agent_name, instance_id, incident_id, success, error)