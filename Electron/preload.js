const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  openVoice: () => ipcRenderer.invoke("open-voice"),
  openExternal: (url) => ipcRenderer.invoke("open-url", url),
  setSettings: (cfg) => ipcRenderer.invoke("set-settings", cfg),
  getStatus: () => ipcRenderer.invoke("get-status"),
  startServer: (cfg) => ipcRenderer.invoke("start-server", cfg),
  stopServer: () => ipcRenderer.invoke("stop-server"),
  onServerStatus: (cb) => ipcRenderer.on("server-status", (_, status) => cb(status)),
  onOpenVoice: (cb) => ipcRenderer.on("open-voice", (_, url) => cb(url))
});
