"""Jira task assignment through a Jira MCP server.

Approved action items become Jira issues assigned to the person named in
the meeting. Like mcp_client.py, this talks to an off-the-shelf MCP server
over stdio with the official MCP Python SDK and never hardcodes a tool
blindly: list_tools() runs first, the required tool must be advertised,
and only arguments the tool's input schema declares are sent.

Default server: mcp-atlassian (https://github.com/sooperset/mcp-atlassian),
which authenticates with an Atlassian API token, so no browser OAuth flow
is needed. Install it into its own venv so its dependencies never clash
with this project's pinned `mcp` version:

    python -m venv .venv-jira
    .venv-jira/Scripts/pip install mcp-atlassian==0.24.6

Configuration (.env):
    JIRA_URL            https://your-site.atlassian.net
    JIRA_USERNAME       the Atlassian account email that owns the token
    JIRA_API_TOKEN      https://id.atlassian.com/manage-profile/security/api-tokens
    JIRA_PROJECT_KEY    project the issues are created in, e.g. TP6
    JIRA_ISSUE_TYPE     optional, default "Task"
    JIRA_USER_MAP       optional, "Sam=Samuel Tusick;Jo=712020:..." maps a name
                        said in meetings to a Jira display name/email/account ID
    JIRA_MCP_COMMAND    optional, override the server launcher (space-separated)

Safety: this is only called with items a human already approved. Owners
are matched only against users assignable in JIRA_PROJECT_KEY, and only on
an unambiguous name match; anyone else gets an unassigned issue.

Smoke test (lists the server's tools and the project's assignable users with
their account IDs, creates nothing; --projects also lists every visible space):
    python jira_client.py [--projects]
"""

import asyncio
import json
import os
import re
import shlex
import shutil
import sys
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

try:
    from dotenv import load_dotenv
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ModuleNotFoundError as exc:
    # Usual cause: running this with .venv-jira's Python. That venv only
    # hosts the server; this client runs on the project .venv.
    sys.exit(f"{exc}. Run this with the project venv, e.g. `.venv/Scripts/python jira_client.py` "
             "(.venv-jira only holds the mcp-atlassian server, which this script starts itself).")

load_dotenv()

ROOT = Path(__file__).parent
SERVER_LOG = ROOT / "jira_mcp_server.log"
CREATE_TOOL = "jira_create_issue"
SEARCH_TOOL = "jira_search_assignable_users"
PROJECTS_TOOL = "jira_get_all_projects"  # setup diagnostics only
REQUIRED_ENV = ("JIRA_URL", "JIRA_USERNAME", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY")
ISO_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


class JiraConfigError(RuntimeError):
    """Raised before any server launch when Jira isn't configured."""


def missing_config() -> list[str]:
    return [name for name in REQUIRED_ENV if not os.getenv(name)]


def build_server_params() -> StdioServerParameters:
    """Describe the Jira MCP server subprocess (not launched yet)."""
    missing = missing_config()
    if missing:
        raise JiraConfigError(f"Jira is not configured; set {', '.join(missing)} in .env")

    override = os.getenv("JIRA_MCP_COMMAND")
    if override:
        # Non-POSIX mode keeps Windows backslashes but also keeps the quotes.
        parts = [p.strip('"') for p in shlex.split(override, posix=os.name != "nt")]
        command, args = parts[0], parts[1:]
    else:
        scripts = "Scripts" if os.name == "nt" else "bin"
        exe = ROOT / ".venv-jira" / scripts / ("mcp-atlassian.exe" if os.name == "nt" else "mcp-atlassian")
        found = str(exe) if exe.is_file() else shutil.which("mcp-atlassian")
        if not found:
            raise JiraConfigError(
                "mcp-atlassian not found. Install it with: python -m venv .venv-jira && "
                ".venv-jira/Scripts/pip install mcp-atlassian==0.24.6"
            )
        command, args = found, []

    # Pass the full environment (Windows needs SYSTEMROOT etc.) plus the
    # server's own settings. Only Jira tools are needed, never Confluence.
    env = dict(os.environ)
    env["JIRA_URL"] = env["JIRA_URL"].strip().rstrip("/")
    env.setdefault("ENABLED_TOOLS", f"{CREATE_TOOL},{SEARCH_TOOL},{PROJECTS_TOOL}")
    env.setdefault("READ_ONLY_MODE", "false")
    return StdioServerParameters(command=command, args=args, env=env)


@asynccontextmanager
async def jira_session():
    """Launch the Jira MCP server and yield an initialized ClientSession.

    stderr goes to a log file for the same mintty reason as mcp_client.py.
    """
    params = build_server_params()
    with open(SERVER_LOG, "a", encoding="utf-8") as errlog:
        async with stdio_client(params, errlog=errlog) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                yield session


def parse_user_map(raw: str | None) -> dict[str, str]:
    """'Sam=Samuel Tusick; Jo=712020:abc...' -> {'sam': 'Samuel Tusick', ...}.

    Values may be a Jira display name, email or account ID. Entries whose
    value is still the .env.example placeholder (example.com) are ignored.
    """
    mapping = {}
    for pair in (raw or "").split(";"):
        if "=" in pair:
            name, user = pair.split("=", 1)
            name, user = name.strip(), user.strip()
            if name and user and not user.lower().endswith("@example.com"):
                mapping[normalize_name(name)] = user
    return mapping


def normalize_name(text: str) -> str:
    """Case-, accent- and whitespace-insensitive form used for name matching."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(plain.casefold().split())


ACCOUNT_ID = re.compile(r"^(?:[0-9a-f]{24}|\d+:[0-9a-f-]{8,})$", re.IGNORECASE)


def _field(user: dict, *names: str) -> str:
    for name in names:
        value = user.get(name)
        if isinstance(value, str) and value:
            return value
    return ""


def parse_users(text: str) -> list[dict]:
    """Normalize a search_assignable_users reply to [{name, account_id, email}].

    mcp-atlassian reports failures as {"success": false, ...} inside a normal
    (non-error) tool result, so success has to be read from the JSON itself.
    """
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(data, dict) and data.get("success") is False:
        return []
    raw = data.get("users") if isinstance(data, dict) else data
    users = []
    for user in raw if isinstance(raw, list) else []:
        if not isinstance(user, dict):
            continue
        account_id = _field(user, "account_id", "accountId", "id")
        if account_id:
            users.append({
                "name": _field(user, "display_name", "displayName", "name"),
                "account_id": account_id,
                "email": _field(user, "email", "emailAddress"),
            })
    return users


def match_owner(owner: str, users: list[dict]) -> dict | None:
    """Pick the one assignable user the meeting meant, or None.

    1. exactly one user whose display name (or email) equals the spoken name;
    2. otherwise, for a single spoken word like "Taylor", exactly one user
       whose first name is that word.
    Zero or several candidates -> None, so the issue is left unassigned
    instead of going to the wrong person.
    """
    wanted = normalize_name(owner)
    if not wanted:
        return None
    exact = [u for u in users if wanted in (normalize_name(u["name"]), normalize_name(u["email"]))]
    if len(exact) == 1:
        return exact[0]
    if exact or " " in wanted:
        return None
    first = [u for u in users if normalize_name(u["name"]).split(" ")[0] == wanted]
    return first[0] if len(first) == 1 else None


def build_description(item: dict, meeting: str | None) -> str:
    lines = [
        "Action item approved from a meeting by the Meeting Action Agent.",
        "",
        f"Owner (as said in the meeting): {item.get('owner') or 'not stated'}",
        f"Deadline (as said in the meeting): {item.get('deadline') or 'not stated'}",
    ]
    if meeting:
        lines.append(f"Meeting: {meeting}")
    lines += ["", "Source quote (verified verbatim against the transcript):",
              f"{{quote}}{item.get('quote', '')}{{quote}}", "",
              f"Why it was classified {item.get('classification')}: {item.get('reasoning', '')}"]
    return "\n".join(lines)


def build_create_arguments(item: dict, schema: dict, assignee: str | None, meeting: str | None) -> dict:
    """Arguments for jira_create_issue, filtered to what the tool declares."""
    extra: dict = {"labels": ["meeting-action-agent"]}
    # Only a deadline already in ISO form becomes a due date; "next Tuesday"
    # stays in the description rather than being guessed into a date.
    match = ISO_DATE.search(item.get("deadline") or "")
    if match:
        extra["duedate"] = match.group(1)

    candidate = {
        "project_key": os.getenv("JIRA_PROJECT_KEY"),
        "summary": (item.get("title") or "Meeting action item")[:250],
        "issue_type": os.getenv("JIRA_ISSUE_TYPE", "Task"),
        "description": build_description(item, meeting),
        "assignee": assignee,
        "additional_fields": json.dumps(extra),
    }
    properties = (schema or {}).get("properties") or {}
    if properties:
        if "additional_fields" in properties and properties["additional_fields"].get("type") == "object":
            candidate["additional_fields"] = extra
        candidate = {k: v for k, v in candidate.items() if k in properties}
    return {k: v for k, v in candidate.items() if v is not None}


def _text(result) -> str:
    return "".join(b.text for b in result.content if getattr(b, "type", None) == "text")


def parse_issue_key(text: str) -> str | None:
    """Pull the created issue key out of the server's reply (JSON or prose)."""
    try:
        data = json.loads(text)
        for path in (("issue", "key"), ("key",)):
            node = data
            for part in path:
                node = node.get(part) if isinstance(node, dict) else None
            if isinstance(node, str):
                return node
    except (json.JSONDecodeError, AttributeError):
        pass
    match = re.search(r"\b([A-Z][A-Z0-9_]+-\d+)\b", text)
    return match.group(1) if match else None


async def resolve_assignee(session: ClientSession, owner: str, tools: dict,
                           user_map: dict) -> dict | None:
    """Find the project member an owner name refers to: {name, account_id} or None.

    Only users assignable in JIRA_PROJECT_KEY are considered, and the issue
    is then created with their account ID. A raw name is never handed to
    jira_create_issue: mcp-atlassian falls back to "first user the search
    returns" for names it can't match exactly, which could be anyone.
    """
    term = user_map.get(normalize_name(owner)) or owner.strip()
    if ACCOUNT_ID.match(term):
        return {"name": owner, "account_id": term}  # set explicitly in JIRA_USER_MAP
    if SEARCH_TOOL not in tools:
        print(f"[guardrail] server lacks {SEARCH_TOOL}; leaving '{owner}' unassigned")
        return None
    arguments = {"query": term, "project_key": os.getenv("JIRA_PROJECT_KEY"), "limit": 50}
    print(f"[tool call] {SEARCH_TOOL}({arguments})")
    try:
        result = await session.call_tool(SEARCH_TOOL, arguments)
    except Exception as exc:
        print(f"[tool result] ERROR searching for '{term}': {exc}")
        return None
    users = [] if result.is_error else parse_users(_text(result))
    match = match_owner(term, users)
    if match:
        print(f"[tool result] '{owner}' -> {match['name']}")
    else:
        print(f"[tool result] no single project member matches '{term}' ({len(users)} candidate(s))")
    return match


async def _create(session: ClientSession, arguments: dict) -> tuple[str | None, str | None]:
    """Call jira_create_issue; returns (issue key, error)."""
    print(f"[tool call] {CREATE_TOOL}(summary={arguments.get('summary')!r}, "
          f"assignee={arguments.get('assignee')!r})")
    try:
        result = await session.call_tool(CREATE_TOOL, arguments)
        text = _text(result)
        if result.is_error:
            error = text[:300] or "tool reported an error"
        else:
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                data = None
            error = (str(data.get("error"))[:300] if isinstance(data, dict)
                     and data.get("success") is False else None)
            if not error:
                key = parse_issue_key(text)
                print(f"[tool result] created {key or '(key not reported)'}")
                return key, None
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    print(f"[tool result] ERROR creating issue: {error}")
    return None, error


async def assign_items_in_jira(items: list[dict], meeting: str | None = None) -> list[dict]:
    """Create one Jira issue per approved item, assigned to its owner.

    Returns one result per item: {"title", "owner", "key", "assignee", "error"}.
    Never raises for a single bad item, so one failure can't lose the rest.
    """
    if not items:
        print("[tool call] Jira skipped - no approved items")
        return []
    user_map = parse_user_map(os.getenv("JIRA_USER_MAP"))
    results = []
    async with jira_session() as session:
        listed = await session.list_tools()
        tools = {tool.name: tool for tool in listed.tools}
        print(f"[tool result] Jira MCP server advertises {len(tools)} tools: {', '.join(sorted(tools))}")
        if CREATE_TOOL not in tools:
            raise RuntimeError(f"Jira MCP server does not advertise '{CREATE_TOOL}'")
        schema = tools[CREATE_TOOL].input_schema

        for item in items:
            owner = item.get("owner") or ""
            user = await resolve_assignee(session, owner, tools, user_map) if owner else None
            if owner and not user:
                print(f"[guardrail] '{owner}' is not a member of {os.getenv('JIRA_PROJECT_KEY')} "
                      "- creating the issue unassigned")
            outcome = {"title": item.get("title"), "owner": owner or None, "key": None,
                       "assignee": user["name"] if user else None, "error": None}
            outcome["key"], outcome["error"] = await _create(
                session, build_create_arguments(item, schema, user and user["account_id"], meeting))
            if user and outcome["error"]:
                # Jira refused this assignee (e.g. no permission in the
                # project): still record the task, just unassigned.
                print(f"[guardrail] Jira refused assignee {user['name']}; retrying unassigned")
                outcome["assignee"] = None
                outcome["key"], outcome["error"] = await _create(
                    session, build_create_arguments(item, schema, None, meeting))
            results.append(outcome)
    return results


async def _print_visible_projects(session: ClientSession, tools: set) -> None:
    """Diagnose a bad JIRA_PROJECT_KEY: show the keys this account can see.

    Zero visible projects means the login itself isn't working (Jira answers
    unauthenticated requests as an anonymous user who can see nothing).
    """
    if PROJECTS_TOOL not in tools:
        return
    result = await session.call_tool(PROJECTS_TOOL, {})
    try:
        data = json.loads(_text(result))
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict):
        data = data.get("projects", data.get("values"))
    projects = [p for p in data if isinstance(p, dict) and p.get("key")] if isinstance(data, list) else []
    if projects:
        current = os.getenv("JIRA_PROJECT_KEY")
        print(f"[tool result] spaces/projects this account can see ({len(projects)}); "
              f"JIRA_PROJECT_KEY is {current!r}:")
        for project in projects:
            marker = "  <- JIRA_PROJECT_KEY" if project["key"] == current else ""
            print(f"  - {project['key']}: {project.get('name', '')}{marker}")
    else:
        token = os.getenv("JIRA_API_TOKEN", "")
        hint = ("" if token.startswith("ATATT") else
                f" JIRA_API_TOKEN is {len(token)} characters and doesn't start with 'ATATT', so it is "
                "probably not a current Atlassian API token - create a new one.")
        print("[tool result] this account can see no projects, which usually means Jira did not accept "
              "the login and treated it as anonymous." + hint + " Also check JIRA_USERNAME is the email "
              "that created the token and JIRA_URL is https://<site>.atlassian.net. Details: "
              + _text(result)[:300])


async def _smoke_test(show_projects: bool = False):
    """List tools, optionally all visible spaces, and the project's assignable users.

    Read-only: creates nothing.
    """
    async with jira_session() as session:
        listed = await session.list_tools()
        tools = {t.name for t in listed.tools}
        print(f"[tool result] Jira MCP server advertises {len(tools)} tools: {', '.join(sorted(tools))}")
        if show_projects:
            await _print_visible_projects(session, tools)
        if SEARCH_TOOL in tools:
            project = os.getenv("JIRA_PROJECT_KEY")
            result = await session.call_tool(SEARCH_TOOL, {"query": "", "project_key": project, "limit": 100})
            users = parse_users(_text(result))
            if not users:
                print(f"[tool result] could not list members of {project}: {_text(result)[:300]}")
                if not show_projects:
                    await _print_visible_projects(session, tools)
            else:
                print(f"[tool result] {len(users)} assignable user(s) in {project}:")
                counts = {}
                for user in users:
                    key = normalize_name(user["name"])
                    counts[key] = counts.get(key, 0) + 1
                for user in users:
                    flag = "  <- shared name: pick one via JIRA_USER_MAP" if counts[normalize_name(user["name"])] > 1 else ""
                    email = f" <{user['email']}>" if user["email"] else ""
                    print(f"  - {user['name']}{email}  account_id={user['account_id']}{flag}")


if __name__ == "__main__":
    try:
        asyncio.run(_smoke_test(show_projects="--projects" in sys.argv[1:]))
    except JiraConfigError as exc:
        print(f"[config] {exc}")
        sys.exit(1)
