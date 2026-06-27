import type { AgentChannelStatus, AttentionDecision, AttentionEvent, AttentionPolicy, BackendConnection, DesktopStatus, McpStatus, ValidationResult } from "./types";

export interface ForgeLinkShellBridge {
  notify(title: string, body: string): Promise<void>;
  notifyEvent(event: AttentionEvent): Promise<AttentionDecision>;
  attentionPolicy(): Promise<AttentionPolicy>;
  saveAttentionPolicy(policy: AttentionPolicy): Promise<AttentionPolicy>;
  openExternal(url: string): Promise<void>;
  backendConnection(): Promise<BackendConnection>;
  getStatus(): Promise<DesktopStatus>;
  validateSettings(settings: Record<string, string | number>): Promise<ValidationResult>;
  startServer(settings: Record<string, string | number>): Promise<DesktopStatus>;
  startLocalOnly(settings: Record<string, string | number>): Promise<DesktopStatus>;
  importEnvironment(): Promise<DesktopStatus>;
  removeCredentials(): Promise<DesktopStatus>;
  stopServer(): Promise<DesktopStatus>;
  mcpStatus(): Promise<McpStatus>;
  createMcpToken(): Promise<McpStatus>;
  revokeMcpToken(): Promise<McpStatus>;
  testMcpBridge(): Promise<McpStatus>;
  agentChannels(): Promise<AgentChannelStatus[]>;
  createAgentChannel(payload: { channel_id: string; label: string }): Promise<AgentChannelStatus>;
  rotateAgentChannel(channelId: string): Promise<AgentChannelStatus>;
  revokeAgentChannel(channelId: string): Promise<AgentChannelStatus>;
  setAgentChannelEnabled(channelId: string, enabled: boolean): Promise<AgentChannelStatus>;
  onServerStatus(callback: (status: DesktopStatus) => void): void;
}

const unavailable = (capability: string) => () => Promise.reject(new Error(`ForgeLink shell capability unavailable: ${capability}`));

export function getShellBridge(): ForgeLinkShellBridge {
  const bridge = window.forgeLinkShell || window.desktop;
  if (!bridge) {
    return {
      notify: unavailable("notify"),
      notifyEvent: unavailable("notifyEvent"),
      attentionPolicy: unavailable("attentionPolicy"),
      saveAttentionPolicy: unavailable("saveAttentionPolicy"),
      openExternal: unavailable("openExternal"),
      backendConnection: unavailable("backendConnection"),
      getStatus: unavailable("getStatus"),
      validateSettings: unavailable("validateSettings"),
      startServer: unavailable("startServer"),
      startLocalOnly: unavailable("startLocalOnly"),
      importEnvironment: unavailable("importEnvironment"),
      removeCredentials: unavailable("removeCredentials"),
      stopServer: unavailable("stopServer"),
      mcpStatus: unavailable("mcpStatus"),
      createMcpToken: unavailable("createMcpToken"),
      revokeMcpToken: unavailable("revokeMcpToken"),
      testMcpBridge: unavailable("testMcpBridge"),
      agentChannels: unavailable("agentChannels"),
      createAgentChannel: unavailable("createAgentChannel"),
      rotateAgentChannel: unavailable("rotateAgentChannel"),
      revokeAgentChannel: unavailable("revokeAgentChannel"),
      setAgentChannelEnabled: unavailable("setAgentChannelEnabled"),
      onServerStatus: () => undefined
    };
  }
  return bridge;
}

export const shell: ForgeLinkShellBridge = {
  notify: (title, body) => getShellBridge().notify(title, body),
  notifyEvent: event => getShellBridge().notifyEvent(event),
  attentionPolicy: () => getShellBridge().attentionPolicy(),
  saveAttentionPolicy: policy => getShellBridge().saveAttentionPolicy(policy),
  openExternal: url => getShellBridge().openExternal(url),
  backendConnection: () => getShellBridge().backendConnection(),
  getStatus: () => getShellBridge().getStatus(),
  validateSettings: settings => getShellBridge().validateSettings(settings),
  startServer: settings => getShellBridge().startServer(settings),
  startLocalOnly: settings => getShellBridge().startLocalOnly(settings),
  importEnvironment: () => getShellBridge().importEnvironment(),
  removeCredentials: () => getShellBridge().removeCredentials(),
  stopServer: () => getShellBridge().stopServer(),
  mcpStatus: () => getShellBridge().mcpStatus(),
  createMcpToken: () => getShellBridge().createMcpToken(),
  revokeMcpToken: () => getShellBridge().revokeMcpToken(),
  testMcpBridge: () => getShellBridge().testMcpBridge(),
  agentChannels: () => getShellBridge().agentChannels(),
  createAgentChannel: payload => getShellBridge().createAgentChannel(payload),
  rotateAgentChannel: channelId => getShellBridge().rotateAgentChannel(channelId),
  revokeAgentChannel: channelId => getShellBridge().revokeAgentChannel(channelId),
  setAgentChannelEnabled: (channelId, enabled) => getShellBridge().setAgentChannelEnabled(channelId, enabled),
  onServerStatus: callback => getShellBridge().onServerStatus(callback)
};
