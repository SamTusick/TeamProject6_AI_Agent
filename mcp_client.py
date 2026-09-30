"""MCP client wrapper around the official Filesystem MCP server.

Launches @modelcontextprotocol/server-filesystem over stdio (via node
against the locally installed copy, falling back to npx if it isn't
installed), sandboxed to ./output only, using the official MCP Python SDK
(mcp.client.stdio + mcp.ClientSession). This project does not write
a custom MCP server, and it does not blindly hardcode tool names -
list_tools() is called first and its results are printed and used to
look up the real tool names before any call_tool().

Run this file directly for a standalone connect + list_tools +
write + read-back smoke test:

    python mcp_client.py
"""

import asyncio
import json
import shutil
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.exceptions import MCPError

# The server subprocess's stdio pipe can close mid-request (surfacing as
# MCPError: Connection closed) without our code doing anything wrong -
# see build_server_params() for why the npx fallback path is especially
# prone to it. A small bounded retry absorbs that instead of failing the run.
MAX_MCP_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2


def _flatten_exceptions(exc_group: BaseExceptionGroup) -> list[BaseException]:
    """Recursively collect leaf exceptions out of nested ExceptionGroups.

    anyio's task-group teardown re-wraps a propagating exception in a new
    ExceptionGroup at each nested `async with`, so a single real error can
    arrive here several layers deep.
    """
    leaves: list[BaseException] = []
    for exc in exc_group.exceptions:
        if isinstance(exc, BaseExceptionGroup):
            leaves.extend(_flatten_exceptions(exc))
        else:
            leaves.append(exc)
    return leaves


# The MCP filesystem server is sandboxed to exactly this directory.
# Never pass the repo root or a home directory here.
OUTPUT_DIR = (Path(__file__).parent / "output").resolve()

# The server subprocess's stderr goes here rather than to the terminal -
# see mcp_session() for why that matters on Windows.
SERVER_LOG = Path(__file__).parent / "mcp_server.log"


# Populated by `npm install` from the pinned version in package.json.
LOCAL_SERVER_JS = (
    Path(__file__).parent
    / "node_modules"
    / "@modelcontextprotocol"
    / "server-filesystem"
    / "dist"
    / "index.js"
)


def build_server_params() -> StdioServerParameters:
    """Describe the filesystem MCP server subprocess (not launched yet).

    Prefers the locally installed server launched straight through node.
    Going through npx instead means Windows runs an npx.cmd batch shim
    under cmd.exe, which re-resolves the package on every launch (~8s vs
    ~1.4s here) and leaves an intermediate npm/cmd.exe parent that can
    exit and sever the stdio pipe mid-session, surfacing as
    'MCPError: Connection closed'. npx stays as a fallback so the agent
    still runs before anyone has done `npm install`.
    """
    OUTPUT_DIR.mkdir(exist_ok=True)

    if LOCAL_SERVER_JS.is_file():
        node_path = shutil.which("node")
        if node_path is None:
            raise RuntimeError("node not found on PATH. Is Node.js installed?")
        return StdioServerParameters(
            command=node_path,
            args=[str(LOCAL_SERVER_JS), str(OUTPUT_DIR)],
        )

    # On Windows, npx is a .cmd shim, not a .exe. asyncio's subprocess
    # launcher does not go through a shell, so a plain command="npx"
    # can fail to be found even though it works fine in a terminal.
    # Resolving the real executable path with shutil.which() sidesteps that.
    print("[tool call] node_modules not found - falling back to npx (run `npm install` to avoid this)")
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

    # The SDK otherwise hands the child process sys.stderr directly. Under
    # Git Bash/mintty that is an MSYS pseudo-terminal rather than a real
    # Windows handle, and the server dies on its first stderr write - which
    # happens while it answers initialize, so the session connects and then
    # drops on the very next request as 'MCPError: Connection closed'.
    # Pointing stderr at a regular file avoids that and keeps the server's
    # diagnostics, which are otherwise invisible.
    with open(SERVER_LOG, "a", encoding="utf-8") as errlog:
        async with stdio_client(params, errlog=errlog) as (read_stream, write_stream):
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


async def save_approved_items(items: list[dict]) -> bool:
    """Write approved items to output/action_items.json via a real MCP
    tool call, then read the file back through the server and print it
    to confirm the write round-tripped. Returns True on success.

    This function is only ever called by agent.py AFTER a human has
    approved each item in the CLI confirm step - the agent script
    decides when this runs, the model never does.
    """
    if not items:
        print("[tool call] skipped - no approved items to write")
        return False

    target = OUTPUT_DIR / "action_items.json"
    content = json.dumps(items, indent=2)

    for attempt in range(1, MAX_MCP_ATTEMPTS + 1):
        succeeded = False
        failure_reason = None

        try:
            async with mcp_session() as session:
                tools = await list_tool_names(session)

                write_tool = "write_file"
                read_tool = "read_text_file"
                if write_tool not in tools or read_tool not in tools:
                    print(
                        f"[tool result] ERROR: expected '{write_tool}' and '{read_tool}' "
                        f"in the advertised tool list above, but they weren't both found."
                    )
                    return False  # not retryable - the server doesn't have these tools

                # write_file always overwrites, so re-running this whole
                # session from scratch on a retry is safe and idempotent.
                # A failure here is recorded rather than raised: raising out of
                # this block would propagate through mcp_session's task groups,
                # which anyio re-wraps as an ExceptionGroup during teardown, so a
                # plain except clause below would never match it.
                write_result = await call_tool_safely(
                    session, write_tool, {"path": str(target), "content": content}
                )
                if write_result is None:
                    failure_reason = "write_file call failed (see [tool result] above)"
                else:
                    read_back = await call_tool_safely(session, read_tool, {"path": str(target)})
                    if read_back is None:
                        failure_reason = "read_text_file call failed (see [tool result] above)"
                    else:
                        succeeded = True
        except* MCPError as eg:
            failure_reason = "; ".join(str(exc) for exc in _flatten_exceptions(eg))

        if succeeded:
            print("[output] confirmed: action_items.json written and read back successfully")
            return True

        if attempt < MAX_MCP_ATTEMPTS:
            print(
                f"[tool result] MCP session failed (attempt {attempt}/{MAX_MCP_ATTEMPTS}): "
                f"{failure_reason}. Retrying in {RETRY_DELAY_SECONDS}s."
            )
            await asyncio.sleep(RETRY_DELAY_SECONDS)
        else:
            print(f"[output] write failed after {MAX_MCP_ATTEMPTS} attempts - approved items were NOT saved")
            return False

    return False


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
