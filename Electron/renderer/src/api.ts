import type { AgentMessage, BackendConnection, CallRow, ConfigStatus, Contact, ContactPoint, ContactPolicy, DataStatus, Message, RetentionResult, SignalItem, SignalSubscription, Thread } from "./types";

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
  signalSubscriptions = () => this.request<SignalSubscription[]>("/api/signals/subscriptions");
  createSignalSubscription = (payload: { url: string; title?: string; fetch_interval_minutes: number; retention_days: number }) => this.request<{ ok: true; subscription: SignalSubscription }>("/api/signals/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  refreshSignalSubscription = (id: string) => this.request<{ ok: true; added: number; deleted: number; subscription: SignalSubscription; items: SignalItem[] }>(`/api/signals/subscriptions/${encodeURIComponent(id)}/refresh`, { method: "POST" });
  setSignalSubscriptionState = (id: string, action: "enable" | "disable" | "mute" | "unmute") => this.request<{ ok: true; subscription: SignalSubscription }>(`/api/signals/subscriptions/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  signalItems = (limit = 50) => this.request<SignalItem[]>(`/api/signals/items?limit=${limit}`);
  archiveSignalItem = (id: string) => this.request<{ ok: true; item: SignalItem }>(`/api/signals/items/${encodeURIComponent(id)}/archive`, { method: "POST" });
  send = (localId: string, to: string, body: string, mediaUrls: string[] = []) => this.request("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_id: localId, to, body, media_urls: mediaUrls }) });
  retry = (id: string) => this.request("/api/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  calls = (limit = 100) => this.request<CallRow[]>(`/api/calls?limit=${limit}`);
  startCall = (to: string, contactId?: number) => this.request<{ ok: true; call: CallRow }>("/api/calls/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_call_id: `call-${crypto.randomUUID()}`, to, contact_id: contactId }) });
  endCall = (call: CallRow) => this.request<{ ok: true; call: CallRow | null }>("/api/calls/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ local_call_id: call.local_call_id, provider_call_id: call.provider_call_id }) });
  draft = (threadId: number) => this.request<{ body: string }>(`/api/draft?thread_id=${threadId}`);
  saveDraft = (threadId: number, body: string) => this.request("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, body }) });
  saveContact = (name: string, number: string) => this.request("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, number }) });
  createContactFromThread = (threadId: number, name: string) => this.request<{ ok: true; id: number }>("/api/contacts/from-thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, name }) });
  updateContact = (id: number, fields: Record<string, unknown>) => this.request<{ ok: true; contact: Contact }>("/api/contacts/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
  deleteContact = (id: number) => this.request<{ ok: true }>("/api/contacts/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  contactPoints = (contactId: number) => this.request<ContactPoint[]>(`/api/contacts/points?contact_id=${contactId}`);
  addContactPoint = (contactId: number, kind: string, value: string, label: string, isPrimary: boolean) => this.request<{ ok: true; id: number }>("/api/contacts/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_id: contactId, kind, value, label, is_primary: isPrimary }) });
  setContactPointBlocked = (pointId: number, blocked: boolean) => this.request<{ ok: true }>("/api/contacts/points/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ point_id: pointId, blocked }) });
  contactPolicy = (contactId: number) => this.request<ContactPolicy>(`/api/contacts/policy?contact_id=${contactId}`);
  setContactPolicy = (contactId: number, policy: Partial<ContactPolicy>) => this.request<ContactPolicy>("/api/contacts/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact_id: contactId, ...policy }) });
  linkThread = (threadId: number, contactId: number) => this.request("/api/link-thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, contact_id: contactId }) });
  ignoreUnknownNumber = (threadId: number) => this.request<{ ok: true }>("/api/unknown-number/ignore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId }) });
  blockUnknownNumber = (threadId: number) => this.request<{ ok: true; id: number }>("/api/unknown-number/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId }) });
  upload = async (file: File) => { const body = new FormData(); body.append("file", file); return this.request<{ url: string }>("/upload", { method: "POST", body }); };
  dataStatus = () => this.request<DataStatus>("/api/data/status");
  backupData = () => this.request<{ ok: true; name: string }>("/api/data/backup", { method: "POST" });
  restoreLatestBackup = () => this.request<{ ok: true; name: string }>("/api/data/restore-latest", { method: "POST" });
  exportData = () => this.request<{ ok: true; name: string }>("/api/data/export", { method: "POST" });
  applyRetention = (days: number) => this.request<RetentionResult>("/api/data/retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
}
