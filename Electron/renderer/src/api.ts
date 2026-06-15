import type { AgentMessage, BackendConnection, ConfigStatus, Contact, DataStatus, Message, RetentionResult, Thread } from "./types";

export class PhoneApi {
  constructor(private connection: () => BackendConnection) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const connection = this.connection();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${connection.apiToken}`);
    const response = await fetch(`${connection.baseUrl}${path}`, { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload as T;
  }

  threads = () => this.request<Thread[]>("/api/threads");
  contacts = (query = "") => this.request<Contact[]>(`/api/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  messages = (threadId: number, before?: string) => this.request<Message[]>(`/api/messages?thread_id=${threadId}${before ? `&before=${encodeURIComponent(before)}` : ""}`);
  config = () => this.request<ConfigStatus>("/api/config-status");
  agentMessages = () => this.request<AgentMessage[]>("/api/agent-messages");
  markAgentMessageRead = (id: string) => this.request<{ ok: true; message: AgentMessage }>(`/api/agent-messages/${encodeURIComponent(id)}/read`, { method: "POST" });
  dismissAgentMessage = (id: string) => this.request<{ ok: true; message: AgentMessage }>(`/api/agent-messages/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
  actOnAgentMessage = (id: string, actionId: string) => this.request<{ ok: true; message: AgentMessage }>(`/api/agent-messages/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}`, { method: "POST" });
  send = (localId: string, to: string, body: string, mediaUrls: string[] = []) => this.request("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_id: localId, to, body, media_urls: mediaUrls }) });
  retry = (id: string) => this.request("/api/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  draft = (threadId: number) => this.request<{ body: string }>(`/api/draft?thread_id=${threadId}`);
  saveDraft = (threadId: number, body: string) => this.request("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, body }) });
  saveContact = (name: string, number: string) => this.request("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, number }) });
  linkThread = (threadId: number, contactId: number) => this.request("/api/link-thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, contact_id: contactId }) });
  upload = async (file: File) => { const body = new FormData(); body.append("file", file); return this.request<{ url: string }>("/upload", { method: "POST", body }); };
  dataStatus = () => this.request<DataStatus>("/api/data/status");
  backupData = () => this.request<{ ok: true; name: string }>("/api/data/backup", { method: "POST" });
  restoreLatestBackup = () => this.request<{ ok: true; name: string }>("/api/data/restore-latest", { method: "POST" });
  exportData = () => this.request<{ ok: true; name: string }>("/api/data/export", { method: "POST" });
  applyRetention = (days: number) => this.request<RetentionResult>("/api/data/retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
}
