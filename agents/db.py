import os, uuid
import asyncpg

async def get_pool():
    return await asyncpg.create_pool(
        host=os.environ["CRDB_HOST"], port=26257,
        user=os.environ["CRDB_AGENT_USER"],
        password=os.environ["CRDB_AGENT_PASSWORD"],
        database="cortex", ssl="require",
        min_size=1, max_size=2,
    )

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
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE incidents SET status=$3, updated_at=now()
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

async def _audit(conn, tool_name, agent_name, instance_id, incident_id, success, error=None):
    await conn.execute("""
        INSERT INTO mcp_audit_log
            (mcp_tool_name, agent_name, agent_instance_id, incident_id, success, error_message)
        VALUES ($1,$2,$3,$4,$5,$6)
    """, tool_name, agent_name, instance_id, incident_id, success, error)
