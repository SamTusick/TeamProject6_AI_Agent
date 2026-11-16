"""Stand-in Jira MCP server for offline tests.

Mirrors mcp-atlassian's tool names and reply shapes: jira_create_issue and
jira_search_assignable_users, with failures reported the way the real
server does ({"success": false, ...} inside a normal result). Every call is
appended to the JSONL file named by FAKE_JIRA_LOG so tests can assert
exactly what the client sent.
"""

import json
import os

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

# Assignable members of project TP6. "Sam" is deliberately ambiguous.
PROJECT_USERS = [
    {"display_name": "Taylor Reed", "account_id": "712020:aaaaaaaa-0001", "email": "taylor@school.edu"},
    {"display_name": "Morgan Lee", "account_id": "712020:aaaaaaaa-0002", "email": ""},
    {"display_name": "Sam Tusick", "account_id": "712020:aaaaaaaa-0003", "email": ""},
    {"display_name": "Sam Tusick", "account_id": "712020:aaaaaaaa-0005", "email": ""},
    {"display_name": "Sam Rivera", "account_id": "712020:aaaaaaaa-0004", "email": ""},
    # Listed, but Jira refuses to assign to them (e.g. lost permission).
    {"display_name": "Riley Blocked", "account_id": "712020:aaaaaaaa-0009", "email": ""},
]
server = MCPServer("fake-jira")
counter = {"n": 0}


def log(tool: str, args: dict) -> None:
    with open(os.environ["FAKE_JIRA_LOG"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"tool": tool, "args": args}) + "\n")


@server.tool()
def jira_search_assignable_users(query: str, project_key: str | None = None,
                                 issue_key: str | None = None, limit: int = 20) -> str:
    """Search users assignable in a project."""
    log("jira_search_assignable_users", {"query": query, "project_key": project_key})
    if project_key != "TP6":
        return json.dumps({"success": False, "error": "project not found", "query": query})
    q = query.casefold()
    users = [u for u in PROJECT_USERS
             if q in u["display_name"].casefold() or (u["email"] and q in u["email"].casefold())]
    return json.dumps({"success": True, "count": len(users[:limit]), "users": users[:limit]})


@server.tool()
def jira_get_all_projects(include_archived: bool = False) -> str:
    """List projects visible to the account."""
    return json.dumps([{"key": "TP6", "name": "Team Project 6"}, {"key": "OTH", "name": "Other"}])


@server.tool()
def jira_create_issue(
    project_key: str,
    summary: str,
    issue_type: str,
    assignee: str | None = None,
    description: str | None = None,
    components: str | None = None,
    additional_fields: str | dict | None = None,
) -> str:
    """Create a new Jira issue."""
    # The SDK pre-parses JSON strings, so normalize to a dict for the log.
    if isinstance(additional_fields, str):
        additional_fields = json.loads(additional_fields)
    log("jira_create_issue", {
        "project_key": project_key, "summary": summary, "issue_type": issue_type,
        "assignee": assignee, "description": description, "additional_fields": additional_fields,
    })
    if summary == "FAIL":
        raise ToolError("Field 'summary' is invalid")
    if assignee == "712020:aaaaaaaa-0009":
        raise ToolError("User 'Riley Blocked' cannot be assigned issues.")
    counter["n"] += 1
    return json.dumps({"message": "Issue created successfully",
                       "issue": {"key": f"{project_key}-{counter['n']}", "summary": summary}})


if __name__ == "__main__":
    server.run("stdio")
