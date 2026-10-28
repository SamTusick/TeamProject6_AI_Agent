const { contextBridge, ipcRenderer } = require("electron");

const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld("meetings", {
  list: () => invoke("meetings:list"),
  create: (title, transcript) => invoke("meetings:create", title, transcript),
  importTranscript: () => invoke("meetings:import"),
  update: (id, title, transcript) =>
    invoke("meetings:update", id, title, transcript),
  analyze: (id) => invoke("meetings:analyze", id),
  decide: (id, itemId, decision) =>
    invoke("meetings:decide", id, itemId, decision),
  export: (id) => invoke("meetings:export", id),
  delete: (id) => invoke("meetings:delete", id),
  settings: () => invoke("settings:get"),
  saveWisprSettings: (settings) => invoke("settings:saveWispr", settings),
  beginRecording: (title) => invoke("recording:begin", title),
  appendRecording: (id, chunk) => invoke("recording:append", id, chunk),
  finishRecording: (id) => invoke("recording:finish", id),
  audio: (id) => invoke("recording:audio", id),
  transcribe: (id) => invoke("recording:transcribe", id),
  transcribeWispr: (id, chunks) =>
    invoke("recording:transcribeWispr", id, chunks),
});
