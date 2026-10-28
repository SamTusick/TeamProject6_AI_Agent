const fs = require("node:fs");
const path = require("node:path");
const { text } = require("../models/meetingStore.cjs");
const { resolvePython, runPythonWorker } = require("./pythonRunner.cjs");

const messages = {
  timeout: "Local transcription timed out. Your recording and transcript are unchanged.",
  tooMuchData: "The local speech worker returned too much data.",
  start: "Could not start the local speech worker. Check the project virtual environment.",
  invalid: "The local speech worker could not return a result. Install requirements-speech.txt and retry.",
  failed: "Local transcription failed. Install requirements-speech.txt and retry.",
};

async function runLocalTranscription(root, audioPath, options = {}) {
  const exists = options.exists || fs.existsSync;
  const python = resolvePython(root, exists);
  const checkpoint = path.join(root, ".models", "speech", "smoke-run", "checkpoint.pt");
  const backend = options.backend || "whisper";
  if (backend === "checkpoint" && !exists(checkpoint))
    throw new Error("Our local speech checkpoint is missing. Train the model before transcribing.");
  const result = await runPythonWorker({
    python,
    root,
    module: "backend.workers.transcription_worker",
    request: { audioPath, checkpoint, backend },
    messages,
    timeoutMs: options.timeoutMs ?? 600_000,
    maxOutput: 1_000_000,
    spawn: options.spawn,
  });
  if (typeof result.text !== "string" || !result.text.trim())
    throw new Error("The local speech model returned no words. Your recording and transcript are unchanged.");
  return text(result.text, "Transcription");
}

module.exports = { runLocalTranscription };
