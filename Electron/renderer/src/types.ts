export type View = "messages" | "agents" | "signals" | "contacts" | "settings";

export interface Thread { id: number; canonical_number: string; name?: string; last_msg_ts?: string; unread_count?: number; }
export interface Contact { id: number; name: string; number: string; }
export interface Message { id: string; direction: "inbound" | "outbound"; body: string; ts: string; status?: string; media_urls?: string; attempt_count?: number; last_error?: string; provider_sid?: string; }
export interface AgentAction { id: string; label: string; }
export interface AgentMessage { id: string; channel_id: string; source: string; kind: string; urgency: "low" | "normal" | "high" | "urgent"; title: string; body: string; actions: string; status: "unread" | "read" | "dismissed" | "acted" | "expired"; action_result: string; created_at: string; expires_at?: string | null; last_error?: string; }
export interface SignalSubscription { id: string; title: string; url: string; enabled: boolean; muted: boolean; fetch_interval_minutes: number; retention_days: number; last_fetch_at: string | null; last_fetch_status: string; last_error: string; created_at: string; updated_at: string; }
export interface SignalItem { id: string; subscription_id: string; source_title: string; title: string; url: string; summary: string; author: string; published_at: string | null; received_at: string; status: "unread" | "read" | "archived"; muted: boolean; }
export interface ConfigStatus { account_sid: boolean; auth_token: boolean; phone_number: boolean; public_base_url: boolean; }
export interface DesktopSettings { account_sid: string; auth_token_configured: boolean; twilio_number: string; public_base_url: string; webhook_host: string; webhook_port: number; }
export interface ValidationResult { account_name: string; account_status: string; phone_number: string; }
export interface BackendConnection { baseUrl: string; apiToken: string; }
export interface DataStatus { schema_version: number; latest_backup: string | null; backup_count: number; recovered_from: string | null; migration_backup: string | null; }
export interface RetentionResult { deletedMessages: number; deletedThreads: number; deletedUploads: number; deletedAgentMessages: number; deletedSignalItems: number; }
export interface McpStatus { configured: boolean; created_at: string | null; rotated_at: string | null; revoked_at: string | null; last_used_at: string | null; last_test_at: string | null; last_test_status: string | null; token_file: string; token_file_present: boolean; bridge_server: string; bridge_built: boolean; base_url: string; install_commands: Record<string, string>; }
export interface AgentChannelStatus { channel_id: string; label: string; enabled: boolean; configured: boolean; created_at: string; rotated_at: string; revoked_at: string | null; last_used_at: string | null; last_rejected_at: string | null; rejection_count: number; rate_limited_count: number; token_file?: string; token_file_present?: boolean; }
export interface DesktopStatus { running: boolean; baseUrl: string; configured?: boolean; credential_source?: "none" | "environment" | "stored"; environment_import_available?: boolean; needs_onboarding?: boolean; settings?: DesktopSettings; validation?: ValidationResult; }

declare global {
  interface Window {
    desktop?: {
      notify(title: string, body: string): Promise<void>;
      openExternal(url: string): Promise<void>;
      backendConnection(): Promise<BackendConnection>;
      getStatus(): Promise<DesktopStatus>;
      validateSettings(settings: Record<string, string | number>): Promise<ValidationResult>;
      startServer(settings: Record<string, string | number>): Promise<DesktopStatus>;
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
    };
  }
}
