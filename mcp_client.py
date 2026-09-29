"""MCP client wrapper around the official Filesystem MCP server.

Launches @modelcontextprotocol/server-filesystem over stdio via npx,
sandboxed to ./output only, using the official MCP Python SDK
(mcp.client.stdio + mcp.ClientSession). This project does not write
a custom MCP server and does not hardcode tool names - available
tools are listed at connection time and used by their real names.

Filled in during Step 2 (connect, list_tools, standalone write/read-back
test) and Step 6 (wired into the approved-items write flow).
"""

# TODO (Step 2): StdioServerParameters, stdio_client, ClientSession,
#   initialize(), list_tools() printed to console, one write+read-back test.
# TODO (Step 6): call_tool() for approved items, error handling on failure.
