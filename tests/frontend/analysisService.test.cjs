const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { runAnalysis } = require("../../frontend/main/services/analysisService.cjs");

function analysisWorker(response, code = 0) {
  return {
    exists: () => true,
    spawn: (_python, args, options) => {
      assert.deepEqual(args, ["-X", "utf8", "-m", "backend.workers.analysis_worker"]);
      assert.equal(options.windowsHide, true);
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.kill = () => child.emit("close", 1);
      let input = "";
      child.stdin.on("data", (chunk) => { input += chunk; });
      child.stdin.on("finish", () => {
        assert.equal(JSON.parse(input).transcript, "Taylor: I will send it.");
        child.stdout.write(response);
        child.emit("close", code);
      });
      return child;
    },
  };
}

const transcript = "Taylor: I will send it.";

test("analysis returns the worker's items", async () => {
  const items = [{ title: "Send it" }];
  assert.deepEqual(await runAnalysis("project", transcript, analysisWorker(JSON.stringify({ items }))), items);
});

test("analysis rejects invalid, failed and unavailable workers", async () => {
  await assert.rejects(runAnalysis("project", transcript, analysisWorker("not json")), /invalid response/);
  await assert.rejects(runAnalysis("project", transcript, analysisWorker('{"items":"x"}')), /Invalid analysis response/);
  await assert.rejects(runAnalysis("project", transcript, analysisWorker('{"error":"Model offline"}', 1)), /Model offline/);
  await assert.rejects(runAnalysis("project", transcript, { exists: () => false }), /venv is missing/);
  await assert.rejects(runAnalysis("project", "   "), /Transcript must contain/);
});
