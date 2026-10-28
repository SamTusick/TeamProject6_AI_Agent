"""Model connection shared by every agent.

MODEL_NAME lives in .env so switching models (qwen3, glm-5, anything else the
endpoint hosts) never requires a code change.

Run this module directly for a trivial connectivity smoke test:

    python -m backend.core.llm_client
"""

import asyncio
import os

from dotenv import load_dotenv
from openai import APIError, AsyncOpenAI

from backend.core.config import REPO_ROOT

load_dotenv(REPO_ROOT / ".env")

MODEL_NAME = os.getenv("MODEL_NAME", "qwen3")

# The hosted endpoint is shared and sometimes stalls on long prompts, so every
# request has a timeout and falls back to the next model instead of hanging.
REQUEST_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "40"))
FALLBACK_MODELS = [
    name.strip() for name in os.getenv("FALLBACK_MODELS", "qwen3-small,gpt-oss").split(",") if name.strip()
]

# Models that failed earlier in this process are skipped, so a dead model is
# not waited on again at every step of a multi-call run.
_failed_models: set[str] = set()

client = AsyncOpenAI(
    base_url=os.getenv("NRP_BASE_URL"),
    api_key=os.getenv("NRP_API_KEY"),
    timeout=REQUEST_TIMEOUT_SECONDS,
    max_retries=0,
)


async def complete_json(messages: list[dict]) -> str:
    """One chat turn that must return a JSON object.

    Tries MODEL_NAME first, then each fallback model, moving on after a
    timeout, API error or empty reply. Raises RuntimeError if all fail.
    """
    chain = [MODEL_NAME, *(m for m in FALLBACK_MODELS if m != MODEL_NAME)]
    last_error = None
    for model in [m for m in chain if m not in _failed_models] or chain:
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
            )
        except APIError as error:
            last_error = f"{type(error).__name__}: {error}"
        else:
            content = response.choices[0].message.content
            if content:
                return content
            last_error = "empty reply"
        _failed_models.add(model)
        print(f"[reason] model '{model}' failed ({last_error}); trying the next model")
    raise RuntimeError(f"All models failed. Last error: {last_error}")


async def _smoke_test():
    print(f"[reason] sending trivial prompt to model='{MODEL_NAME}'")
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": "Reply with exactly: NRP connection OK"}],
    )
    print(f"[reason] model replied: {response.choices[0].message.content}")


if __name__ == "__main__":
    asyncio.run(_smoke_test())
