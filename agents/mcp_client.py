import os
import json
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from datetime import datetime, date
from decimal import Decimal
from uuid import UUID

MCP_URL = os.environ.get("CRDB_MCP_ENDPOINT", "https://cockroachlabs.cloud/mcp")

def _headers():
    return {
        "mcp-cluster-id": os.environ.get("CRDB_CLUSTER_ID", ""),
        "Authorization": f"Bearer {os.environ.get('CRDB_MCP_API_KEY', '')}",
    }

async def mcp_call(tool_name: str, arguments: dict):
    async with streamablehttp_client(MCP_URL, headers=_headers()) as (read, write, *_):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.call_tool(tool_name, arguments)

async def list_available_tools():
    async with streamablehttp_client(MCP_URL, headers=_headers()) as (read, write, *_):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.list_tools()


# --- Safe SQL-string builder ---
# select_query / insert_rows both take a literal SQL string as `query` —
# there's no bind-parameter array, so every value we interpolate has to be
# escaped here, not left to the caller.

class Raw(str):
    """Marks a string as already a safe, fully-formed SQL literal — passed
    through verbatim by sql_literal() instead of quote-escaped like a plain
    string. Used for values that need a specific non-default literal
    syntax, e.g. format_vector()'s output when inserting into a VECTOR
    column (a plain list would otherwise be rendered as ARRAY[...] by the
    list/tuple branch below, which is the wrong SQL type)."""
    pass


def sql_literal(value) -> str:
    """Render a Python value as a safe SQL literal for embedding into a
    query string sent through select_query/insert_rows. Not for vectors —
    use format_vector() wrapped in Raw() for those, deliberately, so a
    plain float list can't get silently reinterpreted as a generic array."""
    if isinstance(value, Raw):
        return str(value)
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    if isinstance(value, UUID):
        return f"'{value}'"
    if isinstance(value, (datetime, date)):
        return f"'{value.isoformat()}'"
    if isinstance(value, dict):
        # JSONB columns: serialize then quote as a string literal; Cockroach
        # implicitly casts a string literal to JSONB when the target column
        # is JSONB, so no explicit ::JSONB cast is needed here.
        escaped = json.dumps(value).replace("'", "''")
        return f"'{escaped}'"
    if isinstance(value, (list, tuple)):
        items = ", ".join(sql_literal(v) for v in value)
        return f"ARRAY[{items}]"
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def format_vector(embedding) -> str:
    """Format a 384-dim all-MiniLM-L6-v2 embedding as a CockroachDB vector
    literal: a quoted string like '[0.1,0.2,...]'. Wrap the result in Raw()
    before passing to insert() so sql_literal() doesn't re-escape it as a
    plain string or reinterpret it as ARRAY[...]."""
    if len(embedding) != 384:
        raise ValueError(f"expected a 384-dim embedding, got {len(embedding)}")
    formatted = ",".join(f"{float(x):.8f}" for x in embedding)
    return f"'[{formatted}]'"


async def select(database: str, table: str, where: dict | None = None,
                  columns: str = "*", extra_sql: str = ""):
    """SELECT via the select_query MCP tool.
    where: dict of column -> value, ANDed as equality checks (each value
      goes through sql_literal, so it's safe against injection).
    extra_sql: raw SQL appended verbatim after WHERE (ORDER BY, LIMIT,
      vector <-> distance clauses, etc.) — this is caller-controlled code,
      not end-user input, so it's not auto-escaped. If both `where` and
      `extra_sql` are used together, extra_sql must start with a boolean
      connective (e.g. "AND ...") to chain onto the WHERE clause, or with
      a clause keyword (ORDER BY / LIMIT) if `where` alone already forms a
      complete WHERE."""
    query = f"SELECT {columns} FROM {table}"
    if where:
        conditions = " AND ".join(f"{col} = {sql_literal(val)}" for col, val in where.items())
        query += f" WHERE {conditions}"
    if extra_sql:
        query += f" {extra_sql}"
    return await mcp_call("select_query", {"database": database, "query": query})


async def insert(database: str, table: str, rows: list[dict]):
    """INSERT via the insert_rows MCP tool. rows must all share the same
    set of columns. Wrap any VECTOR-column value in Raw(format_vector(...))
    before passing it in here."""
    if not rows:
        raise ValueError("insert() called with no rows")
    columns = list(rows[0].keys())
    for r in rows:
        if set(r.keys()) != set(columns):
            raise ValueError("all rows must have the same columns")
    col_list = ", ".join(columns)
    values_clauses = [
        "(" + ", ".join(sql_literal(r[c]) for c in columns) + ")"
        for r in rows
    ]
    query = f"INSERT INTO {table} ({col_list}) VALUES {', '.join(values_clauses)}"
    return await mcp_call("insert_rows", {"database": database, "query": query})