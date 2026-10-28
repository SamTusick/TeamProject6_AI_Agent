"""Resolver agent: a second agent that fills in missing owner/deadline details.

Handoff contract (see agent.py):
    trigger  the Extractor classified an item NEEDS_INFO (a decision was made
             but the owner and/or deadline was not stated where it was found)
    payload  {"item": <extracted item>, "missing": ["owner", "deadline"],
              "transcript": <full text>, "memory": <MeetingMemory>}
    returns  the same item, possibly upgraded to CONFIRMED, plus a
             "resolution" record that carries the evidence

Reasoning pattern: ReAct. Each step the model emits a thought and ONE action:
    search_transcript(query)  keyword search over the transcript lines
    search_memory(query)      look up related items from earlier meetings
    finish(result)            report owner/deadline with verbatim quotes
The loop is capped at MAX_STEPS so it cannot run away.

Guardrail: the model's answer is never trusted. An owner or deadline is only
applied when its supporting quote is found verbatim in the transcript AND the
claimed value appears inside that quote. Memory is only a hint for where to
look; it is not accepted as evidence. If evidence is missing the item stays
NEEDS_INFO. Anything resolved still goes to the human confirm step.
"""

import json
import re
from typing import Awaitable, Callable

from memory import MeetingMemory, tokenize
from verify import normalize, quote_found_in_transcript

MAX_STEPS = 5
MAX_OBSERVATION_LINES = 5

LLM = Callable[[list[dict]], Awaitable[str]]

RESOLVER_PROMPT = """You are a meeting follow-up researcher. A teammate found a \
decision in a meeting transcript but the owner and/or deadline was not stated \
next to it. Decide whether the transcript states the missing detail elsewhere.

Work in a ReAct loop. On every turn reply with ONLY a JSON object:
{"thought": "your short reasoning", "action": "<name>", "input": <value>}

Actions:
- "search_transcript": input is a string of keywords. Returns matching \
transcript lines with line numbers.
- "search_memory": input is a string of keywords. Returns related items from \
earlier meetings. This is only a hint for where to look - it is NOT evidence.
- "finish": input is {"owner": str|null, "owner_quote": str|null, \
"deadline": str|null, "deadline_quote": str|null}.

Rules:
1. Only report an owner or deadline that is explicitly stated in THIS \
transcript for THIS decision. Never guess or infer one.
2. Each quote must be copied verbatim from a single transcript line and must \
contain the owner's name / the deadline text you report.
3. If the transcript does not state it, finish with nulls. That is correct \
behavior, not a failure.
4. Finish within %d steps.
""" % MAX_STEPS


def search_transcript(transcript: str, query: str) -> str:
    terms = set(tokenize(query))
    scored = []
    for number, line in enumerate(transcript.splitlines(), start=1):
        hits = len(terms & set(tokenize(line)))
        if line.strip() and hits:
            scored.append((hits, number, line.strip()))
    scored.sort(key=lambda row: (-row[0], row[1]))
    if not scored:
        return "no matching lines"
    return "\n".join(f"line {n}: {text}" for _, n, text in scored[:MAX_OBSERVATION_LINES])


def parse_step(raw: str) -> dict | None:
    """Parse one ReAct step. Returns None when the reply is unusable."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        match = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict) or data.get("action") not in {
        "search_transcript",
        "search_memory",
        "finish",
    }:
        return None
    return data


def validate_resolution(result: dict, transcript: str) -> dict:
    """Keep only the parts of a model-proposed resolution backed by evidence."""
    checked = {}
    for field in ("owner", "deadline"):
        value = result.get(field)
        quote = result.get(f"{field}_quote")
        if (
            isinstance(value, str)
            and isinstance(quote, str)
            and value.strip()
            and quote_found_in_transcript(quote, transcript)
            and normalize(value) in normalize(quote)
        ):
            checked[field] = value.strip()
            checked[f"{field}_quote"] = quote.strip()
        elif value:
            print(f"[guardrail] resolver's {field} '{value}' rejected: no verbatim supporting quote")
    return checked


async def resolve_item(
    item: dict, transcript: str, memory: MeetingMemory, llm: LLM
) -> dict:
    """Run the ReAct loop for one NEEDS_INFO item. Returns the (updated) item."""
    missing = [f for f in ("owner", "deadline") if not item.get(f)]
    messages = [
        {"role": "system", "content": RESOLVER_PROMPT},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "decision": item["title"],
                    "quote_where_decision_was_found": item["quote"],
                    "missing": missing,
                    "transcript": transcript,
                }
            ),
        },
    ]

    final = None
    for step in range(1, MAX_STEPS + 1):
        raw = await llm(messages)
        parsed = parse_step(raw)
        if parsed is None:
            print(f"[resolver] step {step}: unusable model reply, stopping")
            break
        print(f"[thought] {parsed.get('thought', '')}")
        action, arg = parsed["action"], parsed.get("input")
        messages.append({"role": "assistant", "content": json.dumps(parsed)})

        if action == "finish":
            final = arg if isinstance(arg, dict) else None
            print(f"[action] finish({json.dumps(arg)})")
            break

        print(f"[action] {action}({arg!r})")
        query = arg if isinstance(arg, str) else json.dumps(arg)
        if action == "search_transcript":
            observation = search_transcript(transcript, query)
        else:
            observation = memory.format_hits(memory.search(query))
        print(f"[observation] {observation}")
        messages.append({"role": "user", "content": f"Observation:\n{observation}"})
    else:
        print(f"[resolver] hit the {MAX_STEPS}-step limit without finishing")

    resolved = dict(item)
    if not final:
        return resolved

    evidence = validate_resolution(final, transcript)
    for field in ("owner", "deadline"):
        if field in evidence and not item.get(field):
            resolved[field] = evidence[field]
    if all(resolved.get(f) for f in ("owner", "deadline")):
        resolved["classification"] = "CONFIRMED"
        resolved["clarifying_question"] = None
        resolved["resolution"] = {
            "by": "resolver_agent",
            "owner_quote": evidence.get("owner_quote"),
            "deadline_quote": evidence.get("deadline_quote"),
        }
    return resolved


async def hand_off_needs_info(
    items: list[dict], transcript: str, memory: MeetingMemory, llm: LLM | None = None
) -> tuple[list[dict], int]:
    """Handoff: Extractor -> Resolver for every NEEDS_INFO item.

    Trigger: classification == NEEDS_INFO. Payload: the item, what is missing,
    the transcript, and the memory store. The Resolver returns the item,
    upgraded to CONFIRMED only when it can cite verbatim evidence.
    """
    updated, handoffs = [], 0
    if llm is None:
        from llm_client import complete_json as llm
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
