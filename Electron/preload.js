const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  openExternal: (url) => ipcRenderer.invoke("open-url", url),
  backendUrl: () => ipcRenderer.invoke("backend-url"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  startServer: (settings) => ipcRenderer.invoke("start-server", settings),
  stopServer: () => ipcRenderer.invoke("stop-server"),
  onServerStatus: (callback) => ipcRenderer.on("server-status", (_, status) => callback(status))
});
