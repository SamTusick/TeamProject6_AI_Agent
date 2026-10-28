"""Offline tests for the Resolver agent, handoff, and memory layer.

A scripted fake LLM stands in for the model, so these are deterministic and
need no network. They check the parts we control: the ReAct loop, the
guardrail that rejects unsupported claims, the handoff, and retrieval.
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from memory import MeetingMemory
from resolver_agent import hand_off_needs_info, parse_step, resolve_item, search_transcript

TRANSCRIPT = (
    "Morgan: We have to publish the updated pricing page, that's decided.\n"
    "Taylor: Agreed.\n"
    "Morgan: Taylor, you own the pricing page and it goes live by Thursday.\n"
)


def needs_info_item():
    return {
        "title": "Publish pricing page",
        "owner": None,
        "deadline": None,
        "classification": "NEEDS_INFO",
        "reasoning": "decided, no owner/deadline nearby",
        "quote": "We have to publish the updated pricing page, that's decided.",
        "clarifying_question": "Who owns it and when is it due?",
    }


def scripted(*steps):
    """Fake LLM that replays JSON steps and records the messages it was given."""
    replies = [json.dumps(s) for s in steps]
    seen = []

    async def llm(messages):
        seen.append(list(messages))
        return replies.pop(0)

    llm.seen = seen
    return llm


def run(coro):
    return asyncio.run(coro)


class ResolverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = MeetingMemory(Path(self.tmp.name) / "memory.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_react_loop_resolves_with_verified_evidence(self):
        llm = scripted(
            {"thought": "look for who owns it", "action": "search_transcript", "input": "pricing page own"},
            {
                "thought": "found both",
                "action": "finish",
                "input": {
                    "owner": "Taylor",
                    "owner_quote": "Taylor, you own the pricing page and it goes live by Thursday.",
                    "deadline": "Thursday",
                    "deadline_quote": "Taylor, you own the pricing page and it goes live by Thursday.",
                },
            },
        )
        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "CONFIRMED")
        self.assertEqual((item["owner"], item["deadline"]), ("Taylor", "Thursday"))
        self.assertEqual(item["resolution"]["by"], "resolver_agent")
        # the observation from the first action was fed into the second turn
        self.assertIn("Observation", llm.seen[1][-1]["content"])

    def test_invented_quote_is_rejected(self):
        llm = scripted(
            {
                "thought": "guessing",
                "action": "finish",
                "input": {
                    "owner": "Taylor",
                    "owner_quote": "Taylor will do it tomorrow",
                    "deadline": "tomorrow",
                    "deadline_quote": "Taylor will do it tomorrow",
                },
            }
        )
        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "NEEDS_INFO")
        self.assertIsNone(item["owner"])

    def test_value_must_appear_inside_its_quote(self):
        llm = scripted(
            {
                "thought": "wrong person",
                "action": "finish",
                "input": {
                    "owner": "Jordan",
                    "owner_quote": "Taylor, you own the pricing page and it goes live by Thursday.",
                    "deadline": "Thursday",
                    "deadline_quote": "Taylor, you own the pricing page and it goes live by Thursday.",
                },
            }
        )
        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "NEEDS_INFO")
        self.assertEqual(item["deadline"], "Thursday")  # the supported half is kept
        self.assertIsNone(item["owner"])

    def test_memory_is_a_hint_not_evidence(self):
        self.memory.remember(
            [{"title": "Publish pricing page", "owner": "Jordan", "deadline": "Friday", "quote": "q"}],
            meeting="old.txt",
        )
        llm = scripted(
            {"thought": "check memory", "action": "search_memory", "input": "pricing page"},
            {
                "thought": "memory says Jordan",
                "action": "finish",
                "input": {"owner": "Jordan", "owner_quote": "memory", "deadline": None, "deadline_quote": None},
            },
        )
        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "NEEDS_INFO")
        self.assertIsNone(item["owner"])
        self.assertIn("Jordan", llm.seen[1][-1]["content"])

    def test_gives_up_cleanly_and_caps_steps(self):
        loop = {"thought": "again", "action": "search_transcript", "input": "zzz"}
        llm = scripted(*[loop] * 5)
        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "NEEDS_INFO")
        self.assertEqual(len(llm.seen), 5)

    def test_unusable_reply_stops(self):
        async def llm(messages):
            return "not json"

        item = run(resolve_item(needs_info_item(), TRANSCRIPT, self.memory, llm))
        self.assertEqual(item["classification"], "NEEDS_INFO")

    def test_handoff_only_for_needs_info(self):
        confirmed = dict(needs_info_item(), classification="CONFIRMED", owner="A", deadline="B")
        llm = scripted({"thought": "none", "action": "finish", "input": {"owner": None, "deadline": None}})
        items, handoffs = run(hand_off_needs_info([confirmed, needs_info_item()], TRANSCRIPT, self.memory, llm))
        self.assertEqual(handoffs, 1)
        self.assertEqual(items[0]["classification"], "CONFIRMED")
        self.assertEqual(items[1]["classification"], "NEEDS_INFO")

    def test_parse_step_validates_action(self):
        self.assertIsNone(parse_step('{"action": "delete_everything"}'))
        self.assertEqual(parse_step('noise {"action": "finish", "input": {}} noise')["action"], "finish")

    def test_search_transcript(self):
        self.assertIn("line 3", search_transcript(TRANSCRIPT, "goes live Thursday"))
        self.assertEqual(search_transcript(TRANSCRIPT, "zzz"), "no matching lines")


class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "memory.json"
        self.memory = MeetingMemory(self.path)
        self.memory.remember(
            [
                {"title": "Send budget report to finance", "owner": "Sam", "deadline": "Friday", "quote": "q1"},
                {"title": "Update client documentation", "owner": "Ishita", "deadline": "May 5", "quote": "q2"},
            ],
            meeting="m1.txt",
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_persists_across_instances(self):
        self.assertEqual(len(MeetingMemory(self.path).records), 2)

    def test_search_ranks_relevant_first(self):
        hits = self.memory.search("budget report finance")
        self.assertEqual(hits[0]["owner"], "Sam")
        self.assertEqual(self.memory.search("zebra"), [])

    def test_duplicate_detection_and_owner_conflict(self):
        dup = {"title": "Send the budget report to finance", "owner": "Sam"}
        self.assertIsNotNone(self.memory.find_duplicate(dup))
        self.assertIsNone(self.memory.find_duplicate(dict(dup, owner="Morgan")))
        self.assertIsNone(self.memory.find_duplicate({"title": "Book travel", "owner": "Sam"}))

    def test_remember_is_idempotent_and_corrupt_file_is_safe(self):
        added = self.memory.remember([{"title": "Send budget report to finance", "owner": "Sam"}], "m2.txt")
        self.assertEqual(added, 0)
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(MeetingMemory(self.path).records, [])


if __name__ == "__main__":
    unittest.main()
