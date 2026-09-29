"""M2 prototype: turns a meeting transcript into approved, tracked action items.

Pipeline (see README for full explanation):
    [perceive]    read transcript file passed on the command line
    [reason]      ask the NRP model to classify candidate action items
    [guardrail]   verify each CONFIRMED item's quote appears in the transcript
    [confirm]     human approves/rejects each eligible item in the CLI
    [tool call]   approved items written via the MCP filesystem server
    [tool result] written file read back via the same server, printed
    [output]      summary of what was written, rejected, or flagged

Intentionally NOT implemented in this v1 (see README "Not implemented"):
live meeting join, Otter integration, Jira/Google Calendar writes,
memory across meetings, multi-agent design.
"""

import asyncio
import sys

from llm_client import classify_transcript
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


def confirm_items(eligible: list[dict], approve_all: bool) -> list[dict]:
    """CLI approve/reject loop. Returns only the approved items.

    approve_all=True skips the interactive prompt (used by the test
    runner in Step 7 so tests don't require typing).
    """
    approved = []
    for item in eligible:
        print("\n[confirm] Eligible action item:")
        print(f"  Title:    {item['title']}")
        print(f"  Owner:    {item['owner']}")
        print(f"  Deadline: {item['deadline']}")
        print(f"  Quote:    \"{item['quote']}\"")
        print(f"  Reasoning: {item['reasoning']}")

        if approve_all:
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


async def run(transcript_path: str, approve_all: bool) -> dict:
    """Run the full pipeline. Returns a dict with every bucket of items
    (not just approved) so callers - like the test runner - can check
    classification outcomes even for items that were never written.
    """
    print(f"[perceive] reading transcript: {transcript_path}")
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = f.read()

    items = await classify_transcript(transcript)
    print(f"[reason] model returned {len(items)} candidate item(s)")

    eligible, needs_info, rejected = sort_items(items, transcript)

    for item in rejected:
        print(f"[guardrail] NOT eligible: '{item['title']}' - {eligibility_reason(item, transcript)}")
    for item in needs_info:
        print(f"[guardrail] NEEDS_INFO: '{item['title']}' - {item.get('clarifying_question')}")
    print(f"[guardrail] {len(eligible)} item(s) eligible for human confirm")

    approved = confirm_items(eligible, approve_all)

    print(f"\n[output] {len(approved)} item(s) approved by human")
    for item in approved:
        print(f"  - {item['title']} (owner={item['owner']}, deadline={item['deadline']})")

    await save_approved_items(approved)

    return {
        "items": items,
        "eligible": eligible,
        "needs_info": needs_info,
        "rejected": rejected,
        "approved": approved,
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
