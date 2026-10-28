"""Model connection shared by every agent.

MODEL_NAME lives in .env so switching models (qwen3, glm-5, anything else the
endpoint hosts) never requires a code change.

Run this module directly for a trivial connectivity smoke test:

    python -m backend.core.llm_client
"""

import asyncio
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

from backend.core.config import REPO_ROOT

load_dotenv(REPO_ROOT / ".env")

MODEL_NAME = os.getenv("MODEL_NAME", "qwen3")

client = AsyncOpenAI(
    base_url=os.getenv("NRP_BASE_URL"),
    api_key=os.getenv("NRP_API_KEY"),
)


async def complete_json(messages: list[dict]) -> str:
    """One chat turn that must return a JSON object (used by the Resolver agent)."""
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


async def _smoke_test():
    print(f"[reason] sending trivial prompt to model='{MODEL_NAME}'")
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": "Reply with exactly: NRP connection OK"}],
    )
    print(f"[reason] model replied: {response.choices[0].message.content}")


if __name__ == "__main__":
    asyncio.run(_smoke_test())
