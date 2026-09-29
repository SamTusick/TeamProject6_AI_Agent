"""MCP client wrapper around the official Filesystem MCP server.

Launches @modelcontextprotocol/server-filesystem over stdio via npx,
sandboxed to ./output only, using the official MCP Python SDK
(mcp.client.stdio + mcp.ClientSession). This project does not write
a custom MCP server, and it does not blindly hardcode tool names -
list_tools() is called first and its results are printed and used to
look up the real tool names before any call_tool().

Run this file directly for a standalone connect + list_tools +
write + read-back smoke test:

    python mcp_client.py
"""

import asyncio
import shutil
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# The MCP filesystem server is sandboxed to exactly this directory.
# Never pass the repo root or a home directory here.
OUTPUT_DIR = (Path(__file__).parent / "output").resolve()


def build_server_params() -> StdioServerParameters:
    """Describe the filesystem MCP server subprocess (not launched yet)."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    # On Windows, npx is a .cmd shim, not a .exe. asyncio's subprocess
    # launcher does not go through a shell, so a plain command="npx"
    # can fail to be found even though it works fine in a terminal.
    # Resolving the real executable path with shutil.which() sidesteps that.
    npx_path = shutil.which("npx")
    if npx_path is None:
        raise RuntimeError("npx not found on PATH. Is Node.js installed?")

    return StdioServerParameters(
        command=npx_path,
        args=["-y", "@modelcontextprotocol/server-filesystem", str(OUTPUT_DIR)],
    )


@asynccontextmanager
async def mcp_session():
    """Launch the filesystem server and yield an initialized ClientSession.

    Usage:
        async with mcp_session() as session:
            tools = await session.list_tools()
    """
    params = build_server_params()
    async with stdio_client(params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            yield session


async def list_tool_names(session: ClientSession) -> dict:
    """Print the server's advertised tools and return {name: Tool}."""
    result = await session.list_tools()
    print(f"[tool result] server advertises {len(result.tools)} tools:")
    for tool in result.tools:
        print(f"  - {tool.name}: {tool.description}")
    return {tool.name: tool for tool in result.tools}


async def call_tool_safely(session: ClientSession, name: str, arguments: dict):
    """Call a tool by name, printing the call and handling failures.

    Returns the joined text content on success, or None on failure
    (after printing the error) so callers can branch without crashing.
    """
    print(f"[tool call] {name}({arguments})")
    try:
        result = await session.call_tool(name, arguments)
    except Exception as exc:  # transport/protocol-level failure
        print(f"[tool result] ERROR calling '{name}': {exc}")
        return None

    text = "".join(
        block.text for block in result.content if getattr(block, "type", None) == "text"
    )
    if result.is_error:
        print(f"[tool result] tool reported an error: {text}")
        return None

    print(f"[tool result] {text}")
    return text


async def _standalone_smoke_test():
    """Step 2 check: connect, list tools, write a test file, read it back."""
    async with mcp_session() as session:
        tools = await list_tool_names(session)

        write_tool = "write_file"
        read_tool = "read_text_file"
        if write_tool not in tools or read_tool not in tools:
            print(
                f"[tool result] ERROR: expected '{write_tool}' and '{read_tool}' "
                f"in the advertised tool list above, but they weren't both found. "
                f"Check the printed names and update mcp_client.py to match."
            )
            sys.exit(1)

        await call_tool_safely(
            session,
            write_tool,
            {"path": str(OUTPUT_DIR / "smoke_test.txt"), "content": "hello from the MCP client"},
        )
        await call_tool_safely(
            session,
            read_tool,
            {"path": str(OUTPUT_DIR / "smoke_test.txt")},
        )


if __name__ == "__main__":
    asyncio.run(_standalone_smoke_test())
