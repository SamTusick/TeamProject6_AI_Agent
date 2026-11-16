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
  sendToJira: (id) => invoke("meetings:jira", id),
  jiraStatus: () => invoke("jira:status"),
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
  // Main asks the UI to confirm sensitive actions; the UI replies with answerConsent.
  onConsent: (callback) => subscribe("consent:request", callback),
  answerConsent: (id, approved) => invoke("consent:answer", id, approved),
  onNotice: (callback) => subscribe("app:notice", callback),
});

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
