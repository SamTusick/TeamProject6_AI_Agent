"""Human review step: the CLI approve/reject loop for eligible action items."""

from backend.core.memory import MeetingMemory


def confirm_items(eligible: list[dict], approve_all: bool, memory: MeetingMemory | None = None) -> list[dict]:
    """Return only the approved items.

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
