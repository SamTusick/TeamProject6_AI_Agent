const { ipcMain, dialog } = require("electron");

const APP_URL = "team6://app/index.html";

function createIpc(getWindow) {
  const trusted = (frame) =>
    Boolean(frame) &&
    frame === getWindow()?.webContents.mainFrame &&
    frame.url === APP_URL;

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

  async function consent(message, detail) {
    const result = await dialog.showMessageBox(getWindow(), {
      type: "question",
      message,
      detail,
      buttons: ["Cancel", "Continue"],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1;
  }

  return { trusted, handle, consent };
}

module.exports = { APP_URL, createIpc };
