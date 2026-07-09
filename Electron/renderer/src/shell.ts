import type { AgentChannelStatus, AndroidPairingStatus, AttentionDecision, AttentionEvent, AttentionPolicy, BackendConnection, DesktopLinkedNodeStatus, DesktopStatus, EmailSettingsInput, EmailSettingsStatus, ForgeLinkNodeLinkStatus, McpStatus, PushSettingsInput, PushSettingsStatus, ValidationResult } from "./types";

export const SHELL_BRIDGE_CAPABILITIES = {
  localService: ["backendConnection", "getStatus", "startServer", "startLocalOnly", "stopServer", "onServerStatus"],
  notifications: ["notify", "notifyEvent"],
  navigation: ["openExternal"],
  secureSettings: ["validateSettings", "importEnvironment", "removeCredentials", "emailSettings", "saveEmailSettings", "removeEmailSettings", "pushSettings", "savePushSettings", "removePushSettings"],
  attentionPolicy: ["attentionPolicy", "saveAttentionPolicy"],
  agentCredentials: ["mcpStatus", "createMcpToken", "revokeMcpToken", "testMcpBridge", "agentChannels", "createAgentChannel", "rotateAgentChannel", "revokeAgentChannel", "setAgentChannelEnabled"],
  androidPairing: ["pairingStatus"],
  nodeLink: ["nodeLinkStatus", "desktopLinkedNodeStatus"]
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
  pairingStatus(): Promise<AndroidPairingStatus>;
  nodeLinkStatus(): Promise<ForgeLinkNodeLinkStatus>;
  desktopLinkedNodeStatus(): Promise<DesktopLinkedNodeStatus>;
  savePushSettings(values: PushSettingsInput): Promise<PushSettingsStatus>;
  removePushSettings(): Promise<PushSettingsStatus>;
  onServerStatus(callback: (status: DesktopStatus) => void): void;
}

const unavailable = (capability: string) => () => Promise.reject(new Error(`ForgeLink shell capability unavailable: ${capability}`));

type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

const invokeWithPayload = <T>(invoke: TauriInvoke, command: string, payload?: Record<string, unknown>) => invoke<T>(command, payload ? { payload } : undefined);

function createTauriBridge(invoke: TauriInvoke): ForgeLinkShellBridge {
  return {
    notify: (title, body) => invoke("forgelink_notify", { title, body }),
    notifyEvent: event => invokeWithPayload<AttentionDecision>(invoke, "forgelink_notify_event", event as unknown as Record<string, unknown>),
    attentionPolicy: () => invoke<AttentionPolicy>("forgelink_attention_policy"),
    saveAttentionPolicy: policy => invokeWithPayload<AttentionPolicy>(invoke, "forgelink_save_attention_policy", policy as unknown as Record<string, unknown>),
    openExternal: url => invoke("forgelink_open_external", { url }),
    backendConnection: () => invoke<BackendConnection>("forgelink_backend_connection"),
    getStatus: () => invoke<DesktopStatus>("forgelink_get_status"),
    validateSettings: settings => invokeWithPayload<ValidationResult>(invoke, "forgelink_validate_settings", settings),
    startServer: settings => invokeWithPayload<DesktopStatus>(invoke, "forgelink_start_server", settings),
    startLocalOnly: settings => invokeWithPayload<DesktopStatus>(invoke, "forgelink_start_local_only", settings),
    importEnvironment: () => invoke<DesktopStatus>("forgelink_import_environment"),
    removeCredentials: () => invoke<DesktopStatus>("forgelink_remove_credentials"),
    stopServer: () => invoke<DesktopStatus>("forgelink_stop_server"),
    mcpStatus: () => invoke<McpStatus>("forgelink_mcp_status"),
    createMcpToken: () => invoke<McpStatus>("forgelink_create_mcp_token"),
    revokeMcpToken: () => invoke<McpStatus>("forgelink_revoke_mcp_token"),
    testMcpBridge: () => invoke<McpStatus>("forgelink_test_mcp_bridge"),
    agentChannels: () => invoke<AgentChannelStatus[]>("forgelink_agent_channels"),
    createAgentChannel: payload => invokeWithPayload<AgentChannelStatus>(invoke, "forgelink_create_agent_channel", payload),
    rotateAgentChannel: channelId => invoke<AgentChannelStatus>("forgelink_rotate_agent_channel", { channelId }),
    revokeAgentChannel: channelId => invoke<AgentChannelStatus>("forgelink_revoke_agent_channel", { channelId }),
    setAgentChannelEnabled: (channelId, enabled) => invoke<AgentChannelStatus>("forgelink_set_agent_channel_enabled", { channelId, enabled }),
    emailSettings: () => invoke<EmailSettingsStatus>("forgelink_email_settings"),
    saveEmailSettings: values => invokeWithPayload<EmailSettingsStatus>(invoke, "forgelink_save_email_settings", values as unknown as Record<string, unknown>),
    removeEmailSettings: () => invoke<EmailSettingsStatus>("forgelink_remove_email_settings"),
    pushSettings: () => invoke<PushSettingsStatus>("forgelink_push_settings"),
    pairingStatus: () => invoke<AndroidPairingStatus>("forgelink_pairing_status"),
    nodeLinkStatus: () => invoke<ForgeLinkNodeLinkStatus>("forgelink_node_link_status"),
    desktopLinkedNodeStatus: () => invoke<DesktopLinkedNodeStatus>("forgelink_desktop_linked_node_status"),
    savePushSettings: values => invokeWithPayload<PushSettingsStatus>(invoke, "forgelink_save_push_settings", values as unknown as Record<string, unknown>),
    removePushSettings: () => invoke<PushSettingsStatus>("forgelink_remove_push_settings"),
    onServerStatus: () => undefined
  };
}

export function getShellBridge(): ForgeLinkShellBridge {
  const tauriInvoke = window.__TAURI__?.core?.invoke;
  if (tauriInvoke) return createTauriBridge(tauriInvoke);
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
      pairingStatus: unavailable("pairingStatus"),
      nodeLinkStatus: unavailable("nodeLinkStatus"),
      desktopLinkedNodeStatus: unavailable("desktopLinkedNodeStatus"),
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
  pairingStatus: () => getShellBridge().pairingStatus(),
  nodeLinkStatus: () => getShellBridge().nodeLinkStatus(),
  desktopLinkedNodeStatus: () => getShellBridge().desktopLinkedNodeStatus(),
  savePushSettings: values => getShellBridge().savePushSettings(values),
  removePushSettings: () => getShellBridge().removePushSettings(),
  onServerStatus: callback => getShellBridge().onServerStatus(callback)
};
