# TeamProject6_AI_Agent — M2 Prototype

## Desktop preview

The repository now includes our own Windows Electron meeting companion, with no
Fireflies or Otter dependency. Run `npm start` to build and open it. It records
microphone plus system audio while you attend a call, supports transcript import,
and provides source-checked action review and separate meeting history.

See [Desktop setup and limitations](docs/DESKTOP.md) for speech-provider setup,
privacy details, tests, and the real-call validation checklist. The original CLI
prototype described below remains available and unchanged.

Small teams lose confirmed decisions after meetings because nobody reliably tells a real commitment apart from a hedge or an idea that was only discussed.

## What it can do right now

Given a plain-text transcript, `agent.py` sends it to an NRP-hosted model (Qwen3 by default, swappable to GLM-5 via `.env`) which extracts candidate action items and classifies each as `CONFIRMED`, `TENTATIVE`, `DISCUSSED_ONLY`, or `NEEDS_INFO`, with a verbatim source quote for each. The agent's own code — not the model — then independently verifies every quote actually appears in the transcript, and only `CONFIRMED` items with both an owner and a deadline reach a human approve/reject prompt in the terminal. Approved items are written to `output/action_items.json` through a real tool call to the official MCP Filesystem server (launched over stdio as a subprocess, sandboxed to `./output` only), then read back through the same server and printed to confirm the write. Every stage prints a labeled trace line (`[perceive]`, `[reason]`, `[guardrail]`, `[confirm]`, `[tool call]`, `[tool result]`, `[output]`).

## Intentionally not implemented

Live meeting join, Otter integration, Jira/Google Calendar writes (planned), embedding-based retrieval.

## Setup

1. Node.js is required for the MCP server. Check with `node --version` and `npx --version` (tested against Node 22.x).
2. `npm install` — installs the pinned MCP filesystem server into `node_modules/`. Recommended: the agent then launches the server directly with `node`, which is much faster than the `npx` shim (~1.4s vs ~8s per session) and uses a version pinned in `package.json` instead of re-resolving the package on every launch. If you skip it, the agent still works by falling back to `npx`.
3. Create a virtual environment: `python -m venv .venv`, then activate it.
4. `pip install -r requirements.txt`
5. Copy `.env.example` to `.env` and fill in `NRP_API_KEY`, `NRP_BASE_URL`, and `MODEL_NAME`.

## Run

```
python agent.py tests/transcripts/a_confirmed.txt
python agent.py <your-transcript.txt> --approve-all   # skip interactive prompts
python tests/run_tests.py                              # 6 live test cases (real model + MCP)
python -m unittest discover -s tests -p test_multi_agent.py   # offline agent/memory tests (set PYTHONPATH=.)
```

Set `MODEL_NAME=glm-5` in `.env` (or the environment) if the default `qwen3` endpoint is slow.

## Multi-agent design (M3)

```
transcript -> [Extractor agent] --NEEDS_INFO item--> [Resolver agent (ReAct)] --evidence or give-up--+
                     |                                   tools: search_transcript, search_memory    |
                     +<------------------------------------------------------------------------------+
              quote guardrail (code, no LLM) -> memory duplicate check -> human confirm
              -> MCP filesystem write + read-back -> memory.remember()
```

| Piece | File | Role |
|---|---|---|
| Extractor agent | `llm_client.py` | Classifies candidate items as `CONFIRMED` / `TENTATIVE` / `DISCUSSED_ONLY` / `NEEDS_INFO` with a verbatim quote. |
| Resolver agent | `resolver_agent.py` | Receives `NEEDS_INFO` items and tries to find the missing owner/deadline. |
| Handoff | `hand_off_needs_info()` | **Trigger:** classification is `NEEDS_INFO`. **Payload:** the item, its missing fields, the full transcript, and the memory store. **Return:** the item, upgraded to `CONFIRMED` only with cited evidence. |
| Reasoning pattern | `resolver_agent.py` | ReAct: each step prints `[thought]`, `[action]`, `[observation]`; max 5 steps; actions are `search_transcript`, `search_memory`, `finish`. |
| Knowledge/memory layer | `memory.py` | Persistent store of human-approved items (`output/memory.json`) with TF-IDF keyword retrieval (`search`) and duplicate detection (`find_duplicate`). |
| Guardrails | `verify.py`, `resolver_agent.validate_resolution` | Owner/deadline from the Resolver are accepted only if their quote appears verbatim in the transcript and contains the claimed value. Memory is a hint, never evidence. Humans still approve every item. |

## CHANGES

- **Second agent + explicit handoff.** New Resolver agent; `agent.py` is now the orchestrator that hands `NEEDS_INFO` items to it.
- **ReAct reasoning** in the Resolver, with a capped loop and a visible thought/action/observation trace.
- **Memory layer (`memory.py`).** Approved items persist across meetings; probable duplicates are flagged (skipped under `--approve-all`). This replaces the M2 "no memory across meetings" limitation. `MEMORY_FILE` env var overrides the location.
- **Desktop app** also runs the Resolver for `NEEDS_INFO` items (`desktop_worker.py`).
- **Tests:** `tests/test_multi_agent.py` (13 offline tests with a scripted fake LLM) and a new live case `f_resolvable` in `tests/run_tests.py`.
- **Wispr Flow transcription (desktop app).** Recordings can now be transcribed with the Wispr Flow REST API (`Transcribe with Wispr Flow`, key stored under Connections with OS-protected encryption). The renderer converts the WebM recording to 16 kHz PCM16 WAV in ≤5-minute chunks (`desktop/ui/wav.js`), and `transcribeWispr` in `desktop/services.cjs` sends each chunk with bearer auth. Honest limits: Wispr Flow is a dictation model that removes filler words and applies self-corrections, so the transcript is not word-for-word and the quote-verification guardrail checks against that cleaned text; it is also tuned for one speaker, so multi-speaker call audio may lose or merge content. Audio leaves the device only after a consent prompt. The unused OpenAI-compatible speech connection (never called by the app) was removed, so Wispr Flow is the only cloud speech option.

## Known limitations

5. **Multi-agent limits.** The Resolver only fires for `NEEDS_INFO`; a strong Extractor often resolves cross-line owners itself, so the handoff is rare on clean transcripts (and on `d_needs_info` the Resolver correctly gives up). Memory retrieval is lexical, not embedding-based, so paraphrased duplicates are missed. Memory only holds items a human approved, and is a plain JSON file with no concurrency control. The default `qwen3` endpoint was hanging during our last test session, so those runs used `MODEL_NAME=glm-5`.

1. **Classification is not perfectly deterministic.** The same transcript can occasionally produce slightly different item titles or, for genuinely ambiguous phrasing, a different classification between runs, since it depends on a live LLM call. Our test suite passed on the runs we performed, but it is not guaranteed to pass every time.
2. **`output/action_items.json` is fully overwritten on each run.** Approving items from a second meeting will erase items written from an earlier one; there is no merging or history across runs yet.
3. **`NEEDS_INFO` clarifying questions are only printed to the console.** They are not saved anywhere, so if you don't act on them during the run, that information is lost.
4. **The MCP server used to die with `MCPError: Connection closed` when run from Git Bash (fixed).** The MCP SDK hands the server subprocess `sys.stderr` as its own stderr. In a Git Bash/mintty terminal that is an MSYS pseudo-terminal rather than a real Windows handle, so the Node server was killed by its own first stderr write — which it makes while answering `initialize`, meaning the session always connected and then dropped on the very next request. `mcp_session()` now points the subprocess's stderr at `mcp_server.log` instead, which fixes it and also makes the server's diagnostics readable (they were previously discarded by the terminal). `mcp_client.py` additionally retries the write/read-back up to 3 times from a fresh session, so a one-off transport failure still recovers.
