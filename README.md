# TeamProject6_AI_Agent — Multi-Agent Meeting Action Items (M3)

Small teams lose confirmed decisions after meetings because nobody reliably tells a real commitment apart from a hedge or an idea that was only discussed. Two cooperating agents read a meeting transcript and produce **human-approved, source-quoted action items**.

## Project structure

```
backend/                 Python (top of the stack)
  agents/                extractor.py · resolver.py (ReAct) · handoff.py
  core/                  config.py · llm_client.py · guardrails.py · memory.py
  tools/                 mcp_client.py (MCP filesystem server)
  speech/                Whisper backend + our own from-scratch speech model
  workers/               analysis_worker.py · transcription_worker.py (launched by the app)
  pipeline.py · review.py · main.py     orchestration, human review, CLI entry point
docs/                    DESKTOP.md · SPEECH_TRAINING.md · report/ (M3 report source + PDF)
tests/
  backend/               offline Python unit tests
  frontend/              JS unit tests + Electron end-to-end test
  transcripts/ expected/ fixtures for the live suite · run_tests.py (live suite)
frontend/                Electron desktop app (bottom of the stack)
  main/                  controllers/ · services/ · models/ · preload.cjs · main.cjs
  renderer/              React UI: components/ · hooks/ · lib/ · css/
```

## Desktop app

Our own Windows Electron meeting companion has no Fireflies or Otter dependency. Run `npm start` to build and open it. It records microphone plus system audio while you attend a call, transcribes on-device with open-source Whisper, supports transcript import, and provides source-checked action review and separate meeting history. See [Desktop setup and limitations](docs/DESKTOP.md).

## What it can do right now

Given a plain-text transcript, the CLI (`python -m backend.main`) sends it to an NRP-hosted model (Qwen3 by default, swappable to GLM-5 via `.env`) which extracts candidate action items and classifies each as `CONFIRMED`, `TENTATIVE`, `DISCUSSED_ONLY`, or `NEEDS_INFO`, with a verbatim source quote for each. The code — not the model — then independently verifies every quote actually appears in the transcript, and only `CONFIRMED` items with both an owner and a deadline reach a human approve/reject prompt in the terminal. Approved items are written to `output/action_items.json` through a real tool call to the official MCP Filesystem server (launched over stdio as a subprocess, sandboxed to `./output` only), then read back through the same server and printed to confirm the write. Every stage prints a labeled trace line (`[perceive]`, `[reason]`, `[handoff]`, `[thought]`, `[action]`, `[observation]`, `[guardrail]`, `[confirm]`, `[tool call]`, `[tool result]`, `[memory]`, `[output]`).

## Intentionally not implemented

Live meeting join, Otter integration, Jira/Google Calendar writes (planned), embedding-based retrieval.

## Setup

1. Node.js is required for the MCP server. Check with `node --version` and `npx --version` (tested against Node 22.x).
2. `npm install` — installs the pinned MCP filesystem server into `node_modules/`. Recommended: the agent then launches the server directly with `node`, which is much faster than the `npx` shim (~1.4s vs ~8s per session) and uses a version pinned in `package.json` instead of re-resolving the package on every launch. If you skip it, the agent still works by falling back to `npx`.
3. Create a virtual environment: `python -m venv .venv`, then activate it.
4. `pip install -r requirements.txt` (add `requirements-speech.txt` for local Whisper transcription in the desktop app).
5. Copy `.env.example` to `.env` and fill in `NRP_API_KEY`, `NRP_BASE_URL`, and `MODEL_NAME`.

## Run

Run everything from the repository root.

```
python -m backend.main tests/transcripts/a_confirmed.txt
python -m backend.main <your-transcript.txt> --approve-all    # skip interactive prompts
python -m tests.run_tests                                     # 6 live test cases (real model + MCP)
python -m unittest discover -s tests/backend -t .             # offline Python tests (no network)
npm test                                                      # JS unit tests
npm run test:desktop                                          # Electron end-to-end test
npm start                                                     # desktop app
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
| Extractor agent | `backend/agents/extractor.py` | Classifies candidate items as `CONFIRMED` / `TENTATIVE` / `DISCUSSED_ONLY` / `NEEDS_INFO` with a verbatim quote. |
| Resolver agent | `backend/agents/resolver.py` | Receives `NEEDS_INFO` items and tries to find the missing owner/deadline. |
| Handoff | `backend/agents/handoff.py` | **Trigger:** classification is `NEEDS_INFO`. **Payload:** the item, its missing fields, the full transcript, and the memory store. **Return:** the item, upgraded to `CONFIRMED` only with cited evidence. |
| Reasoning pattern | `backend/agents/resolver.py` | ReAct: each step prints `[thought]`, `[action]`, `[observation]`; max 5 steps; actions are `search_transcript`, `search_memory`, `finish`. |
| Knowledge/memory layer | `backend/core/memory.py` | Persistent store of human-approved items (`output/memory.json`) with TF-IDF keyword retrieval (`search`) and duplicate detection (`find_duplicate`). |
| Guardrails | `backend/core/guardrails.py`, `resolver.validate_resolution` | Owner/deadline from the Resolver are accepted only if their quote appears verbatim in the transcript and contains the claimed value. Memory is a hint, never evidence. Humans still approve every item. |

## CHANGES

- **Second agent + explicit handoff.** New Resolver agent; `backend/pipeline.py` orchestrates and hands `NEEDS_INFO` items to it through `backend/agents/handoff.py`.
- **ReAct reasoning** in the Resolver, with a capped loop and a visible thought/action/observation trace.
- **Memory layer (`backend/core/memory.py`).** Approved items persist across meetings; probable duplicates are flagged (skipped under `--approve-all`). This replaces the M2 "no memory across meetings" limitation. `MEMORY_FILE` env var overrides the location.
- **Desktop app** also runs the Resolver for `NEEDS_INFO` items (`backend/workers/analysis_worker.py`).
- **Reorganized codebase.** Backend and frontend separated into `backend/` and `frontend/`; agents, core services, tools, workers, controllers, services, models, components, hooks and CSS each live in their own folder, and no file is a monolith.
- **New color scheme** (deep blue and light gray) for the Electron app, with the stylesheet split into `frontend/renderer/css/`.
- **Tests:** `tests/backend/test_agents.py` (13 offline tests with a scripted fake LLM), a new live case `f_resolvable` in `tests/run_tests.py`, and JS tests under `tests/frontend/`.
- **Local Whisper transcription (desktop app).** Recordings are transcribed on-device with the open-source Whisper base model (`Transcribe locally (Whisper)`). We first built an optional Wispr Flow cloud integration, then removed it because Wispr's public API is closed to new users, so it could never be run against the real service. No audio is uploaded for transcription, and the app stores no API keys.

## Known limitations

1. **Classification is not perfectly deterministic.** The same transcript can occasionally produce slightly different item titles or, for genuinely ambiguous phrasing, a different classification between runs, since it depends on a live LLM call. Our test suite passed on the runs we performed, but it is not guaranteed to pass every time.
2. **`output/action_items.json` is fully overwritten on each run.** Approving items from a second meeting will erase items written from an earlier one; there is no merging or history across runs yet.
3. **`NEEDS_INFO` clarifying questions are only printed to the console.** They are not saved anywhere, so if you don't act on them during the run, that information is lost.
4. **The MCP server used to die with `MCPError: Connection closed` when run from Git Bash (fixed).** The MCP SDK hands the server subprocess `sys.stderr` as its own stderr. In a Git Bash/mintty terminal that is an MSYS pseudo-terminal rather than a real Windows handle, so the Node server was killed by its own first stderr write — which it makes while answering `initialize`, meaning the session always connected and then dropped on the very next request. `mcp_session()` now points the subprocess's stderr at `mcp_server.log` instead, which fixes it and also makes the server's diagnostics readable (they were previously discarded by the terminal). `mcp_client.py` additionally retries the write/read-back up to 3 times from a fresh session, so a one-off transport failure still recovers.
5. **Multi-agent limits.** The Resolver only fires for `NEEDS_INFO`; a strong Extractor often resolves cross-line owners itself, so the handoff is rare on clean transcripts (and on `d_needs_info` the Resolver correctly gives up). Memory retrieval is lexical, not embedding-based, so paraphrased duplicates are missed. Memory only holds items a human approved, and is a plain JSON file with no concurrency control.
6. **The desktop app reads memory but does not write to it.** Only approvals made through the terminal CLI are remembered.
7. **No model timeout or fallback.** The default `qwen3` endpoint hung for several minutes during one test session and the agent simply waited; those runs used `MODEL_NAME=glm-5`.
8. **Local Whisper is only moderately accurate** (word errors on clean audio, untested on real multi-speaker calls), and its first run downloads about 150 MB.
