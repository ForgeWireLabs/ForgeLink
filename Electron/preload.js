const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  notifyEvent: (event) => ipcRenderer.invoke("notify", event),
  attentionPolicy: () => ipcRenderer.invoke("attention-policy"),
  saveAttentionPolicy: (policy) => ipcRenderer.invoke("attention-policy-save", policy),
  openExternal: (url) => ipcRenderer.invoke("open-url", url),
  backendConnection: () => ipcRenderer.invoke("backend-connection"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  validateSettings: (settings) => ipcRenderer.invoke("validate-settings", settings),
  startServer: (settings) => ipcRenderer.invoke("start-server", settings),
  startLocalOnly: (settings) => ipcRenderer.invoke("start-local-only", settings),
  importEnvironment: () => ipcRenderer.invoke("import-environment"),
  removeCredentials: () => ipcRenderer.invoke("remove-credentials"),
  stopServer: () => ipcRenderer.invoke("stop-server"),
  mcpStatus: () => ipcRenderer.invoke("mcp-status"),
  createMcpToken: () => ipcRenderer.invoke("mcp-create-token"),
  revokeMcpToken: () => ipcRenderer.invoke("mcp-revoke-token"),
  testMcpBridge: () => ipcRenderer.invoke("mcp-test-message"),
  agentChannels: () => ipcRenderer.invoke("agent-channels"),
  createAgentChannel: (payload) => ipcRenderer.invoke("agent-channel-create", payload),
  rotateAgentChannel: (channelId) => ipcRenderer.invoke("agent-channel-rotate", channelId),
  revokeAgentChannel: (channelId) => ipcRenderer.invoke("agent-channel-revoke", channelId),
  setAgentChannelEnabled: (channelId, enabled) => ipcRenderer.invoke("agent-channel-enabled", channelId, enabled),
  onServerStatus: (callback) => ipcRenderer.on("server-status", (_, status) => callback(status))
});
