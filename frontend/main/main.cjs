const {
  app,
  BrowserWindow,
  dialog,
  protocol,
  net,
  session,
  desktopCapturer,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { APP_URL, createIpc } = require("./ipc.cjs");
const { createActivity } = require("./activity.cjs");
const { MeetingStore } = require("./models/meetingStore.cjs");
const { registerMeetingsController } = require("./controllers/meetingsController.cjs");
const { registerRecordingController } = require("./controllers/recordingController.cjs");

const root = path.resolve(__dirname, "..", "..");
const distRoot = path.join(root, "frontend", "dist");
const APP_ORIGINS = ["team6://app", "team6://app/"];
const isCaptureRequest = (permission) =>
  ["media", "display-capture"].includes(permission);

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
const activity = createActivity();
const ipc = createIpc(() => window);

function serveRenderer() {
  protocol.handle("team6", (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\//, "");
    const target = path.resolve(distRoot, relative);
    if (url.hostname !== "app" || !target.startsWith(distRoot + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#f3f4f6",
    title: "Team6 Meetings",
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (activity.isWorking()) {
      event.preventDefault();
      dialog.showMessageBoxSync(window, {
        message: "Finish recording or wait for processing before closing.",
        buttons: ["OK"],
      });
    }
  });
}

function restrictCapturePermissions() {
  const permissions = session.defaultSession;
  permissions.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      contents === window.webContents &&
      Boolean(activity.getRecording()) &&
      APP_ORIGINS.includes(origin) &&
      details.isMainFrame !== false &&
      isCaptureRequest(permission) &&
      details.mediaType !== "video",
  );
  permissions.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        contents === window.webContents &&
          Boolean(activity.getRecording()) &&
          details.requestingUrl === APP_URL &&
          isCaptureRequest(permission) &&
          !details.mediaTypes?.includes("video"),
      );
    },
  );
  permissions.setDisplayMediaRequestHandler(async (request, callback) => {
    if (
      !ipc.trusted(request.frame) ||
      !activity.getRecording() ||
      process.platform !== "win32"
    )
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
}

app.whenReady().then(async () => {
  const store = new MeetingStore(
    path.join(app.getPath("userData"), "meetings"),
  );
  serveRenderer();
  createWindow();
  restrictCapturePermissions();
  const context = { root, store, activity, ipc, getWindow: () => window };
  registerMeetingsController(context);
  registerRecordingController(context);
  await window.loadURL(APP_URL);
});
app.on("window-all-closed", () => app.quit());
