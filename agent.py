"""M3: multi-agent system that turns a meeting transcript into approved, tracked action items.

Agents (see README for full explanation):
    Extractor agent  (llm_client.py)    classifies candidate action items
    Resolver agent   (resolver_agent.py) ReAct loop that finds a missing owner/deadline
    Orchestrator     (this file)        runs the pipeline, guardrails, human confirm

Pipeline:
    [perceive]    read transcript file passed on the command line
    [reason]      Extractor classifies candidate action items
    [handoff]     NEEDS_INFO items go to the Resolver, which returns evidence or gives up
    [guardrail]   verify each CONFIRMED item's quote appears in the transcript
    [memory]      flag items the team already committed to in an earlier meeting
    [confirm]     human approves/rejects each eligible item in the CLI
    [tool call]   approved items written via the MCP filesystem server
    [tool result] written file read back via the same server, printed
    [output]      summary of what was written, rejected, or flagged

Not implemented: live meeting join, Otter integration, Jira/Google Calendar writes.
"""

import asyncio
import sys
from pathlib import Path

from llm_client import classify_transcript
from memory import MeetingMemory
from resolver_agent import hand_off_needs_info
from verify import is_eligible, eligibility_reason
from mcp_client import save_approved_items


def sort_items(items: list[dict], transcript: str) -> tuple[list[dict], list[dict], list[dict]]:
    """Split classified items into (eligible, needs_info, rejected).

    Only items in `eligible` are ever shown to the human-confirm step.
    Everything else is explained via [guardrail] trace lines and never
    reaches confirm or the MCP write.
    """
    eligible, needs_info, rejected = [], [], []
    for item in items:
        if item.get("classification") == "NEEDS_INFO":
            needs_info.append(item)
            continue
        if is_eligible(item, transcript):
            eligible.append(item)
        else:
            rejected.append(item)
    return eligible, needs_info, rejected


def confirm_items(eligible: list[dict], approve_all: bool, memory: MeetingMemory | None = None) -> list[dict]:
    """CLI approve/reject loop. Returns only the approved items.

    approve_all=True skips the interactive prompt (used by the test
    runner so tests don't require typing). Items the team already
    committed to in an earlier meeting (per memory) are skipped in
    approve_all mode and flagged in interactive mode.
    """
    approved = []
    for item in eligible:
        print("\n[confirm] Eligible action item:")
        print(f"  Title:    {item['title']}")
        print(f"  Owner:    {item['owner']}")
        print(f"  Deadline: {item['deadline']}")
        print(f"  Quote:    \"{item['quote']}\"")
        print(f"  Reasoning: {item['reasoning']}")
        if item.get("resolution"):
            res = item["resolution"]
            print(f"  Resolved by Resolver agent - owner evidence: \"{res.get('owner_quote')}\"")
            print(f"                               deadline evidence: \"{res.get('deadline_quote')}\"")

        duplicate = memory.find_duplicate(item) if memory else None
        if duplicate:
            print(f"  [memory] looks like an earlier item: '{duplicate['title']}' "
                  f"(owner={duplicate['owner']}, meeting {duplicate['meeting']})")

        if approve_all and duplicate:
            decision = "n"
            print("  --approve-all set -> skipping probable duplicate")
        elif approve_all:
            decision = "y"
            print("  --approve-all set -> auto-approving")
        else:
            decision = input("  Approve and write this item? [y/N]: ").strip().lower()

        if decision == "y":
            approved.append(item)
            print("  -> approved")
        else:
            print("  -> rejected by human")

    return approved


async def run(transcript_path: str, approve_all: bool, memory: MeetingMemory | None = None) -> dict:
    """Run the full pipeline. Returns a dict with every bucket of items
    (not just approved) so callers - like the test runner - can check
    classification outcomes even for items that were never written.
    """
    memory = memory if memory is not None else MeetingMemory()
    print(f"[perceive] reading transcript: {transcript_path}")
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = f.read()

    items = await classify_transcript(transcript)
    print(f"[reason] model returned {len(items)} candidate item(s)")

    items, handoffs = await hand_off_needs_info(items, transcript, memory)

    eligible, needs_info, rejected = sort_items(items, transcript)

    for item in rejected:
        print(f"[guardrail] NOT eligible: '{item['title']}' - {eligibility_reason(item, transcript)}")
    for item in needs_info:
        print(f"[guardrail] NEEDS_INFO: '{item['title']}' - {item.get('clarifying_question')}")
    print(f"[guardrail] {len(eligible)} item(s) eligible for human confirm")

    approved = confirm_items(eligible, approve_all, memory)

    print(f"\n[output] {len(approved)} item(s) approved by human")
    for item in approved:
        print(f"  - {item['title']} (owner={item['owner']}, deadline={item['deadline']})")

    saved = await save_approved_items(approved)
    if saved:
        added = memory.remember(approved, meeting=Path(transcript_path).name)
        print(f"[memory] stored {added} new item(s) for future meetings ({memory.path})")

    return {
        "items": items,
        "eligible": eligible,
        "needs_info": needs_info,
        "rejected": rejected,
        "approved": approved,
        "handoffs": handoffs,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python agent.py <path-to-transcript.txt> [--approve-all]")
        sys.exit(1)

    transcript_path = sys.argv[1]
    approve_all = "--approve-all" in sys.argv[2:]

    asyncio.run(run(transcript_path, approve_all))


if __name__ == "__main__":
    main()
