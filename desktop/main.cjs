const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  session,
  desktopCapturer,
  safeStorage,
  powerSaveBlocker,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { MeetingStore, atomicJson, text, MAX_AUDIO } = require("./store.cjs");
const {
  runAnalysis,
  runLocalTranscription,
  transcribeWispr,
  runJira,
} = require("./services.cjs");

const root = path.resolve(__dirname, "..");
app.setName("Team6 Meetings");
if (process.env.TEAM6_TEST_DATA)
  app.setPath("userData", process.env.TEAM6_TEST_DATA);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "team6",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let window;
let store;
let recording = null;
const busy = new Set();

function trusted(frame) {
  return (
    frame &&
    frame === window?.webContents.mainFrame &&
    frame.url === "team6://app/index.html"
  );
}

function available(id) {
  if (busy.has(id) || recording?.id === id)
    throw new Error(
      "This meeting is busy. Finish the current operation first.",
    );
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event.senderFrame))
      return { ok: false, error: "Untrusted request." };
    try {
      return { ok: true, value: await action(...args) };
    } catch (error) {
      return { ok: false, error: error.message || "Operation failed." };
    }
  });
}

function settingsFile() {
  return path.join(app.getPath("userData"), "speech-settings.json");
}
function readSettings() {
  if (!fs.existsSync(settingsFile())) return {};
  return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
}
function publicSettings() {
  return {
    hasWisprKey: Boolean(readSettings().wisprEncryptedKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    platform: process.platform,
  };
}

// Confirmations are shown by the app's own UI (styled dialog) rather than a
// native Windows message box. Main still blocks on the answer before acting.
let consentSeq = 0;
const pendingConsent = new Map();

function consent(message, detail, { confirm = "Continue", danger = false } = {}) {
  return new Promise((resolve) => {
    const id = ++consentSeq;
    pendingConsent.set(id, resolve);
    window.webContents.send("consent:request", {
      id,
      message,
      detail,
      confirm,
      danger,
    });
  });
}

function settleConsent(id, approved) {
  const resolve = pendingConsent.get(id);
  if (!resolve) return false;
  pendingConsent.delete(id);
  resolve(approved === true);
  return true;
}

// A reload or crash drops the UI that would answer; treat open requests as cancelled.
function cancelAllConsent() {
  for (const id of [...pendingConsent.keys()]) settleConsent(id, false);
}

function registerHandlers() {
  handle("consent:answer", (id, approved) => {
    if (!settleConsent(id, approved))
      throw new Error("That confirmation is no longer pending.");
    return true;
  });
  handle("meetings:list", () => store.list());
  handle("meetings:create", (title, transcript) =>
    store.create(title, transcript),
  );
  handle("meetings:update", (id, title, transcript) => {
    available(id);
    return store.update(id, title, transcript);
  });
  handle("meetings:import", async () => {
    const picked = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "Plain text transcript", extensions: ["txt"] }],
    });
    if (picked.canceled) return null;
    const file = picked.filePaths[0];
    if (fs.statSync(file).size > 400_000)
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
  handle("meetings:analyze", async (id) => {
    available(id);
    busy.add(id);
    try {
      const meeting = store.read(id);
      text(meeting.transcript, "Transcript");
      if (
        !(await consent(
          "Send this transcript for analysis?",
          "The transcript will be sent to the NRP/model endpoint configured in your project .env. Only proceed with participant permission. Existing review decisions will be reset.",
          { confirm: "Analyze" },
        ))
      )
        return null;
      return store.setAnalysis(id, await runAnalysis(root, meeting.transcript));
    } finally {
      busy.delete(id);
    }
  });
  handle("meetings:decide", (id, itemId, decision) => {
    available(id);
    return store.decide(id, itemId, decision);
  });
  handle("meetings:export", async (id) => {
    available(id);
    const data = store.export(id);
    const picked = await dialog.showSaveDialog(window, {
      defaultPath: "approved-action-items.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (picked.canceled) return false;
    fs.writeFileSync(picked.filePath, JSON.stringify(data, null, 2));
    return true;
  });
  handle("jira:status", () => runJira(root, { action: "status" }));
  handle("meetings:jira", async (id) => {
    available(id);
    const meeting = store.read(id);
    const items = store.jiraPending(id);
    if (!items.length)
      throw new Error("Every approved item is already in Jira.");
    const status = await runJira(root, { action: "status" });
    if (!status.configured)
      throw new Error(
        status.missing.length
          ? `Jira is not set up. Add ${status.missing.join(", ")} to the project .env, then restart the app.`
          : "The Jira MCP server (mcp-atlassian) is not installed. See Connections for setup.",
      );
    if (
      !(await consent(
        `Create ${items.length} Jira issue${items.length === 1 ? "" : "s"}?`,
        `Approved items (title, owner, deadline, source quote and reasoning) will be created in project ${status.project} on ${status.site} and assigned to their owners. Owners that don't match a Jira user are left unassigned.`,
        { confirm: `Create issue${items.length === 1 ? "" : "s"}` },
      ))
    )
      return null;
    busy.add(id);
    try {
      const { results } = await runJira(root, {
        action: "create",
        meeting: meeting.title,
        items,
      });
      return store.setJiraResults(id, results);
    } finally {
      busy.delete(id);
    }
  });
  handle("meetings:delete", async (id) => {
    available(id);
    if (
      !(await consent(
        "Delete this meeting?",
        "This permanently deletes its local transcript, recording, and review decisions. Exported copies are not removed.",
        { confirm: "Delete meeting", danger: true },
      ))
    )
      return false;
    available(id);
    store.delete(id);
    return true;
  });
  handle("settings:get", publicSettings);
  handle("settings:saveWispr", (input) => {
    let wisprEncryptedKey = readSettings().wisprEncryptedKey;
    if (input.clearKey) wisprEncryptedKey = undefined;
    if (input.key) {
      text(input.key, "Wispr Flow API key", 4096);
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "OS credential encryption is unavailable. No key was saved.",
        );
      wisprEncryptedKey = safeStorage
        .encryptString(input.key)
        .toString("base64");
    }
    atomicJson(settingsFile(), { wisprEncryptedKey });
    return publicSettings();
  });
  handle("recording:begin", async (title) => {
    if (recording) throw new Error("A recording is already running.");
    if (process.platform !== "win32")
      throw new Error(
        "System-audio recording is currently supported on Windows only.",
      );
    text(title, "Meeting title", 160);
    if (
      !(await consent(
        "Start recording microphone and system audio?",
        "Inform everyone and obtain permission before recording. System audio includes other apps and notifications, not only your call. Audio stays local until you choose Transcribe. No video will be saved.",
        { confirm: "Start recording" },
      ))
    )
      return null;
    if (recording) throw new Error("A recording is already running.");
    const meeting = store.create(title, "", "Recording");
    fs.writeFileSync(store.audioFile(meeting.id), Buffer.alloc(0));
    recording = {
      id: meeting.id,
      size: 0,
      blocker: powerSaveBlocker.start("prevent-app-suspension"),
    };
    window.setTitle("Recording - Team6 Meetings");
    return meeting;
  });
  handle("recording:append", (id, chunk) => {
    if (!recording || recording.id !== id)
      throw new Error("No active recording.");
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > 2_000_000)
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
    if (!recording || recording.id !== id)
      throw new Error("No active recording.");
    powerSaveBlocker.stop(recording.blocker);
    recording = null;
    window.setTitle("Team6 Meetings");
    const meeting = store.read(id);
    meeting.audio = fs.statSync(store.audioFile(id)).size > 0;
    return store.save(meeting);
  });
  handle("recording:audio", (id) => {
    available(id);
    const meeting = store.read(id);
    if (!meeting.audio) return null;
    return new Uint8Array(fs.readFileSync(store.audioFile(id)));
  });
  handle("recording:transcribe", async (id) => {
    available(id);
    busy.add(id);
    try {
      const meeting = store.read(id);
      if (!meeting.audio) throw new Error("This meeting has no recording.");
      if (
        !(await consent(
          "Transcribe locally with Whisper?",
          "Audio stays on this device and is transcribed by the open-source Whisper base model. No speech API key is needed; the first run downloads the model (about 150 MB) and can take a few minutes. Accuracy is moderate, so review the text. A nonempty result replaces the current transcript and resets review decisions; a failure leaves both unchanged.",
          { confirm: "Transcribe" },
        ))
      )
        return null;
      const transcript = await runLocalTranscription(root, store.audioFile(id));
      return store.update(id, meeting.title, transcript);
    } finally {
      busy.delete(id);
    }
  });
  handle("recording:transcribeWispr", async (id, chunks) => {
    available(id);
    busy.add(id);
    try {
      const meeting = store.read(id);
      if (!meeting.audio) throw new Error("This meeting has no recording.");
      const saved = readSettings();
      if (!saved.wisprEncryptedKey)
        throw new Error("Add a Wispr Flow API key in Connections first.");
      if (
        !Array.isArray(chunks) ||
        !chunks.length ||
        chunks.length > 8 ||
        !chunks.every((chunk) => chunk instanceof Uint8Array)
      )
        throw new Error("Invalid audio for Wispr Flow.");
      if (
        !(await consent(
          "Send this recording to Wispr Flow?",
          "Audio is uploaded to Wispr Flow's servers for transcription; their fees and retention policies apply. Only proceed with participant permission. Wispr Flow cleans up speech (removes filler words, resolves self-corrections), so the text is not word-for-word. A nonempty result replaces the current transcript and resets review decisions; a failure leaves both unchanged.",
          { confirm: "Send to Wispr Flow" },
        ))
      )
        return null;
      const key = safeStorage.decryptString(
        Buffer.from(saved.wisprEncryptedKey, "base64"),
      );
      const parts = [];
      for (const chunk of chunks)
        parts.push(await transcribeWispr(Buffer.from(chunk), key));
      const transcript = parts.filter(Boolean).join("\n\n");
      if (!transcript)
        throw new Error(
          "Wispr Flow returned no words. Your recording and transcript are unchanged.",
        );
      return store.update(id, meeting.title, transcript);
    } finally {
      busy.delete(id);
    }
  });
}

app.whenReady().then(async () => {
  store = new MeetingStore(path.join(app.getPath("userData"), "meetings"));
  protocol.handle("team6", (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\//, "");
    const base = path.join(root, "desktop-dist");
    const target = path.resolve(base, relative);
    if (url.hostname !== "app" || !target.startsWith(base + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#ffffff",
    title: "Minutely",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  window.removeMenu();
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancelAllConsent();
  });
  window.webContents.on("render-process-gone", cancelAllConsent);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (recording || busy.size) {
      event.preventDefault();
      window.webContents.send(
        "app:notice",
        "Finish recording or wait for processing before closing.",
      );
    }
  });
  const permissions = session.defaultSession;
  permissions.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      contents === window.webContents &&
      Boolean(recording) &&
      ["team6://app", "team6://app/"].includes(origin) &&
      details.isMainFrame !== false &&
      ["media", "display-capture"].includes(permission) &&
      details.mediaType !== "video",
  );
  permissions.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        contents === window.webContents &&
          Boolean(recording) &&
          details.requestingUrl === "team6://app/index.html" &&
          ["media", "display-capture"].includes(permission) &&
          !details.mediaTypes?.includes("video"),
      );
    },
  );
  permissions.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!trusted(request.frame) || !recording || process.platform !== "win32")
      return callback({});
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length) return callback({});
      callback({ video: sources[0], audio: "loopback" });
    } catch {
      callback({});
    }
  });
  registerHandlers();
  await window.loadURL("team6://app/index.html");
});
app.on("window-all-closed", () => app.quit());
