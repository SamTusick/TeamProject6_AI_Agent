"""Extractor agent: reads a transcript and classifies candidate action items.

Reuses the shared AsyncOpenAI client but calls chat.completions.create()
directly instead of going through an Agent/Runner abstraction, so the
pipeline - not the model - controls when anything gets written to disk.
"""

import json

from backend.core.llm_client import MODEL_NAME, client

# Every rule here pushes the model toward under-classifying rather than
# over-claiming CONFIRMED: a missed action item is noticed by a human later,
# but a false CONFIRMED becomes a "decision" nobody actually made.
SYSTEM_PROMPT = """You are a careful meeting-minutes analyst. You read a raw \
meeting transcript and extract CANDIDATE action items. You do not summarize \
the whole meeting - you only pull out things that could become tracked tasks.

For each candidate action item, classify it into exactly one of these four \
categories. Read the definitions and examples carefully - the boundary \
between them is the entire point of this task:

- CONFIRMED: A decision was explicitly and unambiguously made and accepted. \
  Someone stated they will do something, or the group agreed on an owner and \
  a next step, with no hedging language.
  Example: "Okay, I'll have the slides done by Friday." -> CONFIRMED.

- TENTATIVE: The speaker expressed uncertainty, possibility, or a maybe. \
  Hedge words like "might", "could probably", "I'll try to", "if I have time" \
  signal TENTATIVE even if a task and owner are named.
  Example: "I might be able to get to that this week." -> TENTATIVE, not \
  CONFIRMED, even though it names a task and an implied owner.

- DISCUSSED_ONLY: An idea, option, or task was raised and talked about, but \
  the transcript never shows anyone actually agreeing to do it or accepting \
  ownership of it.
  Example: "We could redesign the onboarding flow at some point." with no \
  follow-up agreement -> DISCUSSED_ONLY.

- NEEDS_INFO: The group clearly decided to do something (decisive language, \
  no hedging), but a required detail - who owns it, or when it's due - was \
  never stated in the transcript.
  Example: "Someone should send that email out." with no owner and no \
  deadline ever mentioned -> NEEDS_INFO, and you must also produce a short \
  clarifying_question asking for exactly the missing detail(s).

IMPORTANT RULES:
1. When you are unsure whether something is CONFIRMED or one of the other \
   three categories, choose the LOWER-confidence category (TENTATIVE, \
   DISCUSSED_ONLY, or NEEDS_INFO). Never guess CONFIRMED to be helpful.
2. The "quote" field for every item MUST be copied verbatim, word-for-word, \
   from the transcript you were given. Do not paraphrase, shorten, or \
   combine text from different parts of the transcript into one quote.
3. Only fill in "owner" or "deadline" if they were actually stated in the \
   transcript. Do not infer a deadline like "by the next meeting" unless \
   that phrase (or an equivalent explicit statement) is actually in the text.
4. Return ONLY valid JSON matching the schema below. No prose before or \
   after the JSON, no markdown code fences.

Schema - return a JSON object with a single key "items", a list of objects, \
each with exactly these fields:
{
  "title": "short description of the candidate action item",
  "owner": "name stated in transcript, or null",
  "deadline": "date/timeframe stated in transcript, or null",
  "classification": "CONFIRMED | TENTATIVE | DISCUSSED_ONLY | NEEDS_INFO",
  "reasoning": "one or two sentences explaining why you chose this \
classification, separate from the quote itself",
  "quote": "verbatim quote from the transcript backing this item",
  "clarifying_question": "only present when classification is NEEDS_INFO; \
a short question asking for the missing owner and/or deadline, otherwise null"
}
"""

REQUIRED_FIELDS = {"title", "owner", "deadline", "classification", "reasoning", "quote"}


def parse_classification_response(raw_text: str) -> list[dict]:
    """Defensively parse the model's JSON reply into a list of item dicts.

    Never raises on malformed model output - returns an empty list and
    prints what went wrong instead, so one bad response can't crash a run.
    """
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        print(f"[reason] ERROR: model did not return valid JSON: {exc}")
        return []

    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        print("[reason] ERROR: JSON response missing an 'items' list")
        return []

    valid_items = []
    for i, item in enumerate(items):
        if not isinstance(item, dict) or not REQUIRED_FIELDS.issubset(item.keys()):
            print(f"[reason] WARNING: skipping malformed item at index {i}: {item!r}")
            continue
        item.setdefault("clarifying_question", None)
        valid_items.append(item)

    return valid_items


async def classify_transcript(transcript_text: str) -> list[dict]:
    """Send a transcript to the model and return parsed candidate items."""
    print(f"[reason] sending transcript to model='{MODEL_NAME}' for classification")
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript_text},
        ],
        response_format={"type": "json_object"},
    )
    return parse_classification_response(response.choices[0].message.content)
