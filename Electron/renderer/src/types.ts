export type View = "messages" | "agents" | "contacts" | "settings";

export interface Thread { id: number; canonical_number: string; name?: string; last_msg_ts?: string; unread_count?: number; }
export interface Contact { id: number; name: string; number: string; }
export interface Message { id: string; direction: "inbound" | "outbound"; body: string; ts: string; status?: string; media_urls?: string; attempt_count?: number; last_error?: string; provider_sid?: string; }
export interface AgentAction { id: string; label: string; }
export interface AgentMessage { id: string; channel_id: string; source: string; kind: string; urgency: "low" | "normal" | "high" | "urgent"; title: string; body: string; actions: string; status: "unread" | "read" | "dismissed" | "acted" | "expired"; action_result: string; created_at: string; expires_at?: string | null; last_error?: string; }
export interface ConfigStatus { account_sid: boolean; auth_token: boolean; phone_number: boolean; public_base_url: boolean; }
export interface DesktopSettings { account_sid: string; auth_token_configured: boolean; twilio_number: string; public_base_url: string; webhook_host: string; webhook_port: number; }
export interface ValidationResult { account_name: string; account_status: string; phone_number: string; }
export interface BackendConnection { baseUrl: string; apiToken: string; }
export interface DataStatus { schema_version: number; latest_backup: string | null; backup_count: number; recovered_from: string | null; migration_backup: string | null; }
export interface RetentionResult { deletedMessages: number; deletedThreads: number; deletedUploads: number; deletedAgentMessages: number; }
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
      onServerStatus(callback: (status: DesktopStatus) => void): void;
    };
  }
}
