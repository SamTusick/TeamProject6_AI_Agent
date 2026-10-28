const fs = require("node:fs");
const path = require("node:path");
const { dialog } = require("electron");
const { text } = require("../models/meetingStore.cjs");
const { runAnalysis } = require("../services/analysisService.cjs");

const MAX_TRANSCRIPT_FILE = 400_000;

function registerMeetingsController({
  root,
  store,
  activity,
  ipc,
  getWindow,
}) {
  const { handle, consent } = ipc;

  handle("meetings:list", () => store.list());

  handle("meetings:create", (title, transcript) =>
    store.create(title, transcript),
  );

  handle("meetings:update", (id, title, transcript) => {
    activity.ensureAvailable(id);
    return store.update(id, title, transcript);
  });

  handle("meetings:import", async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {
      properties: ["openFile"],
      filters: [{ name: "Plain text transcript", extensions: ["txt"] }],
    });
    if (picked.canceled) return null;
    const file = picked.filePaths[0];
    if (fs.statSync(file).size > MAX_TRANSCRIPT_FILE)
      throw new Error(
        "Transcript file is too large (100,000 characters maximum).",
      );
    const transcript = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    text(transcript, "Transcript");
    return store.create(
      path.basename(file, path.extname(file)).slice(0, 160),
      transcript,
    );
  });

  handle("meetings:analyze", (id) =>
    activity.exclusive(id, async () => {
      const meeting = store.read(id);
      text(meeting.transcript, "Transcript");
      const agreed = await consent(
        "Send this transcript for analysis?",
        "The transcript will be sent to the NRP/model endpoint configured in your project .env. Only proceed with participant permission. Existing review decisions will be reset.",
      );
      if (!agreed) return null;
      return store.setAnalysis(id, await runAnalysis(root, meeting.transcript));
    }),
  );

  handle("meetings:decide", (id, itemId, decision) => {
    activity.ensureAvailable(id);
    return store.decide(id, itemId, decision);
  });

  handle("meetings:export", async (id) => {
    activity.ensureAvailable(id);
    const data = store.export(id);
    const picked = await dialog.showSaveDialog(getWindow(), {
      defaultPath: "approved-action-items.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (picked.canceled) return false;
    fs.writeFileSync(picked.filePath, JSON.stringify(data, null, 2));
    return true;
  });

  handle("meetings:delete", async (id) => {
    activity.ensureAvailable(id);
    const agreed = await consent(
      "Delete this meeting?",
      "This permanently deletes its local transcript, recording, and review decisions. Exported copies are not removed.",
    );
    if (!agreed) return false;
    activity.ensureAvailable(id);
    store.delete(id);
    return true;
  });
}

module.exports = { registerMeetingsController };
