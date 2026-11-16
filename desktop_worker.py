import asyncio
import contextlib
import json
import os
import sys

from verify import eligibility_reason, is_eligible, quote_found_in_transcript


def review_items(items: list[dict], transcript: str) -> list[dict]:
    reviewed = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        clean = {
            field: item.get(field) if isinstance(item.get(field), str) else ""
            for field in (
                "title", "owner", "deadline", "classification", "reasoning",
                "quote", "clarifying_question",
            )
        }
        clean.update(
            id=str(index),
            verified=quote_found_in_transcript(clean["quote"], transcript),
            eligible=is_eligible(clean, transcript),
            reason=eligibility_reason(clean, transcript),
        )
        reviewed.append(clean)
    return reviewed


async def process(request: dict) -> dict:
    transcript = request.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        raise ValueError("A nonempty transcript is required.")
    if len(transcript) > 100_000:
        raise ValueError("Transcript exceeds the 100,000 character limit.")
    from llm_client import classify_transcript
    from memory import MeetingMemory
    from resolver_agent import hand_off_needs_info

    items = await classify_transcript(transcript)
    if not items:
        raise ValueError("The model returned no usable items. Review the transcript or try again.")
    items, _ = await hand_off_needs_info(items, transcript, MeetingMemory())
    return {"items": review_items(items, transcript)}


def main() -> None:
    try:
        request = json.loads(sys.stdin.read())
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(process(request))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({"error": describe_error(error), "type": type(error).__name__}))
        sys.exit(1)


def describe_error(error: Exception) -> str:
    """Turn a worker failure into a message the desktop UI can act on.

    The old blanket "check NRP settings" text made a slow model, a bad key
    and an empty extraction indistinguishable. Messages never include the
    API key: openai exceptions carry only status and server text.
    """
    import openai

    model = os.getenv("MODEL_NAME", "qwen3")
    if isinstance(error, ValueError):
        return str(error)
    if isinstance(error, openai.APITimeoutError):
        return (f"Model '{model}' did not answer within NRP_TIMEOUT_S. Try again, or set "
                "MODEL_NAME to a faster model in .env.")
    if isinstance(error, openai.AuthenticationError):
        return "NRP rejected the API key (HTTP 401). Check NRP_API_KEY in .env."
    if isinstance(error, openai.NotFoundError):
        return f"NRP does not serve model '{model}'. Check MODEL_NAME in .env."
    if isinstance(error, openai.APIConnectionError):
        return "Could not reach NRP. Check NRP_BASE_URL and your network connection."
    if isinstance(error, openai.APIStatusError):
        return f"NRP returned HTTP {error.status_code} for model '{model}': {str(error)[:200]}"
    return f"Analysis failed ({type(error).__name__}): {str(error)[:200]}"


if __name__ == "__main__":
    main()