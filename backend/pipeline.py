"""M3: multi-agent pipeline that turns a meeting transcript into approved, tracked action items.

Agents (see README for full explanation):
    Extractor agent  (agents/extractor.py)  classifies candidate action items
    Resolver agent   (agents/resolver.py)   ReAct loop that finds a missing owner/deadline
    Orchestrator     (this file)            runs the pipeline, guardrails, human confirm

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

from pathlib import Path

from backend.agents.extractor import classify_transcript
from backend.agents.handoff import hand_off_needs_info
from backend.core.guardrails import eligibility_reason, is_eligible
from backend.core.memory import MeetingMemory
from backend.review import confirm_items
from backend.tools.mcp_client import save_approved_items


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
