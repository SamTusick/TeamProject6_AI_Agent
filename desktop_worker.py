import asyncio
import contextlib
import json
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
        print(json.dumps({"error": "Analysis failed. Check NRP settings, network access, and model availability.",
                          "type": type(error).__name__}))
        sys.exit(1)


if __name__ == "__main__":
    main()