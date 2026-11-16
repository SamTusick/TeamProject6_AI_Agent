"""Offline tests for Jira task assignment over MCP.

A real stdio MCP server (tests/fake_jira_server.py) stands in for
mcp-atlassian, so these exercise the actual MCP handshake, tool discovery
and call arguments without a Jira site or network.
"""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jira_client

FAKE_SERVER = Path(__file__).parent / "fake_jira_server.py"


def item(title, owner, deadline="Thursday"):
    return {"title": title, "owner": owner, "deadline": deadline, "classification": "CONFIRMED",
            "reasoning": "explicit commitment", "quote": f"{owner} will do {title}"}


class JiraHelpersTest(unittest.TestCase):
    def test_user_map_parsing_ignores_placeholders(self):
        m = jira_client.parse_user_map(
            "Taylor=taylor@example.com; Sam = Sam Tusick ;bad; Jo=712020:abcd1234-ef")
        self.assertEqual(m, {"sam": "Sam Tusick", "jo": "712020:abcd1234-ef"})
        self.assertEqual(jira_client.parse_user_map(""), {})

    def test_owner_matching_is_unambiguous_or_nothing(self):
        users = [{"name": "Taylor Reed", "account_id": "1", "email": "taylor@school.edu"},
                 {"name": "Sam Tusick", "account_id": "2", "email": ""},
                 {"name": "Sam Rivera", "account_id": "3", "email": ""},
                 {"name": "José Núñez", "account_id": "4", "email": ""}]
        match = jira_client.match_owner
        self.assertEqual(match("taylor reed", users)["account_id"], "1")    # exact, any case
        self.assertEqual(match("Taylor", users)["account_id"], "1")         # unique first name
        self.assertEqual(match("taylor@school.edu", users)["account_id"], "1")
        self.assertEqual(match("Jose Nunez", users)["account_id"], "4")     # accents ignored
        self.assertIsNone(match("Sam", users))                              # two Sams -> nobody
        self.assertIsNone(match("Taylor Smith", users))                     # wrong surname
        self.assertIsNone(match("Jamal", users))                            # not in project
        self.assertIsNone(match("", users))

    def test_parse_users_reads_real_server_shapes(self):
        ok = '{"success": true, "users": [{"display_name": "A B", "account_id": "x1"}, {"displayName": "C", "accountId": "x2"}, {"display_name": "no id"}]}'
        self.assertEqual([u["account_id"] for u in jira_client.parse_users(ok)], ["x1", "x2"])
        self.assertEqual(jira_client.parse_users('{"success": false, "error": "denied"}'), [])
        self.assertEqual(jira_client.parse_users("not json"), [])

    def test_only_iso_deadlines_become_due_dates(self):
        schema = {"properties": {k: {"type": "string"} for k in
                                 ("project_key", "summary", "issue_type", "assignee", "description",
                                  "additional_fields")}}
        with mock.patch.dict(os.environ, {"JIRA_PROJECT_KEY": "TP6"}):
            dated = jira_client.build_create_arguments(item("x", "T", "2026-11-04"), schema, "t", None)
            vague = jira_client.build_create_arguments(item("x", "T", "next Tuesday"), schema, None, None)
        self.assertEqual(json.loads(dated["additional_fields"])["duedate"], "2026-11-04")
        self.assertNotIn("duedate", json.loads(vague["additional_fields"]))
        self.assertNotIn("assignee", vague)

    def test_arguments_filtered_to_declared_schema(self):
        schema = {"properties": {"project_key": {}, "summary": {}, "issue_type": {}}}
        with mock.patch.dict(os.environ, {"JIRA_PROJECT_KEY": "TP6"}):
            args = jira_client.build_create_arguments(item("x", "T"), schema, "t", "m.txt")
        self.assertEqual(set(args), {"project_key", "summary", "issue_type"})

    def test_issue_key_parsing(self):
        self.assertEqual(jira_client.parse_issue_key('{"issue": {"key": "TP6-7"}}'), "TP6-7")
        self.assertEqual(jira_client.parse_issue_key("Created issue TP6-12 ok"), "TP6-12")
        self.assertIsNone(jira_client.parse_issue_key("nothing here"))

    def test_missing_config_fails_before_launch(self):
        with mock.patch.dict(os.environ, {"JIRA_URL": ""}, clear=False):
            with self.assertRaises(jira_client.JiraConfigError):
                jira_client.build_server_params()


class JiraMcpRoundTripTest(unittest.TestCase):
    def test_assigns_project_members_and_leaves_everyone_else_unassigned(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "calls.jsonl"
            env = {
                "JIRA_URL": "https://example.atlassian.net", "JIRA_USERNAME": "me@example.com",
                "JIRA_API_TOKEN": "test-token", "JIRA_PROJECT_KEY": "TP6",
                "JIRA_USER_MAP": "Morgan=Morgan Lee",
                "JIRA_MCP_COMMAND": f'"{sys.executable}" "{FAKE_SERVER}"',
                "FAKE_JIRA_LOG": str(log),
            }
            items = [item("Publish pricing page", "Taylor"),   # unique first name
                     item("Review mockups", "Morgan"),         # via JIRA_USER_MAP
                     item("Fix login", "Jamal"),               # not in project
                     item("Plan sprint", "Sam"),               # ambiguous
                     item("Update docs", "Riley Blocked"),     # Jira refuses -> retry
                     item("FAIL", "Taylor")]                   # create fails outright
            with mock.patch.dict(os.environ, env):
                results = asyncio.run(jira_client.assign_items_in_jira(items, meeting="standup.txt"))

            self.assertEqual([r["key"] for r in results], ["TP6-1", "TP6-2", "TP6-3", "TP6-4", "TP6-5", None])
            self.assertEqual([r["assignee"] for r in results],
                             ["Taylor Reed", "Morgan Lee", None, None, None, None])
            self.assertIn("summary", results[5]["error"])

            calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
            searches = [c["args"] for c in calls if c["tool"] == "jira_search_assignable_users"]
            self.assertTrue(all(s["project_key"] == "TP6" for s in searches))
            creates = [c["args"] for c in calls if c["tool"] == "jira_create_issue"]
            assignees = [c["assignee"] for c in creates]
            # Account IDs only - a raw name is never handed to the server.
            self.assertEqual(assignees[:4], ["712020:aaaaaaaa-0001", "712020:aaaaaaaa-0002", None, None])
            self.assertEqual(assignees[4:6], ["712020:aaaaaaaa-0009", None])  # refused, then unassigned
            self.assertEqual(creates[0]["additional_fields"], {"labels": ["meeting-action-agent"]})
            self.assertIn("standup.txt", creates[0]["description"])
            self.assertIn("Taylor will do Publish pricing page", creates[0]["description"])


class JiraWorkerTest(unittest.TestCase):
    def run_worker(self, request, env):
        import subprocess
        full_env = {**os.environ, **env}
        proc = subprocess.run([sys.executable, "-X", "utf8", str(Path(__file__).parent.parent / "jira_worker.py")],
                              input=json.dumps(request), capture_output=True, text=True, env=full_env,
                              cwd=Path(__file__).parent.parent, timeout=120)
        return proc.returncode, json.loads(proc.stdout)

    def test_status_reports_missing_settings_without_secrets(self):
        code, out = self.run_worker({"action": "status"}, {
            "JIRA_URL": "", "JIRA_USERNAME": "", "JIRA_API_TOKEN": "", "JIRA_PROJECT_KEY": ""})
        self.assertEqual(code, 0)
        self.assertFalse(out["configured"])
        self.assertEqual(out["missing"], list(jira_client.REQUIRED_ENV))
        self.assertNotIn("token", json.dumps(out).lower().replace("jira_api_token", ""))

    def test_create_maps_results_back_to_item_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"JIRA_URL": "https://example.atlassian.net", "JIRA_USERNAME": "me@example.com",
                   "JIRA_API_TOKEN": "secret-token", "JIRA_PROJECT_KEY": "TP6",
                   "JIRA_USER_MAP": "",
                   "JIRA_MCP_COMMAND": f'"{sys.executable}" "{FAKE_SERVER}"',
                   "FAKE_JIRA_LOG": str(Path(tmp) / "calls.jsonl")}
            code, status = self.run_worker({"action": "status"}, env)
            self.assertTrue(status["configured"])
            self.assertNotIn("secret-token", json.dumps(status))
            items = [{**item("Publish pricing page", "Taylor"), "id": "4"}]
            code, out = self.run_worker({"action": "create", "meeting": "Standup", "items": items}, env)
        self.assertEqual(code, 0)
        self.assertEqual(out["results"][0]["id"], "4")
        self.assertEqual(out["results"][0]["key"], "TP6-1")


if __name__ == "__main__":
    unittest.main()
