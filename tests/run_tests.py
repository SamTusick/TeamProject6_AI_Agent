"""Non-interactive test runner for the M2 agent.

Drives the REAL pipeline (real NRP model call, real MCP filesystem
server) against each synthetic transcript in tests/transcripts/,
using approve_all=True so no typing is required. For each case it
checks:
  - the model's classification matches tests/expected/<case>.json
  - every returned item's quote independently verifies against the
    transcript (the guardrail didn't let a hallucinated quote through)
  - for the CONFIRMED case: the MCP write actually happened and the
    file reads back correctly
  - for every other case: no MCP write occurred at all

Run with:
    python tests/run_tests.py
"""

import asyncio
import json
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).parent
REPO_ROOT = TESTS_DIR.parent
TRANSCRIPTS_DIR = TESTS_DIR / "transcripts"
EXPECTED_DIR = TESTS_DIR / "expected"
OUTPUT_FILE = REPO_ROOT / "output" / "action_items.json"

sys.path.insert(0, str(REPO_ROOT))

from agent import run as run_agent  # noqa: E402
from verify import quote_found_in_transcript  # noqa: E402

CASES = ["a_confirmed", "b_tentative", "c_discussed_only", "d_needs_info"]


async def run_case(name: str) -> bool:
    expected = json.loads((EXPECTED_DIR / f"{name}.json").read_text(encoding="utf-8"))
    transcript_path = TRANSCRIPTS_DIR / f"{name}.txt"
    transcript_text = transcript_path.read_text(encoding="utf-8")

    print(f"\n{'=' * 60}\nTEST CASE: {name}\n{expected['description']}\n{'=' * 60}")

    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()

    result = await run_agent(str(transcript_path), approve_all=True)
    items = result["items"]

    checks = {}

    # 1. classification: at least one returned item matches the expected label
    matching = [i for i in items if i.get("classification") == expected["expected_classification"]]
    checks["classification"] = len(matching) >= 1
    if not checks["classification"]:
        found = [i.get("classification") for i in items]
        print(f"  [FAIL] expected an item classified {expected['expected_classification']!r}, "
              f"got: {found}")

    # 2. quote guardrail: every item's quote must independently verify
    bad_quotes = [i["title"] for i in items if not quote_found_in_transcript(i.get("quote", ""), transcript_text)]
    checks["quotes_verify"] = len(bad_quotes) == 0
    if bad_quotes:
        print(f"  [FAIL] items with unverifiable quotes: {bad_quotes}")

    # 3. MCP write happened iff expected
    write_happened = OUTPUT_FILE.exists()
    checks["write_matches_expectation"] = write_happened == expected["expect_mcp_write"]
    if not checks["write_matches_expectation"]:
        print(f"  [FAIL] expected write={expected['expect_mcp_write']}, "
              f"but output/action_items.json exists={write_happened}")

    # 4. if a write was expected, confirm the read-back content is sane
    if expected["expect_mcp_write"] and write_happened:
        written = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        checks["readback_matches"] = any(
            i.get("classification") == "CONFIRMED" for i in written
        )
        if not checks["readback_matches"]:
            print(f"  [FAIL] action_items.json read back but has no CONFIRMED item: {written}")
    else:
        checks["readback_matches"] = True

    passed = all(checks.values())
    print(f"  RESULT: {'PASS' if passed else 'FAIL'} ({checks})")
    return passed


async def main() -> None:
    results = {}
    for name in CASES:
        results[name] = await run_case(name)

    print(f"\n{'=' * 60}\nSUMMARY\n{'=' * 60}")
    for name, passed in results.items():
        print(f"  {name}: {'PASS' if passed else 'FAIL'}")

    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()

    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    asyncio.run(main())
