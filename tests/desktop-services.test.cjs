const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { transcribeWispr, runLocalTranscription } = require("../desktop/services.cjs");

function localWorker(response, code = 0) {
  return {
    exists: () => true,
    spawn: (_python, args, options) => {
      assert.deepEqual(args, ["-X", "utf8", "-m", "speech.desktop_worker"]);
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
        assert.ok(request.checkpoint.endsWith("checkpoint.pt"));
        assert.equal(request.key, undefined);
        child.stdout.write(response);
        child.emit("close", code);
      });
      return child;
    },
  };
}

test("local transcription runs our checkpoint without credentials", async () => {
  assert.equal(await runLocalTranscription("project", "meeting.webm", localWorker(JSON.stringify({ text: "send the report" }))), "send the report");
});

test("local transcription rejects blank, malformed and failed worker responses", async () => {
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker('{"text":""}')), /returned no words/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker("not json")), /could not return a result/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", localWorker('{"error":"Invalid audio"}', 1)), /Invalid audio/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", { exists: () => false }), /venv is missing/);
  await assert.rejects(runLocalTranscription("project", "meeting.webm", { exists: (name) => !name.endsWith("checkpoint.pt") }), /checkpoint is missing/);
});

test("Wispr Flow sends base64 WAV with bearer auth and returns text", async () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)]);
  const result = await transcribeWispr(wav, "test-only", async (url, options) => {
    assert.equal(url, "https://platform-api.wisprflow.ai/api/v1/dash/api");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.audio, wav.toString("base64"));
    assert.deepEqual(body.language, ["en"]);
    return { ok: true, json: async () => ({ text: " Hello team " }) };
  });
  assert.equal(result, "Hello team");
});

test("Wispr Flow rejects missing keys, non-WAV audio and service failures", async () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)]);
  await assert.rejects(transcribeWispr(wav, ""), /API key/);
  await assert.rejects(transcribeWispr(Buffer.from("not wav at all".repeat(5)), "k"), /WAV/);
  await assert.rejects(
    transcribeWispr(wav, "k", async () => ({ ok: false, status: 401 })),
    /HTTP 401/,
  );
  await assert.rejects(
    transcribeWispr(wav, "k", async () => {
      throw new Error("network");
    }),
    /could not be reached/,
  );
});
