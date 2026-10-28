# Team6 Meetings: Desktop Preview

## Scope

This is our own Windows meeting companion, not a Fireflies or Otter connector.
It runs while the user attends Zoom, Microsoft Teams, or another call application.
It does not join meetings independently, schedule a bot, or stream live captions.
Recording, transcription, and action analysis are separate, explicit operations.

The desktop app is a development preview launched from this checkout. A signed
installer with bundled Python, updates, and production crash recovery is not yet
provided.

## Run

Prerequisites: Windows, Node.js compatible with the installed Vite/Electron
versions, and a Python virtual environment at the repository's `.venv` path.
Development validation used Node 22.14.0 and Python 3.11.9.

```powershell
npm install
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm start
```

Skip virtual-environment creation when `.venv` already exists. `npm start` builds
the UI and opens a native Electron window; there is no web server to visit.

Action analysis uses the existing local `.env` values:

```dotenv
NRP_API_KEY=your-own-key
NRP_BASE_URL=https://ellm.nrp-nautilus.io/v1
MODEL_NAME=qwen3
```

Enter keys locally, never in chat or committed files. The desktop does not display
the NRP key or alter the original CLI configuration.

## Workflows

### Transcript review

1. Choose **New meeting**, paste a transcript, or import a UTF-8 `.txt` file.
2. Choose **Analyze** and confirm sending the transcript to the configured model.
3. Review each candidate's owner, deadline, reasoning, and source quote.
4. Approve or reject items. Only confirmed items with a nonempty owner, deadline,
   and matching source quote are approvable. These rules are checked again in
   the main process when saving and exporting.
5. Export approved items as JSON. Editing the transcript clears its previous
   analysis and decisions; reanalysis also resets decisions after success.

Quote matching normalizes whitespace and case. Matching establishes textual
support, not that a model inferred the correct owner or understood the decision.
Human review remains necessary.

### Recording

1. Attend your call in Zoom, Teams, or another Windows application.
2. Select **Record a meeting** (also available inside **New meeting**).
3. Inform participants, obtain permission, and accept the recording prompt.
4. The recorder mixes the default microphone and Windows system playback audio.
   The visible level display shows the mixed signal, not separate source meters.
5. Stop recording, then play back the locally saved WebM to check both sides.

The implementation uses Electron's Windows loopback capture, Web Audio mixing,
and MediaRecorder with Opus audio. Electron requests a temporary screen stream
to obtain system audio, but only audio is recorded or stored. All capture tracks
are stopped when the recording stops or setup fails.

Recordings are limited to 30 minutes and 24 MB. Use headphones to reduce echo.
System capture includes other apps and notifications, not just the meeting.
Microphone selection currently follows the Windows default. There is no
independent speaker identification or automatic participant-name assignment.
Ensure important names are stated or review/correct the transcript before analysis.

### Speech transcription

Local transcription uses the open-source Whisper base model
(`openai/whisper-base.en` by default) through Hugging Face `transformers`.
Audio stays on-device and no speech API key is needed. Install
`requirements-speech.txt` in `.venv`; the model (about 150 MB) downloads on first
use, so that first run needs internet. Set `WHISPER_MODEL=openai/whisper-base` for
non-English audio. Choose **Transcribe locally (Whisper)** on a saved recording
and confirm local processing. No recording is ever uploaded for transcription.

The worker decodes WebM/Opus into mono 16 kHz audio and runs Whisper on 30-second
chunks (chunk edges can split a word). It has a 10-minute timeout. A nonempty
result replaces the meeting transcript and invalidates prior decisions. Empty
predictions or errors preserve the recording, transcript, and decisions. Whisper
base is only moderately accurate, so review the text. Restart Electron after
updating the code; reloading only the renderer does not update the backend.

Our own from-scratch model ([SPEECH_TRAINING.md](SPEECH_TRAINING.md)) is still in
the repo. The worker uses it when a request sets `"backend": "checkpoint"`, but
the app UI no longer exposes it.

## Project layout

```text
frontend/
  main/                      Electron main process (CommonJS)
    main.cjs                 app lifecycle, window, protocol, capture permissions
    preload.cjs              contextBridge API exposed as window.meetings
    ipc.cjs                  sender-trust check, IPC handler wrapper, consent dialog
    activity.cjs             active recording and per-meeting busy tracking
    controllers/             IPC wiring only (meetings:*, recording:*)
    services/                Python worker runner, analysis and transcription services
    models/meetingStore.cjs  meeting persistence and approval rules
  renderer/                  React UI built by Vite
    main.jsx, App.jsx        entry point and composition
    components/              presentational components
    hooks/                   state and IPC orchestration
    lib/                     recorder, API handle, formatting helpers
    css/                     design tokens and per-area stylesheets
  dist/                      Vite build output (git-ignored)
```

The main process spawns the Python workers from the repository root with
`.venv\Scripts\python.exe -X utf8 -m <module>`: `backend.workers.analysis_worker`
for action analysis and `backend.workers.transcription_worker` for local
transcription. Both exchange one JSON request on stdin and one JSON reply on stdout.

## Data and Security

- Meetings are stored separately in Electron's `userData/meetings` directory,
  outside this checkout. On Windows, `userData` is under the user's application
  data directory. Each meeting has JSON metadata and, when recorded, WebM audio.
- Meeting files are not encrypted at rest. Protect the Windows user account and
  device. Delete a meeting to remove its local transcript, audio, and decisions;
  exported copies and provider-retained data are not deleted by that action.
- The app stores no API keys. Action analysis uses the NRP settings from the
  project `.env`, which is git-ignored.
- The renderer loads packaged local assets through a restricted custom scheme,
  with sandboxing and context isolation enabled and Node integration disabled.
  IPC exposes specific operations, validates the sender, and restricts file paths.
- Recording needs explicit consent, and closing is blocked during recording or
  model processing. Audio chunks are written during recording; a forced process
  termination may leave incomplete audio without usable metadata. Automatic
  crash recovery remains future work.
- Desktop persistence/export uses local JSON directly. The original CLI's MCP
  filesystem export behavior is unchanged and is not used by desktop history.

## Tests

```powershell
npm test
& .\.venv\Scripts\python.exe -m unittest discover -s tests/backend -t . -v
npm run test:desktop
```

JavaScript tests live in `tests/frontend/` and Python tests in `tests/backend/`.
`npm test` runs `tests/frontend/*.test.cjs`; `npm run test:desktop` builds the UI
and runs `tests/frontend/desktop.e2e.cjs`.

- Node tests cover approval enforcement, persistence, transcript invalidation,
  path validation, deletion, and the analysis and speech worker request/response
  contracts.
- Python tests cover independent quote verification and eligibility.
- Playwright launches the real Electron binary with isolated temporary data.
  It checks credential encryption, renderer isolation, review persistence,
  exports, transcript edits, synthetic audio recording/playback, visible waveform
  pixels, narrow layouts, and renderer exceptions. Native dialogs and capture
  devices are stubbed in these tests; no real microphone or meeting is recorded.
- Screenshots are generated in ignored `test-artifacts/`.
- A live service-bridge check has succeeded using a synthetic sentence and the
  configured NRP model. The local speech flow is tested with generated WebM,
  the actual local model, and preservation on blank output.
  This does not establish useful recognition accuracy or real-call performance.

The existing live CLI suite remains `python tests/run_tests.py`. It is separate
from offline desktop tests, makes model calls, and can vary between runs.

## Real-Call Acceptance Checklist

Before using this preview for important meetings:

1. Run a short, consented Zoom test and a Teams test with another participant.
2. Verify both your own microphone and the remote participant in recorded playback.
3. Verify denial of microphone permission shows an error and releases capture.
4. Test headphones, the default output device, muting, and device disconnection.
5. Train and evaluate a useful checkpoint, then verify local transcription accuracy.
6. Check speaker/owner accuracy, quotes, deadlines, approval persistence, and export.

These hardware/platform checks have not been completed automatically. Independent
meeting bots, live transcription, production-quality speech models, diarization, and installer
distribution are later milestones, not current capabilities.
