# TeamProject6_AI_Agent — M2 Prototype

Small teams lose confirmed decisions after meetings because nobody reliably tells a real commitment apart from a hedge or an idea that was only discussed.

## What it can do right now

Given a plain-text transcript, `agent.py` sends it to an NRP-hosted model (Qwen3 by default, swappable to GLM-5 via `.env`) which extracts candidate action items and classifies each as `CONFIRMED`, `TENTATIVE`, `DISCUSSED_ONLY`, or `NEEDS_INFO`, with a verbatim source quote for each. The agent's own code — not the model — then independently verifies every quote actually appears in the transcript, and only `CONFIRMED` items with both an owner and a deadline reach a human approve/reject prompt in the terminal. Approved items are written to `output/action_items.json` through a real tool call to the official MCP Filesystem server (launched via `npx`, sandboxed to `./output` only), then read back through the same server and printed to confirm the write. Every stage prints a labeled trace line (`[perceive]`, `[reason]`, `[guardrail]`, `[confirm]`, `[tool call]`, `[tool result]`, `[output]`).

## Intentionally not implemented (v1)

Live meeting join, Otter integration, Jira/Google Calendar writes (planned for v2), memory across meetings, multi-agent design.

## Setup

1. Node.js is required for the MCP server. Check with `node --version` and `npx --version` (tested against Node 22.x).
2. Create a virtual environment: `python -m venv .venv`, then activate it.
3. `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill in `NRP_API_KEY`, `NRP_BASE_URL`, and `MODEL_NAME`.

## Run

```
python agent.py tests/transcripts/a_confirmed.txt
python agent.py <your-transcript.txt> --approve-all   # skip interactive prompts
python tests/run_tests.py                              # 4 synthetic test cases
```

## Known limitations

1. **Classification is not perfectly deterministic.** The same transcript can occasionally produce slightly different item titles or, for genuinely ambiguous phrasing, a different classification between runs, since it depends on a live LLM call. Our test suite passed on the runs we performed, but it is not guaranteed to pass every time.
2. **`output/action_items.json` is fully overwritten on each run.** Approving items from a second meeting will erase items written from an earlier one; there is no merging or history across runs yet.
3. **`NEEDS_INFO` clarifying questions are only printed to the console.** They are not saved anywhere, so if you don't act on them during the run, that information is lost.
