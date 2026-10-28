"""Explicit handoff from the Extractor agent to the Resolver agent.

    trigger  an item's classification is NEEDS_INFO
    payload  the item, which fields are missing, the full transcript, and the
             memory store
    return   the same item, upgraded to CONFIRMED only when the Resolver can
             cite verbatim evidence; otherwise unchanged
"""

from backend.agents.resolver import LLM, resolve_item
from backend.core.memory import MeetingMemory


async def hand_off_needs_info(
    items: list[dict], transcript: str, memory: MeetingMemory, llm: LLM | None = None
) -> tuple[list[dict], int]:
    """Send every NEEDS_INFO item to the Resolver. Returns (items, handoff count)."""
    if llm is None:
        # Imported lazily: building the model client needs credentials, which
        # offline tests with a scripted LLM do not have.
        from backend.core.llm_client import complete_json as llm

    updated, handoffs = [], 0
    for item in items:
        if item.get("classification") != "NEEDS_INFO":
            updated.append(item)
            continue
        handoffs += 1
        missing = [f for f in ("owner", "deadline") if not item.get(f)]
        print(f"[handoff] Extractor -> Resolver: '{item['title']}' (missing: {', '.join(missing)})")
        resolved = await resolve_item(item, transcript, memory, llm)
        if resolved.get("classification") == "CONFIRMED":
            print(f"[handoff] Resolver -> Extractor: resolved '{item['title']}' "
                  f"(owner={resolved['owner']}, deadline={resolved['deadline']})")
        else:
            print(f"[handoff] Resolver -> Extractor: could not resolve '{item['title']}'; stays NEEDS_INFO")
        updated.append(resolved)
    return updated, handoffs
