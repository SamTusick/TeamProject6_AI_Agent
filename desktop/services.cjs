const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { text } = require("./store.cjs");

const WISPR_URL = "https://platform-api.wisprflow.ai/api/v1/dash/api";
const MAX_WISPR_WAV = 12_000_000;

// Wispr Flow's REST API takes base64 16 kHz PCM16 WAV, at most 6 minutes per request.
async function transcribeWispr(wav, key, fetcher = fetch) {
  if (!key) throw new Error("Add a Wispr Flow API key in Connections first.");
  if (
    !wav ||
    wav.length < 45 ||
    wav.length > MAX_WISPR_WAV ||
    wav.subarray(0, 4).toString("latin1") !== "RIFF"
  )
    throw new Error("Wispr Flow needs 16 kHz WAV audio of at most 6 minutes.");
  let response;
  try {
    response = await fetcher(WISPR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio: wav.toString("base64"),
        language: ["en"],
        context: { app: { type: "other" } },
      }),
      signal: AbortSignal.timeout(180_000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Wispr Flow could not be reached or timed out. Your recording is still saved locally.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Wispr Flow returned HTTP ${response.status}. Check the API key and your usage limits.`,
    );
  const result = await response.json();
  return typeof result.text === "string" ? result.text.trim() : "";
}

function runAnalysis(root, transcript) {
  text(transcript, "Transcript");
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!fs.existsSync(python))
    throw new Error(
      "Project .venv is missing. Install the Python requirements first.",
    );
  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      ["-X", "utf8", path.join(root, "desktop_worker.py")],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 2_000_000) child.kill();
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Could not start the Python worker. Check the project virtual environment.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        return reject(
          new Error(
            "Analysis timed out. Your transcript is saved; you can retry.",
          ),
        );
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error)
          throw new Error(result.error || "Analysis failed.");
        if (!Array.isArray(result.items))
          throw new Error("Invalid analysis response.");
        resolve(result.items);
      } catch (error) {
        reject(
          new Error(
            error instanceof SyntaxError
              ? "The analysis worker returned an invalid response."
              : error.message,
          ),
        );
      }
    });
    child.stdin.end(JSON.stringify({ transcript }));
  });
}

function runLocalTranscription(root, audioPath, options = {}) {
  const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const checkpoint = path.join(root, ".models", "speech", "smoke-run", "checkpoint.pt");
  const exists = options.exists || fs.existsSync;
  if (!exists(python))
    return Promise.reject(new Error("Project .venv is missing. Install the Python requirements first."));
  const backend = options.backend || "whisper";
  if (backend === "checkpoint" && !exists(checkpoint))
    return Promise.reject(new Error("Our local speech checkpoint is missing. Train the model before transcribing."));
  return new Promise((resolve, reject) => {
    const child = (options.spawn || spawn)(python, ["-X", "utf8", "-m", "speech.desktop_worker"], {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let failure;
    const timer = setTimeout(() => {
      failure = "Local transcription timed out. Your recording and transcript are unchanged.";
      child.kill();
    }, options.timeoutMs ?? 600_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (failure) return;
      output += chunk;
      if (output.length > 1_000_000) {
        failure = "The local speech worker returned too much data.";
        child.kill();
      }
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not start the local speech worker. Check the project virtual environment."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(new Error(failure));
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error)
          throw new Error(result.error || "Local transcription failed. Install requirements-speech.txt and retry.");
        if (typeof result.text !== "string" || !result.text.trim())
          throw new Error("The local speech model returned no words. Your recording and transcript are unchanged.");
        resolve(text(result.text, "Transcription"));
      } catch (error) {
        reject(new Error(error instanceof SyntaxError
          ? "The local speech worker could not return a result. Install requirements-speech.txt and retry."
          : error.message));
      }
    });
    child.stdin.end(JSON.stringify({ audioPath, checkpoint, backend }));
  });
}

module.exports = {
  transcribeWispr,
  runAnalysis,
  runLocalTranscription,
};
