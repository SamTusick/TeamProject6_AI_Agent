const { spawn: nodeSpawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function resolvePython(root, exists = fs.existsSync) {
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!exists(python))
    throw new Error(
      "Project .venv is missing. Install the Python requirements first.",
    );
  return python;
}

// Sends one JSON request on stdin and resolves with the parsed JSON reply.
function runPythonWorker({
  python,
  root,
  module,
  request,
  messages,
  timeoutMs,
  maxOutput,
  spawn = nodeSpawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-X", "utf8", "-m", module], {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let failure;
    const timer = setTimeout(() => {
      failure = messages.timeout;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (failure) return;
      output += chunk;
      if (output.length > maxOutput) {
        failure = messages.tooMuchData;
        child.kill();
      }
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error(messages.start));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(new Error(failure));
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error)
          throw new Error(result.error || messages.failed);
        resolve(result);
      } catch (error) {
        reject(
          new Error(error instanceof SyntaxError ? messages.invalid : error.message),
        );
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

module.exports = { resolvePython, runPythonWorker };
