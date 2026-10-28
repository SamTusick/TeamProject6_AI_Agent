const { text } = require("../models/meetingStore.cjs");
const { resolvePython, runPythonWorker } = require("./pythonRunner.cjs");

const messages = {
  timeout: "Analysis timed out. Your transcript is saved; you can retry.",
  start: "Could not start the Python worker. Check the project virtual environment.",
  invalid: "The analysis worker returned an invalid response.",
  failed: "Analysis failed.",
};

async function runAnalysis(root, transcript, options = {}) {
  text(transcript, "Transcript");
  const result = await runPythonWorker({
    python: resolvePython(root, options.exists),
    root,
    module: "backend.workers.analysis_worker",
    request: { transcript },
    messages,
    timeoutMs: 300_000,
    maxOutput: 2_000_000,
    spawn: options.spawn,
  });
  if (!Array.isArray(result.items))
    throw new Error("Invalid analysis response.");
  return result.items;
}

module.exports = { runAnalysis };
