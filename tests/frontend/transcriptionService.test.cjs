const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { runLocalTranscription } = require("../../frontend/main/services/transcriptionService.cjs");

function localWorker(response, code = 0) {
  return {
    exists: () => true,
    spawn: (_python, args, options) => {
      assert.deepEqual(args, ["-X", "utf8", "-m", "backend.workers.transcription_worker"]);
      assert.equal(options.windowsHide, true);
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.kill = () => child.emit("close", 1);
      let input = "";
      child.stdin.on("data", (chunk) => { input += chunk; });
      child.stdin.on("finish", () => {
        const request = JSON.parse(input);
        assert.equal(request.audioPath, "meeting.webm");
        assert.equal(request.backend, "whisper");
        assert.ok(request.checkpoint.endsWith("checkpoint.pt"));
        assert.equal(request.key, undefined);
        child.stdout.write(response);
        child.emit("close", code);
      });
      return child;
    },
  };
}

test("local transcription runs Whisper without credentials", async () => {
  assert.equal(await runLocalTranscription("project", "meeting.webm", localWorker(JSON.stringify({ text: "send the report" }))), "send the report");
});

test("local transcription rejects blank, malformed and failed worker responses", async () => {
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker('{"text":""}')), /returned no words/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker("not json")), /could not return a result/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker('{"error":"Invalid audio"}', 1)), /Invalid audio/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", { exists: () => false }), /venv is missing/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", { backend: "checkpoint", exists: (name) => !name.endsWith("checkpoint.pt") }), /checkpoint is missing/);
});
