"""Desktop bridge for Jira task assignment (stdin JSON -> stdout JSON).

    {"action": "status"}
        -> {"configured": bool, "missing": [...], "serverInstalled": bool,
            "site": str|null, "project": str|null}
        Reads .env only; never contacts Jira.

    {"action": "create", "meeting": "title", "items": [{"id": ..., ...}]}
        -> {"results": [{"id", "title", "key", "assignee", "error"}]}

All tracing from jira_client goes to stderr so stdout stays one JSON line.
The API token is never echoed back to the app.
"""

import asyncio
import contextlib
import json
import sys


def status() -> dict:
    import jira_client

    import os
    import shutil

    missing = jira_client.missing_config()
    exe = jira_client.ROOT / ".venv-jira" / ("Scripts/mcp-atlassian.exe" if os.name == "nt" else "bin/mcp-atlassian")
    installed = bool(os.getenv("JIRA_MCP_COMMAND") or exe.is_file() or shutil.which("mcp-atlassian"))

    return {
        "configured": not missing and installed,
        "missing": missing,
        "serverInstalled": installed,
        "site": os.getenv("JIRA_URL") or None,
        "project": os.getenv("JIRA_PROJECT_KEY") or None,
    }


async def create(request: dict) -> dict:
    from jira_client import assign_items_in_jira

    items = [item for item in request.get("items") or [] if isinstance(item, dict)]
    if not items:
        raise ValueError("No approved items to send to Jira.")
    results = await assign_items_in_jira(items, meeting=request.get("meeting") or None)
    for item, result in zip(items, results):
        result["id"] = item.get("id")
    return {"results": results}


def main() -> None:
    try:
        request = json.loads(sys.stdin.read())
        with contextlib.redirect_stdout(sys.stderr):
            if request.get("action") == "status":
                result = status()
            elif request.get("action") == "create":
                result = asyncio.run(create(request))
            else:
                raise ValueError("Unknown Jira action.")
        print(json.dumps(result))
    except Exception as error:
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else (
            f"Jira request failed ({type(error).__name__}). See jira_mcp_server.log.")
        # anyio wraps failures from inside the MCP session in an ExceptionGroup.
        if isinstance(error, BaseExceptionGroup):
            leaf = error
            while isinstance(leaf, BaseExceptionGroup):
                leaf = leaf.exceptions[0]
            message = f"Jira MCP server error ({type(leaf).__name__}): {str(leaf)[:200]}"
        print(json.dumps({"error": message}))
        sys.exit(1)


if __name__ == "__main__":
    main()
