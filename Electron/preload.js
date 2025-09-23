const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  openVoice: () => ipcRenderer.invoke("open-voice"),
  openExternal: (url) => ipcRenderer.invoke("open-url", url),
  setSettings: (cfg) => ipcRenderer.invoke("set-settings", cfg),
  onOpenVoice: (cb) => ipcRenderer.on("open-voice", (_, url) => cb(url))
});
