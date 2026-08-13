import os
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

MCP_URL = "https://cockroachlabs.cloud/mcp"

def _headers():
    return {
        "mcp-cluster-id": os.environ["CRDB_CLUSTER_ID"],
        "Authorization": f"Bearer {os.environ['CRDB_MCP_API_KEY']}",
    }

async def mcp_call(tool_name: str, arguments: dict):
    async with streamablehttp_client(MCP_URL, headers=_headers()) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.call_tool(tool_name, arguments)

async def list_available_tools():
    async with streamablehttp_client(MCP_URL, headers=_headers()) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.list_tools()
