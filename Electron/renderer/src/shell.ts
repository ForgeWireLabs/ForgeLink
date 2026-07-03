import type { AgentChannelStatus, AttentionDecision, AttentionEvent, AttentionPolicy, BackendConnection, DesktopStatus, EmailSettingsInput, EmailSettingsStatus, McpStatus, PushSettingsInput, PushSettingsStatus, ValidationResult } from "./types";

export const SHELL_BRIDGE_CAPABILITIES = {
  localService: ["backendConnection", "getStatus", "startServer", "startLocalOnly", "stopServer", "onServerStatus"],
  notifications: ["notify", "notifyEvent"],
  navigation: ["openExternal"],
  secureSettings: ["validateSettings", "importEnvironment", "removeCredentials", "emailSettings", "saveEmailSettings", "removeEmailSettings", "pushSettings", "savePushSettings", "removePushSettings"],
  attentionPolicy: ["attentionPolicy", "saveAttentionPolicy"],
  agentCredentials: ["mcpStatus", "createMcpToken", "revokeMcpToken", "testMcpBridge", "agentChannels", "createAgentChannel", "rotateAgentChannel", "revokeAgentChannel", "setAgentChannelEnabled"]
} as const;

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
  emailSettings(): Promise<EmailSettingsStatus>;
  saveEmailSettings(values: EmailSettingsInput): Promise<EmailSettingsStatus>;
  removeEmailSettings(): Promise<EmailSettingsStatus>;
  pushSettings(): Promise<PushSettingsStatus>;
  savePushSettings(values: PushSettingsInput): Promise<PushSettingsStatus>;
  removePushSettings(): Promise<PushSettingsStatus>;
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
      emailSettings: unavailable("emailSettings"),
      saveEmailSettings: unavailable("saveEmailSettings"),
      removeEmailSettings: unavailable("removeEmailSettings"),
      pushSettings: unavailable("pushSettings"),
      savePushSettings: unavailable("savePushSettings"),
      removePushSettings: unavailable("removePushSettings"),
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
  emailSettings: () => getShellBridge().emailSettings(),
  saveEmailSettings: values => getShellBridge().saveEmailSettings(values),
  removeEmailSettings: () => getShellBridge().removeEmailSettings(),
  pushSettings: () => getShellBridge().pushSettings(),
  savePushSettings: values => getShellBridge().savePushSettings(values),
  removePushSettings: () => getShellBridge().removePushSettings(),
  onServerStatus: callback => getShellBridge().onServerStatus(callback)
};
