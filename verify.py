"""Quote-verification guardrail.

Independently checks that a model-provided source quote actually
appears in the transcript (whitespace/case-normalized substring
check), instead of trusting the model's own classification. This is
the core defense against a hallucinated or misattributed "decision."
Deliberately has no LLM calls of its own - it must not share the
model's blind spots.
"""


def normalize(text: str) -> str:
    """Collapse all whitespace runs to single spaces and lowercase.

    This is intentionally lenient (the model may reformat line breaks
    or repeated spaces when copying a quote) but still requires the
    actual words and order to match the transcript exactly.
    """
    return " ".join(text.split()).lower()


def quote_found_in_transcript(quote: str, transcript: str) -> bool:
    """Return True only if quote appears verbatim (normalized) in transcript."""
    if not quote:
        return False
    return normalize(quote) in normalize(transcript)


def is_eligible(item: dict, transcript: str) -> bool:
    """An item is eligible to be written only if ALL of these hold:
    - the model classified it as CONFIRMED
    - it has both an owner and a deadline
    - its quote independently verifies against the transcript
    """
    return (
        item.get("classification") == "CONFIRMED"
        and bool(item.get("owner"))
        and bool(item.get("deadline"))
        and quote_found_in_transcript(item.get("quote", ""), transcript)
    )


def eligibility_reason(item: dict, transcript: str) -> str:
    """Human-readable reason an item is NOT eligible, for console tracing."""
    if item.get("classification") != "CONFIRMED":
        return f"classification is {item.get('classification')}, not CONFIRMED"
    if not item.get("owner"):
        return "missing owner"
    if not item.get("deadline"):
        return "missing deadline"
    if not quote_found_in_transcript(item.get("quote", ""), transcript):
        return "quote not found verbatim in transcript (possible hallucination)"
    return "eligible"
