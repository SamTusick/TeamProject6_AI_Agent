const fs = require("node:fs");
const { powerSaveBlocker } = require("electron");
const { text, MAX_AUDIO } = require("../models/meetingStore.cjs");
const { runLocalTranscription } = require("../services/transcriptionService.cjs");

const MAX_CHUNK = 2_000_000;
const APP_TITLE = "Team6 Meetings";

function registerRecordingController({ root, store, activity, ipc, getWindow }) {
  const { handle, consent } = ipc;

  function activeRecording(id) {
    const recording = activity.getRecording();
    if (!recording || recording.id !== id)
      throw new Error("No active recording.");
    return recording;
  }

  handle("recording:begin", async (title) => {
    if (activity.getRecording()) throw new Error("A recording is already running.");
    if (process.platform !== "win32")
      throw new Error(
        "System-audio recording is currently supported on Windows only.",
      );
    text(title, "Meeting title", 160);
    const agreed = await consent(
      "Start recording microphone and system audio?",
      "Inform everyone and obtain permission before recording. System audio includes other apps and notifications, not only your call. Audio stays local until you choose Transcribe. No video will be saved.",
    );
    if (!agreed) return null;
    if (activity.getRecording()) throw new Error("A recording is already running.");
    const meeting = store.create(title, "", "Recording");
    fs.writeFileSync(store.audioFile(meeting.id), Buffer.alloc(0));
    activity.setRecording({
      id: meeting.id,
      size: 0,
      blocker: powerSaveBlocker.start("prevent-app-suspension"),
    });
    getWindow().setTitle(`Recording - ${APP_TITLE}`);
    return meeting;
  });

  handle("recording:append", (id, chunk) => {
    const recording = activeRecording(id);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > MAX_CHUNK)
      throw new Error("Invalid audio chunk.");
    if (recording.size + chunk.byteLength > MAX_AUDIO)
      throw new Error(
        "Recording reached the 24 MB limit. Stop and start a new meeting.",
      );
    fs.appendFileSync(store.audioFile(id), Buffer.from(chunk));
    recording.size += chunk.byteLength;
    return recording.size;
  });

  handle("recording:finish", (id) => {
    powerSaveBlocker.stop(activeRecording(id).blocker);
    activity.setRecording(null);
    getWindow().setTitle(APP_TITLE);
    const meeting = store.read(id);
    meeting.audio = fs.statSync(store.audioFile(id)).size > 0;
    return store.save(meeting);
  });

  handle("recording:audio", (id) => {
    activity.ensureAvailable(id);
    const meeting = store.read(id);
    if (!meeting.audio) return null;
    return new Uint8Array(fs.readFileSync(store.audioFile(id)));
  });

  handle("recording:transcribe", (id) =>
    activity.exclusive(id, async () => {
      const meeting = store.read(id);
      if (!meeting.audio) throw new Error("This meeting has no recording.");
      const agreed = await consent(
        "Transcribe locally with Whisper?",
        "Audio stays on this device and is transcribed by the open-source Whisper base model. No speech API key is needed; the first run downloads the model (about 150 MB) and can take a few minutes. Accuracy is moderate, so review the text. A nonempty result replaces the current transcript and resets review decisions; a failure leaves both unchanged.",
      );
      if (!agreed) return null;
      const transcript = await runLocalTranscription(root, store.audioFile(id));
      return store.update(id, meeting.title, transcript);
    }),
  );
}

module.exports = { registerRecordingController };
