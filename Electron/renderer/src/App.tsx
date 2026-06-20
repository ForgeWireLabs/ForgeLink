import React, { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneApi } from "./api";
import type { AgentAction, AgentChannelStatus, AgentMessage, AttentionEvent, AttentionPolicy, BackendConnection, CallRow, ConfigStatus, Contact, ContactPoint, ContactPolicy, ContactTimelineItem, DataStatus, DesktopStatus, McpStatus, Message, SignalItem, SignalSubscription, Thread, View } from "./types";

const iconPaths: Record<string, ReactNode> = {
  alert: <><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v4M12 17h.01"/></>,
  chat: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></>,
  check: <path d="m20 6-11 11-5-5"/>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  close: <path d="M18 6 6 18M6 6l12 12"/>,
  external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  inbox: <><path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
  rss: <><path d="M5 19h.01"/><path d="M5 5a14 14 0 0 1 14 14"/><path d="M5 12a7 7 0 0 1 7 7"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  nodes: <><circle cx="6" cy="7" r="3"/><circle cx="18" cy="7" r="3"/><circle cx="12" cy="18" r="3"/><path d="m8.4 9.2 2.4 5.1M15.6 9.2l-2.4 5.1M9 7h6"/></>,
  paperclip: <path d="m21 11-9 9a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8"/>,
  phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.11 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.61a2 2 0 0 1-.45 2.11L8 9.72a16 16 0 0 0 6.28 6.28l1.28-1.28a2 2 0 0 1 2.11-.45c.84.3 1.71.51 2.61.63A2 2 0 0 1 22 16.92z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4-4"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></>
};

type ModalState =
  | { kind: "message"; number?: string }
  | { kind: "contact"; number?: string; threadId?: number }
  | { kind: "contact-edit"; contact: Contact }
  | { kind: "settings" }
  | { kind: "signal" }
  | { kind: "link" }
  | null;

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

const displayName = (item?: Partial<Thread & Contact>) => item?.name || item?.canonical_number || item?.number || "Unknown";
const initials = (value: string) => value.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";
const mediaUrls = (message: Message) => (message.media_urls || "").split(",").filter(Boolean);
const isImage = (url: string) => /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url);
const activeAgentMessage = (message: AgentMessage) => !["dismissed", "acted", "expired"].includes(message.status);
const parseAgentActions = (message: AgentMessage): AgentAction[] => {
  try { return JSON.parse(message.actions || "[]") as AgentAction[]; }
  catch { return []; }
};
const notify = (event: AttentionEvent) => window.desktop?.notifyEvent ? window.desktop.notifyEvent(event) : window.desktop?.notify(event.title || "ForgeLink", event.body || "");
const DEFAULT_ATTENTION_POLICY: AttentionPolicy = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_allow_urgent: false,
  redact_notification_bodies: true,
  sms_notifications: "all",
  agent_notifications: "high_and_urgent",
  signal_notifications: "off",
  system_notifications: "all",
  muted_sources: []
};
const parseMutedSources = (value: string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
const callActive = (call: CallRow) => ["queued", "ringing", "in_progress"].includes(call.status);
const voiceReady = (config?: ConfigStatus) => Boolean(config?.account_sid && config?.auth_token && config?.phone_number && config?.public_base_url);
const callParty = (call: CallRow) => call.contact_name || (call.direction === "inbound" ? call.from_number : call.to_number) || "Unknown caller";
const callEndpoint = (call: CallRow) => call.direction === "inbound" ? `${call.from_number || "unknown"} -> ${call.to_number}` : `${call.from_number || "configured number"} -> ${call.to_number}`;
const callTimestamp = (call: CallRow) => call.started_at || call.created_at;
const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes ? `${minutes}m ${remaining.toString().padStart(2, "0")}s` : `${remaining}s`;
};

function formatListTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function messageDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function Modal({ title, eyebrow, children, submitLabel = "Save", onSubmit, onClose, hideSubmit = false }: { title: string; eyebrow: string; children: ReactNode; submitLabel?: string; onSubmit?(data: FormData): Promise<void>; onClose(): void; hideSubmit?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const firstControl = formRef.current?.querySelector<HTMLElement>("input,textarea,select") || formRef.current?.querySelector<HTMLElement>("button");
    firstControl?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit) return;
    setBusy(true); setError("");
    try { await onSubmit(new FormData(event.currentTarget)); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  return <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={formRef} className="modal-card" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
      <div className="modal-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></div>
      <div className="modal-body">{children}{error && <div className="modal-error" role="alert">{error}</div>}</div>
      {!hideSubmit && <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving..." : submitLabel}</button></div>}
    </form>
  </div>;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) { return <div className="field"><label className="field-control"><span>{label}</span>{children}</label>{hint && <small>{hint}</small>}</div>; }

function ExtLink({ href, children }: { href: string; children: ReactNode }) { return <a className="help-link" href={href} onClick={event => { event.preventDefault(); window.desktop?.openExternal(href); }}>{children}</a>; }
function Avatar({ name, size = "regular" }: { name: string; size?: string }) { return <div className={`avatar ${size}`} aria-hidden="true">{initials(name)}</div>; }

export function App() {
  const [host, setHost] = useState("http://127.0.0.1:5055");
  const [apiToken, setApiToken] = useState("");
  const [connectionReady, setConnectionReady] = useState(false);
  const connection = useCallback<() => BackendConnection>(() => ({ baseUrl: host, apiToken }), [host, apiToken]);
  const api = useMemo(() => new PhoneApi(connection), [connection]);
  const [view, setView] = useState<View>("messages");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [signalSubscriptions, setSignalSubscriptions] = useState<SignalSubscription[]>([]);
  const [signalItems, setSignalItems] = useState<SignalItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [oldestTs, setOldestTs] = useState<string>();
  const [config, setConfig] = useState<ConfigStatus>();
  const [status, setStatus] = useState<DesktopStatus>();
  const [dataStatus, setDataStatus] = useState<DataStatus>();
  const [mcpStatus, setMcpStatus] = useState<McpStatus>();
  const [agentChannels, setAgentChannels] = useState<AgentChannelStatus[]>([]);
  const [attentionPolicy, setAttentionPolicy] = useState<AttentionPolicy>();
  const [search, setSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState("");
  const [draft, setDraft] = useState("");
  const unreadRef = useRef(new Map<number, number>());
  const agentUnreadRef = useRef(new Set<string>());
  const onboardingShownRef = useRef(false);
  const selected = threads.find(thread => thread.id === selectedId);
  const closeModal = useCallback(() => setModal(null), []);
  const saveSelectedDraft = useCallback((value: string) => {
    setDraft(value);
    if (selectedId) void api.saveDraft(selectedId, value).catch(() => undefined);
  }, [api, selectedId]);

  const loadAll = useCallback(async () => {
    const [nextThreads, nextContacts, nextAgentMessages, nextCalls, nextSignalSubscriptions, nextSignalItems, nextConfig, nextDataStatus, nextMcpStatus, nextAgentChannels, nextAttentionPolicy] = await Promise.all([api.threads(), api.contacts(), api.agentMessages(), api.calls(), api.signalSubscriptions(), api.signalItems(), api.config(), api.dataStatus(), window.desktop?.mcpStatus(), window.desktop?.agentChannels(), window.desktop?.attentionPolicy()]);
    setThreads(nextThreads); setContacts(nextContacts); setAgentMessages(nextAgentMessages); setCalls(Array.isArray(nextCalls) ? nextCalls : []); setSignalSubscriptions(nextSignalSubscriptions); setSignalItems(nextSignalItems); setConfig(nextConfig); setDataStatus(nextDataStatus); if (nextMcpStatus) setMcpStatus(nextMcpStatus); if (nextAgentChannels) setAgentChannels(nextAgentChannels); if (nextAttentionPolicy) setAttentionPolicy(nextAttentionPolicy);
    unreadRef.current = new Map(nextThreads.map(thread => [thread.id, thread.unread_count || 0]));
    agentUnreadRef.current = new Set(nextAgentMessages.filter(message => message.status === "unread").map(message => message.id));
  }, [api]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [next, backendConnection] = await Promise.all([window.desktop?.getStatus(), window.desktop?.backendConnection()]);
        if (!active) return;
        if (next) {
          setStatus(next);
          if (next.needs_onboarding && !onboardingShownRef.current) {
            onboardingShownRef.current = true;
            setView("settings");
            setModal({ kind: "settings" });
          }
        }
        if (backendConnection) {
          setHost(backendConnection.baseUrl);
          setApiToken(backendConnection.apiToken);
          setConnectionReady(true);
        }
      } catch (cause) { setError(String(cause)); }
    })();
    window.desktop?.onServerStatus(next => { setStatus(next); setHost(next.baseUrl); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!connectionReady) return;
    loadAll().catch(cause => setError(`The local service is unavailable. ${cause.message}`));
    const timer = window.setInterval(async () => {
      try {
        const next = await api.threads();
        const nextAgentMessages = await api.agentMessages();
        const nextCalls = await api.calls();
        const nextSignalItems = await api.signalItems();
        next.forEach(thread => {
          if ((thread.unread_count || 0) > (unreadRef.current.get(thread.id) || 0)) void notify({ kind: "sms", title: "New message", body: displayName(thread) });
        });
        nextAgentMessages.forEach(message => {
          if (message.status === "unread" && !agentUnreadRef.current.has(message.id)) void notify({ kind: "agent", title: message.title, body: message.body, source: message.source, channel_id: message.channel_id, urgency: message.urgency });
        });
        unreadRef.current = new Map(next.map(thread => [thread.id, thread.unread_count || 0]));
        agentUnreadRef.current = new Set(nextAgentMessages.filter(message => message.status === "unread").map(message => message.id));
        setThreads(next);
        setAgentMessages(nextAgentMessages);
        setCalls(Array.isArray(nextCalls) ? nextCalls : []);
        setSignalItems(nextSignalItems);
        if (selectedId) {
          const nextMessages = await api.messages(selectedId);
          setMessages(nextMessages); setOldestTs(nextMessages[0]?.ts);
        }
      } catch { /* The visible error state is managed by foreground actions. */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [api, connectionReady, loadAll, selectedId]);

  async function chooseThread(id: number) {
    setSelectedId(id); setView("messages");
    try {
      const [nextMessages, nextDraft] = await Promise.all([api.messages(id), api.draft(id)]);
      setMessages(nextMessages); setOldestTs(nextMessages[0]?.ts); setThreads(await api.threads()); setError("");
      setDraft(nextDraft.body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function loadOlder() {
    if (!selectedId || !oldestTs) return;
    try {
      const older = await api.messages(selectedId, oldestTs);
      if (older.length) { setMessages(current => [...older, ...current]); setOldestTs(older[0].ts); }
    } catch (cause) { setError(String(cause)); }
  }

  async function send(to: string, body: string) {
    if (!to || (!body && !attachment) || sending) return;
    setSending(true);
    const localId = `local-${crypto.randomUUID()}`;
    const optimistic: Message = { id: localId, direction: "outbound", body, media_urls: attachment, status: "pending", ts: new Date().toISOString(), attempt_count: 1 };
    if (selected?.canonical_number === to) setMessages(current => [...current, optimistic]);
    try {
      await api.send(localId, to, body, attachment ? [attachment] : []);
      setAttachment("");
      setDraft("");
      const next = await api.threads(); setThreads(next);
      const digits = to.replace(/\D/g, "").slice(-10);
      const thread = next.find(item => item.canonical_number === to || item.canonical_number.replace(/\D/g, "").endsWith(digits));
      if (thread) await chooseThread(thread.id);
      void notify({ kind: "system", category: "info", title: "Message sent", body: body || "Attachment sent" });
    } catch (cause) {
      if (selectedId) setMessages(await api.messages(selectedId));
      const message = cause instanceof Error ? cause.message : String(cause); setError(message); void notify({ kind: "system", category: "failure", title: "Message failed", body: "The message was saved and can be retried." }); throw cause;
    } finally { setSending(false); }
  }

  async function upload(file: File) {
    setUploading(true);
    try { setAttachment((await api.upload(file)).url); }
    catch (cause) { const message = String(cause); setError(message); void notify({ kind: "system", category: "failure", title: "Upload failed", body: message }); }
    finally { setUploading(false); }
  }

  async function startVoiceCall(to: string, contactId?: number) {
    if (!to || calling) return;
    setCalling(true);
    try {
      const result = await api.startCall(to, contactId);
      setCalls(current => [result.call, ...current.filter(call => call.local_call_id !== result.call.local_call_id)]);
      void notify({ kind: "system", category: "info", title: "Call started", body: result.call.to_number });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      void notify({ kind: "system", category: "failure", title: "Call failed", body: message });
    } finally { setCalling(false); }
  }

  async function endVoiceCall(call: CallRow) {
    if (calling) return;
    setCalling(true);
    try {
      const result = await api.endCall(call);
      setCalls(await api.calls());
      void notify({ kind: "system", category: "info", title: "Call ended", body: result.call?.to_number || call.to_number });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCalling(false); }
  }

  const visibleThreads = threads.filter(thread => !search || displayName(thread).toLowerCase().includes(search.toLowerCase()) || thread.canonical_number.includes(search));
  const visibleContacts = contacts.filter(contact => !contactSearch || displayName(contact).toLowerCase().includes(contactSearch.toLowerCase()) || contact.number.includes(contactSearch));
  const unreadAgentCount = agentMessages.filter(message => message.status === "unread").length;
  const activeCall = calls.find(callActive);

  return <div className="app-shell">
    <Rail view={view} running={status?.running !== false} agentUnreadCount={unreadAgentCount} onView={setView}/>
    {view === "messages" && <ConversationList threads={visibleThreads} selectedId={selectedId} search={search} onSearch={setSearch} onSelect={chooseThread} onNew={() => setModal({ kind: "message" })}/>} 
    {view === "messages" ? <Chat thread={selected} messages={messages} oldestTs={oldestTs} sending={sending} uploading={uploading} attachment={attachment} draft={draft} onDraft={saveSelectedDraft} onRetry={async id => { try { await api.retry(id); if (selectedId) setMessages(await api.messages(selectedId)); } catch (cause) { if (selectedId) setMessages(await api.messages(selectedId)); setError(String(cause)); } }} onNew={() => setModal({ kind: "message" })} onLoadOlder={loadOlder} onSend={send} onUpload={upload} onRemoveAttachment={() => setAttachment("")} onAddContact={() => setModal({ kind: "contact", number: selected?.canonical_number, threadId: selected?.id })} onLink={() => setModal({ kind: "link" })} onIgnore={async () => { if (!selected) return; await api.ignoreUnknownNumber(selected.id); await loadAll(); void notify({ kind: "system", title: "Unknown number ignored", body: selected.canonical_number }); }} onBlock={async () => { if (!selected) return; await api.blockUnknownNumber(selected.id); await loadAll(); void notify({ kind: "system", title: "Unknown number blocked", body: selected.canonical_number }); }}/>
      : view === "calls" ? <CallSurface contacts={contacts} calls={calls} activeCall={activeCall} voiceAvailable={voiceReady(config)} busy={calling} configured={config} onStart={startVoiceCall} onEnd={endVoiceCall}/>
      : view === "agents" ? <AgentInbox messages={agentMessages} onRead={async id => { try { const result = await api.markAgentMessageRead(id); setAgentMessages(current => current.map(message => message.id === id ? result.message : message)); } catch (cause) { setError(String(cause)); } }} onDismiss={async id => { try { const result = await api.dismissAgentMessage(id); setAgentMessages(current => current.map(message => message.id === id ? result.message : message)); } catch (cause) { setError(String(cause)); } }} onAction={async (id, actionId) => { try { const result = await api.actOnAgentMessage(id, actionId); setAgentMessages(current => current.map(message => message.id === id ? result.message : message)); void notify({ kind: "system", title: "Agent response recorded", body: actionId }); } catch (cause) { setError(String(cause)); } }}/>
      : view === "signals" ? <Signals subscriptions={signalSubscriptions} items={signalItems} onAdd={() => setModal({ kind: "signal" })} onRefresh={async id => { try { const result = await api.refreshSignalSubscription(id); setSignalSubscriptions(current => current.map(item => item.id === id ? result.subscription : item)); setSignalItems(result.items); } catch (cause) { setError(String(cause)); } }} onState={async (id, action) => { try { const result = await api.setSignalSubscriptionState(id, action); setSignalSubscriptions(current => current.map(item => item.id === id ? result.subscription : item)); setSignalItems(await api.signalItems()); } catch (cause) { setError(String(cause)); } }} onArchive={async id => { try { await api.archiveSignalItem(id); setSignalItems(await api.signalItems()); } catch (cause) { setError(String(cause)); } }}/>
      : view === "contacts" ? <Contacts contacts={visibleContacts} search={contactSearch} onSearch={setContactSearch} onAdd={() => setModal({ kind: "contact" })} onEdit={contact => setModal({ kind: "contact-edit", contact })} onMessage={contact => { const thread = threads.find(item => item.canonical_number === contact.number); if (thread) chooseThread(thread.id); else setModal({ kind: "message", number: contact.number }); }}/>
      : <Settings config={config} status={status} dataStatus={dataStatus} mcpStatus={mcpStatus} agentChannels={agentChannels} attentionPolicy={attentionPolicy} host={host} onConfigure={() => setModal({ kind: "settings" })} onConsole={() => window.desktop?.openExternal("https://console.twilio.com/")} onImport={async () => { try { const next = await window.desktop!.importEnvironment(); setStatus(next); setHost(next.baseUrl); setConfig(await new PhoneApi(() => ({ baseUrl: next.baseUrl, apiToken })).config()); void notify({ kind: "system", title: "Environment credentials imported", body: `Using ${next.validation?.phone_number || "the selected Twilio number"}.` }); } catch (cause) { setError(String(cause)); } }} onRemove={async () => { try { const next = await window.desktop!.removeCredentials(); setStatus(next); setConfig({ account_sid: false, auth_token: false, phone_number: false, public_base_url: false }); setModal({ kind: "settings" }); } catch (cause) { setError(String(cause)); } }} onToggle={async () => { try { const next = status?.running === false ? await window.desktop!.startServer({}) : await window.desktop!.stopServer(); setStatus(next); } catch (cause) { setError(String(cause)); } }} onBackup={async () => { try { const result = await api.backupData(); setDataStatus(await api.dataStatus()); void notify({ kind: "system", title: "Backup created", body: result.name }); } catch (cause) { setError(String(cause)); } }} onExport={async () => { try { const result = await api.exportData(); void notify({ kind: "system", title: "Sensitive export created", body: result.name }); } catch (cause) { setError(String(cause)); } }} onRestore={async () => { if (!window.confirm("Restore the latest backup? Current data will be preserved in a rollback copy.")) return; try { const result = await api.restoreLatestBackup(); await loadAll(); void notify({ kind: "system", title: "Backup restored", body: result.name }); } catch (cause) { setError(String(cause)); } }} onRetention={async days => { if (!window.confirm(`Delete communication history older than ${days} days? A backup will be created first.`)) return; try { const result = await api.applyRetention(days); await loadAll(); void notify({ kind: "system", title: "Retention complete", body: `${result.deletedMessages} messages, ${result.deletedCalls} calls, and ${result.deletedUploads} uploads removed.` }); } catch (cause) { setError(String(cause)); } }} onAttentionSave={async policy => { try { const saved = await window.desktop!.saveAttentionPolicy(policy); setAttentionPolicy(saved); } catch (cause) { setError(String(cause)); } }} onMcpCreate={async () => { try { setMcpStatus(await window.desktop!.createMcpToken()); void notify({ kind: "system", title: "MCP token ready", body: "Agent apps can use the ForgeLink token file." }); } catch (cause) { setError(String(cause)); } }} onMcpRevoke={async () => { if (!window.confirm("Revoke the MCP token file? External agent apps will stop reaching ForgeLink.")) return; try { setMcpStatus(await window.desktop!.revokeMcpToken()); void notify({ kind: "system", title: "MCP token revoked", body: "External agent apps must be reconfigured before use." }); } catch (cause) { setError(String(cause)); } }} onMcpTest={async () => { try { setMcpStatus(await window.desktop!.testMcpBridge()); await loadAll(); void notify({ kind: "system", title: "MCP bridge tested", body: "A local test message was created." }); } catch (cause) { setError(String(cause)); } }} onChannelCreate={async () => { try { const channel = await window.desktop!.createAgentChannel({ channel_id: "forgewire", label: "ForgeWire Fabric" }); setAgentChannels(current => [channel, ...current.filter(item => item.channel_id !== channel.channel_id)]); void notify({ kind: "system", title: "Agent channel credential ready", body: "ForgeWire can use the channel token file." }); } catch (cause) { setError(String(cause)); } }} onChannelRotate={async id => { try { const channel = await window.desktop!.rotateAgentChannel(id); setAgentChannels(current => current.map(item => item.channel_id === id ? channel : item)); void notify({ kind: "system", title: "Agent channel rotated", body: id }); } catch (cause) { setError(String(cause)); } }} onChannelRevoke={async id => { if (!window.confirm(`Revoke channel ${id}? Agent apps using this channel token will stop creating messages.`)) return; try { const channel = await window.desktop!.revokeAgentChannel(id); setAgentChannels(current => current.map(item => item.channel_id === id ? channel : item)); void notify({ kind: "system", title: "Agent channel revoked", body: id }); } catch (cause) { setError(String(cause)); } }} onChannelEnabled={async (id, enabled) => { try { const channel = await window.desktop!.setAgentChannelEnabled(id, enabled); setAgentChannels(current => current.map(item => item.channel_id === id ? channel : item)); } catch (cause) { setError(String(cause)); } }}/>}
    {error && <div className="toast error" role="alert"><Icon name="alert" size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><Icon name="close" size={16}/></button></div>}
    {modal?.kind === "message" && <Modal title="New message" eyebrow="Compose" submitLabel="Start conversation" onClose={closeModal} onSubmit={async data => send(String(data.get("number")), String(data.get("message")))}><div className="form-stack"><Field label="Phone number"><input name="number" type="tel" defaultValue={modal.number} placeholder="+1 555 123 4567" required autoComplete="tel"/></Field><Field label="Message"><textarea name="message" rows={4} placeholder="Write a message..." required/></Field></div></Modal>}
    {modal?.kind === "contact" && <Modal title="Add contact" eyebrow="Contacts" submitLabel="Save contact" onClose={closeModal} onSubmit={async data => { if (modal.threadId) await api.createContactFromThread(modal.threadId, String(data.get("name"))); else await api.saveContact(String(data.get("name")), String(data.get("number"))); await loadAll(); void notify({ kind: "system", title: "Contact saved", body: String(data.get("name")) }); }}><div className="form-stack"><Field label="Name"><input name="name" placeholder="Contact name" required autoComplete="name"/></Field><Field label="Phone number"><input name="number" type="tel" defaultValue={modal.number} placeholder="+1 555 123 4567" required autoComplete="tel"/></Field></div></Modal>}
    {modal?.kind === "contact-edit" && <ContactEditModal api={api} contact={modal.contact} onClose={closeModal} onSaved={async name => { await loadAll(); void notify({ kind: "system", title: "Contact updated", body: name }); }} onDeleted={async () => { await loadAll(); closeModal(); void notify({ kind: "system", title: "Contact deleted", body: displayName(modal.contact) }); }}/>}
    {modal?.kind === "signal" && <Modal title="Add signal" eyebrow="RSS / Atom" submitLabel="Add feed" onClose={closeModal} onSubmit={async data => { const result = await api.createSignalSubscription({ url: String(data.get("url")), title: String(data.get("title") || ""), fetch_interval_minutes: Number(data.get("fetch_interval_minutes") || 60), retention_days: Number(data.get("retention_days") || 30) }); setSignalSubscriptions(current => [result.subscription, ...current.filter(item => item.id !== result.subscription.id)]); const refreshed = await api.refreshSignalSubscription(result.subscription.id); setSignalSubscriptions(current => current.map(item => item.id === result.subscription.id ? refreshed.subscription : item)); setSignalItems(refreshed.items); }}><div className="form-stack"><Field label="Feed URL"><input name="url" type="url" placeholder="https://example.com/feed.xml" required/></Field><Field label="Title" hint="Optional; the feed title is used after refresh."><input name="title" placeholder="Trusted source"/></Field><Field label="Fetch interval minutes"><input name="fetch_interval_minutes" type="number" min={15} max={10080} defaultValue={60} required/></Field><Field label="Retention days"><input name="retention_days" type="number" min={7} max={3650} defaultValue={30} required/></Field></div></Modal>}
    {modal?.kind === "settings" && <ConnectionModal status={status} firstRun={status?.needs_onboarding === true} onClose={closeModal} onValidate={values => window.desktop!.validateSettings(values)} onSave={async values => { const next = await window.desktop!.startServer(values); setStatus(next); setHost(next.baseUrl); setConfig(await new PhoneApi(() => ({ baseUrl: next.baseUrl, apiToken })).config()); void notify({ kind: "system", title: "Connection settings saved", body: `Validated ${next.validation?.phone_number || "the selected Twilio number"} and restarted the local service.` }); }}/>} 
    {modal?.kind === "link" && selected && <LinkModal contacts={contacts} thread={selected} onClose={closeModal} onLink={async contactId => { await api.linkThread(selected.id, contactId); await loadAll(); closeModal(); }} onAdd={() => setModal({ kind: "contact", number: selected.canonical_number, threadId: selected.id })}/>} 
  </div>;
}

function Rail({ view, running, agentUnreadCount, onView }: { view: View; running: boolean; agentUnreadCount: number; onView(view: View): void }) {
  const items: View[] = ["messages", "calls", "agents", "signals", "contacts", "settings"];
  const iconFor = (item: View) => item === "messages" ? "chat" : item === "calls" ? "phone" : item === "agents" ? "nodes" : item === "signals" ? "rss" : item === "contacts" ? "users" : "settings";
  const labelFor = (item: View) => item === "agents" ? "Agents" : item[0].toUpperCase() + item.slice(1);
  return <nav className="rail" aria-label="Primary navigation"><div className="brand-mark" title="ForgeLink">F</div><div className="rail-nav">{items.map(item => <button key={item} className={`nav-button ${view === item ? "active" : ""}`} aria-label={labelFor(item)} onClick={() => onView(item)}><span className="nav-icon-wrap"><Icon name={iconFor(item)}/>{item === "agents" && agentUnreadCount > 0 && <span className="nav-badge" aria-label={`${agentUnreadCount} unread agent messages`}>{Math.min(agentUnreadCount, 9)}{agentUnreadCount > 9 ? "+" : ""}</span>}</span><span>{labelFor(item)}</span></button>)}</div><div className="rail-footer"><span className={`status-dot ${running ? "online" : ""}`} title={running ? "Local service connected" : "Local service stopped"}/></div></nav>;
}

function ConversationList({ threads, selectedId, search, onSearch, onSelect, onNew }: { threads: Thread[]; selectedId?: number; search: string; onSearch(value: string): void; onSelect(id: number): void; onNew(): void }) {
  return <aside className="conversation-panel"><header className="panel-title"><div><span className="eyebrow">Workspace</span><h1>Messages</h1></div><button className="icon-button accent" aria-label="New message" onClick={onNew}><Icon name="plus"/></button></header><label className="search-box"><Icon name="search" size={18}/><input type="search" value={search} placeholder="Search conversations" aria-label="Search conversations" onChange={event => onSearch(event.target.value)}/></label><div className="list-heading"><span>Recent</span><span>{threads.length} conversations</span></div><div className="thread-list">{threads.length ? threads.map(thread => <button key={thread.id} className={`thread-row ${selectedId === thread.id ? "selected" : ""}`} onClick={() => onSelect(thread.id)}><Avatar name={displayName(thread)}/><span className="thread-content"><span className="thread-line"><strong>{displayName(thread)}</strong><time>{formatListTime(thread.last_msg_ts)}</time></span><span className="thread-line preview"><span>{thread.canonical_number}</span>{Boolean(thread.unread_count) && <span className="unread-badge">{Math.min(thread.unread_count || 0, 99)}{(thread.unread_count || 0) > 99 ? "+" : ""}</span>}</span></span></button>) : <div className="list-empty"><Icon name="inbox" size={28}/><strong>{search ? "No matches" : "No conversations yet"}</strong><span>{search ? "Try another name or number." : "Start a message to begin."}</span></div>}</div></aside>;
}

function Chat({ thread, messages, oldestTs, sending, uploading, attachment, draft, onDraft, onRetry, onNew, onLoadOlder, onSend, onUpload, onRemoveAttachment, onAddContact, onLink, onIgnore, onBlock }: { thread?: Thread; messages: Message[]; oldestTs?: string; sending: boolean; uploading: boolean; attachment: string; draft: string; onDraft(value: string): void; onRetry(id: string): Promise<void>; onNew(): void; onLoadOlder(): void; onSend(to: string, body: string): Promise<void>; onUpload(file: File): Promise<void>; onRemoveAttachment(): void; onAddContact(): void; onLink(): void; onIgnore(): Promise<void>; onBlock(): Promise<void> }) {
  if (!thread) return <main className="content-panel welcome-panel"><div className="welcome-art"><Icon name="chat" size={38}/></div><span className="eyebrow">ForgeLink</span><h2>Your conversations, without the clutter.</h2><p>Select a conversation from the left, or start a new message when you are ready.</p><button className="button primary" onClick={onNew}><Icon name="plus" size={17}/>New message</button></main>;
  return <main className="content-panel chat-panel"><header className="chat-header"><div className="chat-identity"><Avatar name={displayName(thread)}/><div><h2>{displayName(thread)}</h2><span>{thread.canonical_number}</span></div></div><div className="header-actions">{!thread.name && <><button className="button subtle" onClick={onAddContact}><Icon name="plus" size={16}/>Add contact</button><button className="button subtle" onClick={() => void onIgnore()}>Ignore</button><button className="button danger" onClick={() => void onBlock()}>Block</button></>}<button className="icon-button" aria-label="Link contact" onClick={onLink}><Icon name="more"/></button></div></header><div className="message-log">{oldestTs && messages.length >= 200 && <button className="load-older" onClick={onLoadOlder}>Load earlier messages</button>}{messages.length ? messages.map((message, index) => <React.Fragment key={message.id}>{(index === 0 || messageDay(messages[index - 1].ts) !== messageDay(message.ts)) && <div className="message-day"><span>{messageDay(message.ts)}</span></div>}<MessageBubble message={message} onRetry={onRetry}/></React.Fragment>) : <div className="empty-chat"><strong>This is the beginning</strong><span>Send the first message to {displayName(thread)}.</span></div>}</div><Composer to={thread.canonical_number} sending={sending} uploading={uploading} attachment={attachment} draft={draft} onDraft={onDraft} onSend={onSend} onUpload={onUpload} onRemoveAttachment={onRemoveAttachment}/></main>;
}

function AgentInbox({ messages, onRead, onDismiss, onAction }: { messages: AgentMessage[]; onRead(id: string): Promise<void>; onDismiss(id: string): Promise<void>; onAction(id: string, actionId: string): Promise<void> }) {
  const active = messages.filter(activeAgentMessage);
  const archived = messages.filter(message => !activeAgentMessage(message)).slice(0, 8);
  return <main className="content-panel page-panel agent-page"><header className="page-header"><div><span className="eyebrow">Local channels</span><h1>Agents</h1><p>Human-directed requests from ForgeWire and local agentic apps.</p></div><span className="count-label">{active.length} active</span></header><div className="agent-grid">{active.length ? active.map(message => <AgentCard key={message.id} message={message} onRead={onRead} onDismiss={onDismiss} onAction={onAction}/>) : <div className="page-empty"><Icon name="nodes" size={32}/><h3>No active agent messages</h3><p>When a local agent needs a decision, it will appear here.</p></div>}</div>{archived.length > 0 && <section className="agent-history"><h2>Recent outcomes</h2><div className="agent-history-list">{archived.map(message => <div key={message.id} className="agent-history-row"><span>{message.title}</span><strong>{message.status}</strong><time>{formatListTime(message.created_at)}</time></div>)}</div></section>}</main>;
}

function AgentCard({ message, onRead, onDismiss, onAction }: { message: AgentMessage; onRead(id: string): Promise<void>; onDismiss(id: string): Promise<void>; onAction(id: string, actionId: string): Promise<void> }) {
  const actions = parseAgentActions(message);
  return <article className={`agent-card urgency-${message.urgency}`}><div className="agent-card-head"><div><span className="agent-source">{message.source} · {message.channel_id}</span><h2>{message.title}</h2></div><span className={`urgency-pill ${message.urgency}`}>{message.urgency}</span></div><p>{message.body}</p><div className="agent-meta"><span>{message.kind}</span><time>{formatListTime(message.created_at)}</time>{message.expires_at && <span>Expires {formatListTime(message.expires_at)}</span>}</div><div className="agent-actions">{message.status === "unread" && <button className="button secondary" onClick={() => void onRead(message.id)}>Mark read</button>}{actions.map(action => <button key={action.id} className="button primary" onClick={() => void onAction(message.id, action.id)}>{action.label}</button>)}<button className="button subtle" onClick={() => void onDismiss(message.id)}>Dismiss</button></div></article>;
}

function Signals({ subscriptions, items, onAdd, onRefresh, onState, onArchive }: { subscriptions: SignalSubscription[]; items: SignalItem[]; onAdd(): void; onRefresh(id: string): Promise<void>; onState(id: string, action: "enable" | "disable" | "mute" | "unmute"): Promise<void>; onArchive(id: string): Promise<void> }) {
  return <main className="content-panel page-panel signals-page"><header className="page-header"><div><span className="eyebrow">Trusted signals</span><h1>Signals</h1><p>RSS and Atom updates you choose, separated from people and agent decisions.</p></div><button className="button primary" onClick={onAdd}><Icon name="plus" size={17}/>Add feed</button></header><section className="signal-layout"><div className="signal-source-list"><div className="section-title"><h2>Sources</h2><span>{subscriptions.length}</span></div>{subscriptions.length ? subscriptions.map(source => <article className="signal-source" key={source.id}><div><strong>{source.title}</strong><span>{source.enabled ? "enabled" : "paused"} · {source.muted ? "muted" : "quiet"} · every {source.fetch_interval_minutes}m</span><small>{source.last_fetch_status}{source.last_fetch_at ? ` · ${formatListTime(source.last_fetch_at)}` : ""}{source.last_error ? ` · ${source.last_error}` : ""}</small></div><div className="signal-actions"><button className="button secondary" disabled={!source.enabled} onClick={() => void onRefresh(source.id)}>Refresh</button><button className="button secondary" onClick={() => void onState(source.id, source.enabled ? "disable" : "enable")}>{source.enabled ? "Pause" : "Resume"}</button><button className="button subtle" onClick={() => void onState(source.id, source.muted ? "unmute" : "mute")}>{source.muted ? "Unmute" : "Mute"}</button></div></article>) : <div className="page-empty compact"><Icon name="rss" size={30}/><h3>No signal sources</h3><p>Add a feed to create a deliberate reading lane.</p></div>}</div><div className="signal-item-list"><div className="section-title"><h2>Latest</h2><span>{items.length} shown</span></div>{items.length ? items.map(item => <article className={`signal-item ${item.muted ? "muted" : ""}`} key={item.id}><div className="signal-item-head"><span>{item.source_title}</span><time>{formatListTime(item.published_at || item.received_at)}</time></div><h2>{item.title}</h2>{item.summary && <p>{item.summary}</p>}<div className="signal-item-actions"><button className="button secondary" disabled={!item.url} onClick={() => window.desktop?.openExternal(item.url)}><Icon name="external" size={16}/>Open</button><button className="button subtle" onClick={() => void onArchive(item.id)}>Archive</button>{item.author && <span>{item.author}</span>}</div></article>) : <div className="page-empty compact"><Icon name="inbox" size={30}/><h3>No signal items</h3><p>Refresh a source when you want to check it.</p></div>}</div></section></main>;
}

function CallSurface({ contacts, calls, activeCall, voiceAvailable, busy, configured, onStart, onEnd }: { contacts: Contact[]; calls: CallRow[]; activeCall?: CallRow; voiceAvailable: boolean; busy: boolean; configured?: ConfigStatus; onStart(to: string, contactId?: number): Promise<void>; onEnd(call: CallRow): Promise<void> }) {
  const [number, setNumber] = useState("");
  const [contactId, setContactId] = useState<number | undefined>();
  const selectedContact = contacts.find(contact => contact.id === contactId);
  const ready = voiceAvailable && !activeCall;
  const displayNumber = number || activeCall?.to_number || activeCall?.from_number || "";
  const append = (value: string) => setNumber(current => `${current}${value}`);
  const chooseContact = (id: string) => {
    const nextId = Number(id) || undefined;
    setContactId(nextId);
    const contact = contacts.find(item => item.id === nextId);
    if (contact) setNumber(contact.number);
  };
  const keydown = (event: React.KeyboardEvent) => {
    if (/^[0-9*#]$/.test(event.key)) { event.preventDefault(); append(event.key); }
    if (event.key === "Backspace") { event.preventDefault(); setNumber(current => current.slice(0, -1)); }
    if (event.key === "Enter" && ready && number) { event.preventDefault(); void onStart(number, contactId); }
    if (event.key === "Escape" && activeCall) { event.preventDefault(); void onEnd(activeCall); }
  };
  const missing = [
    !configured?.account_sid && "Account SID",
    !configured?.auth_token && "Auth token",
    !configured?.phone_number && "Phone number",
    !configured?.public_base_url && "Public webhook URL"
  ].filter(Boolean).join(", ");
  return <main className="content-panel page-panel call-page" onKeyDown={keydown}>
    <header className="page-header"><div><span className="eyebrow">Telecom voice edge</span><h1>Calls</h1><p>{voiceAvailable ? "Twilio Voice is configured for call control." : `Voice unavailable${missing ? `: ${missing}` : ""}.`}</p></div><span className={`config-pill ${voiceAvailable ? "ready" : "missing"}`}>{voiceAvailable ? <Icon name="check" size={14}/> : <Icon name="alert" size={14}/>} {voiceAvailable ? "Voice ready" : "Voice disabled"}</span></header>
    <section className="call-layout">
      <div className="dialer-panel">
        <div className="selected-call-card"><Avatar name={selectedContact ? displayName(selectedContact) : displayNumber || "Call"} size="large"/><div><span>{selectedContact ? displayName(selectedContact) : "Manual number"}</span><strong>{displayNumber || "No number selected"}</strong>{activeCall && <small>{activeCall.status.replace(/_/g, " ")} · {activeCall.provider_name}</small>}</div></div>
        <label className="field"><span>Selected contact</span><select aria-label="Selected contact" value={contactId || ""} onChange={event => chooseContact(event.target.value)}><option value="">Manual number</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{displayName(contact)} · {contact.number}</option>)}</select></label>
        <label className="field"><span>Dial number</span><input aria-label="Dial number" type="tel" value={number} onChange={event => setNumber(event.target.value)} placeholder="+1 555 123 4567"/></label>
        <div className="dialpad" aria-label="Dialpad">{["1","2","3","4","5","6","7","8","9","*","0","#"].map(value => <button type="button" key={value} className="dial-key" aria-label={`Dial ${value}`} onClick={() => append(value)}>{value}</button>)}</div>
        <div className="call-actions">{activeCall ? <button className="button danger call-main" disabled={busy} onClick={() => void onEnd(activeCall)}><Icon name="phone" size={18}/>End call</button> : <button className="button primary call-main" disabled={!ready || !number || busy} onClick={() => void onStart(number, contactId)}><Icon name="phone" size={18}/>Call</button>}<button className="button secondary" disabled={!number || busy} onClick={() => setNumber(current => current.slice(0, -1))}>Delete</button><button className="button subtle" disabled={!number || busy} onClick={() => { setNumber(""); setContactId(undefined); }}>Clear</button></div>
        {!voiceAvailable && <div className="modal-error" role="status">Configure Twilio credentials and a public webhook URL before placing PSTN calls.</div>}
      </div>
      <div className="call-history-panel"><div className="section-title"><h2>Call history</h2><span>{calls.length}</span></div>{calls.length ? <div className="call-history-list">{calls.map(call => <article className={`call-row ${callActive(call) ? "active" : ""}`} key={call.local_call_id}><div><strong>{callParty(call)}</strong><span>{call.direction} · {call.provider_name} · {call.status.replace(/_/g, " ")} · {formatDuration(call.duration_seconds)}</span><small>{callEndpoint(call)}{call.contact_point_label ? ` · ${call.contact_point_label}` : ""}{call.provider_call_id ? ` · ${call.provider_call_id}` : ""}</small>{call.redacted_error && <small>{call.redacted_error}</small>}</div><time>{formatListTime(callTimestamp(call))}</time>{callActive(call) && <button className="button danger" disabled={busy} onClick={() => void onEnd(call)}>End</button>}</article>)}</div> : <div className="page-empty compact"><Icon name="phone" size={30}/><h3>No call history</h3><p>Calls you place or receive will appear here.</p></div>}</div>
    </section>
  </main>;
}

function MessageBubble({ message, onRetry }: { message: Message; onRetry(id: string): Promise<void> }) {
  const failed = message.direction === "outbound" && ["failed", "undelivered"].includes(message.status || "");
  return <div className={`message-row ${message.direction}`}><div className={`bubble ${message.direction} ${failed ? "failed" : ""}`}>{message.body && <p>{message.body}</p>}{mediaUrls(message).map(url => isImage(url) ? <img key={url} className="message-media" src={url} alt="Message attachment" loading="lazy"/> : <button key={url} className="attachment-link" onClick={() => window.desktop?.openExternal(url)}><Icon name="paperclip" size={16}/>Open attachment</button>)}<div className="message-meta"><time>{new Date(message.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>{message.direction === "outbound" && message.status && <span>{message.status}{message.status === "delivered" && <Icon name="check" size={13}/>}</span>}{failed && <button className="message-retry" onClick={() => void onRetry(message.id)}>Retry</button>}</div></div></div>;
}

function Composer({ to, sending, uploading, attachment, draft, onDraft, onSend, onUpload, onRemoveAttachment }: { to: string; sending: boolean; uploading: boolean; attachment: string; draft: string; onDraft(value: string): void; onSend(to: string, body: string): Promise<void>; onUpload(file: File): Promise<void>; onRemoveAttachment(): void }) {
  const [body, setBody] = useState(draft);
  useEffect(() => { setBody(draft); }, [draft, to]);
  useEffect(() => { const timer = window.setTimeout(() => onDraft(body), 350); return () => clearTimeout(timer); }, [body, onDraft]);
  async function submit() { if (!body.trim() && !attachment) return; await onSend(to, body.trim()); setBody(""); }
  return <div className="composer-wrap">{attachment && <div className="attachment-chip"><Icon name="paperclip" size={16}/><span>Attachment ready</span><button className="chip-close" aria-label="Remove attachment" onClick={onRemoveAttachment}><Icon name="close" size={14}/></button></div>}<div className="composer"><input className="recipient-input" value={to} readOnly aria-label="Recipient phone number"/><div className="compose-main"><textarea value={body} rows={1} aria-label="Message" placeholder={`Message ${to}`} onChange={event => setBody(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }}/><label className="icon-button composer-action" aria-label="Attach file">{uploading ? <span className="spinner"/> : <Icon name="paperclip"/>}<input hidden type="file" accept="image/*,.pdf,.txt" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void onUpload(file); }}/></label><button className="send-button" aria-label="Send message" disabled={sending || (!body.trim() && !attachment)} onClick={() => void submit()}>{sending ? <span className="spinner light"/> : <Icon name="send" size={19}/>}</button></div></div><div className="composer-hint">Enter to send <span>Shift + Enter for a new line</span></div></div>;
}

function Contacts({ contacts, search, onSearch, onAdd, onEdit, onMessage }: { contacts: Contact[]; search: string; onSearch(value: string): void; onAdd(): void; onEdit(contact: Contact): void; onMessage(contact: Contact): void }) {
  return <main className="content-panel page-panel"><header className="page-header"><div><span className="eyebrow">Directory</span><h1>Contacts</h1><p>Keep names attached to the numbers you message most.</p></div><button className="button primary" onClick={onAdd}><Icon name="plus" size={17}/>Add contact</button></header><div className="page-toolbar"><label className="search-box wide"><Icon name="search" size={18}/><input type="search" value={search} aria-label="Search contacts" placeholder="Search contacts" onChange={event => onSearch(event.target.value)}/></label><span className="count-label">{contacts.length} contacts</span></div><div className="contact-grid">{contacts.length ? contacts.map(contact => <article className="contact-card" key={contact.id}><Avatar name={displayName(contact)} size="large"/><div className="contact-info"><h3>{displayName(contact)}</h3><span>{contact.number}</span>{contact.company && <small className="contact-meta">{contact.company}</small>}</div><button className="icon-button" aria-label={`Edit ${displayName(contact)}`} onClick={() => onEdit(contact)}><Icon name="settings" size={17}/></button><button className="icon-button" aria-label={`Message ${displayName(contact)}`} onClick={() => onMessage(contact)}><Icon name="chat" size={18}/></button></article>) : <div className="page-empty"><Icon name="users" size={32}/><h3>No contacts found</h3><p>Add a contact to make your conversations easier to recognize.</p></div>}</div></main>;
}

function ContactEditModal({ api, contact, onClose, onSaved, onDeleted }: { api: PhoneApi; contact: Contact; onClose(): void; onSaved(name: string): Promise<void>; onDeleted(): Promise<void> }) {
  const [points, setPoints] = useState<ContactPoint[]>([]);
  const [policy, setPolicy] = useState<ContactPolicy>();
  const [timeline, setTimeline] = useState<ContactTimelineItem[]>([]);
  const [showAgentDetails, setShowAgentDetails] = useState(false);
  const [pointError, setPointError] = useState("");
  const [pointBusy, setPointBusy] = useState(false);
  const refreshPoints = useCallback(async () => setPoints(await api.contactPoints(contact.id)), [api, contact.id]);
  const refreshPolicy = useCallback(async () => setPolicy(await api.contactPolicy(contact.id)), [api, contact.id]);
  const refreshTimeline = useCallback(async () => setTimeline(await api.contactTimeline(contact.id, showAgentDetails)), [api, contact.id, showAgentDetails]);
  useEffect(() => { refreshPoints().catch(cause => setPointError(String(cause))); }, [refreshPoints]);
  useEffect(() => { refreshPolicy().catch(cause => setPointError(String(cause))); }, [refreshPolicy]);
  useEffect(() => { refreshTimeline().catch(cause => setPointError(String(cause))); }, [refreshTimeline]);
  async function addPoint(data: FormData) {
    setPointBusy(true); setPointError("");
    try {
      await api.addContactPoint(contact.id, String(data.get("point_kind") || "phone"), String(data.get("point_value") || ""), String(data.get("point_label") || ""), data.get("point_primary") === "on");
      await refreshPoints();
    } catch (cause) { setPointError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPointBusy(false); }
  }
  return <Modal title="Edit contact" eyebrow={contact.number} submitLabel="Save changes" onClose={onClose} onSubmit={async data => {
    const trustLevel = String(data.get("trust_level"));
    await api.updateContact(contact.id, { name: String(data.get("name")), company: String(data.get("company")), role: String(data.get("role")), tags: String(data.get("tags")), notes: String(data.get("notes")), trust_level: trustLevel, pinned: data.get("pinned") === "on", favorite: data.get("favorite") === "on" });
    await api.setContactPolicy(contact.id, { trust_level: trustLevel, allow_agent_messages: data.get("allow_agent_messages") === "on" ? 1 : 0, allow_approval_requests: data.get("allow_approval_requests") === "on" ? 1 : 0, allow_urgent_interrupts: data.get("allow_urgent_interrupts") === "on" ? 1 : 0, quiet_hours_override: data.get("quiet_hours_override") === "on" ? 1 : 0, muted_until: String(data.get("muted_until") || ""), blocked: data.get("blocked") === "on" ? 1 : 0 });
    await onSaved(String(data.get("name")));
  }}><div className="form-stack"><Field label="Name"><input name="name" defaultValue={contact.name} required autoComplete="name"/></Field><Field label="Company"><input name="company" defaultValue={contact.company || ""} placeholder="Organization"/></Field><Field label="Role"><input name="role" defaultValue={contact.role || ""} placeholder="Title or relationship"/></Field><Field label="Tags" hint="Comma-separated labels."><input name="tags" defaultValue={contact.tags || ""} placeholder="vip, family"/></Field><Field label="Notes"><textarea name="notes" rows={3} defaultValue={contact.notes || ""} placeholder="Context worth remembering"/></Field><Field label="Trust level"><select name="trust_level" defaultValue={contact.trust_level || policy?.trust_level || "unknown"}><option value="unknown">Unknown</option><option value="known">Known</option><option value="trusted">Trusted</option><option value="operator">Operator</option><option value="blocked">Blocked</option></select></Field><label className="toggle-row"><input type="checkbox" name="pinned" defaultChecked={Boolean(contact.pinned)}/><span>Pinned</span></label><label className="toggle-row"><input type="checkbox" name="favorite" defaultChecked={Boolean(contact.favorite)}/><span>Favorite</span></label><section className="contact-point-panel" key={policy ? "policy-loaded" : "policy-default"}><h3>Contact policy</h3><label className="toggle-row"><input type="checkbox" name="allow_agent_messages" defaultChecked={policy ? Boolean(policy.allow_agent_messages) : true}/><span>Allow agent messages</span></label><label className="toggle-row"><input type="checkbox" name="allow_approval_requests" defaultChecked={Boolean(policy?.allow_approval_requests)}/><span>Allow approval requests</span></label><label className="toggle-row"><input type="checkbox" name="allow_urgent_interrupts" defaultChecked={Boolean(policy?.allow_urgent_interrupts)}/><span>Allow urgent interrupts</span></label><label className="toggle-row"><input type="checkbox" name="quiet_hours_override" defaultChecked={Boolean(policy?.quiet_hours_override)}/><span>Override quiet hours</span></label><label className="toggle-row"><input type="checkbox" name="blocked" defaultChecked={Boolean(policy?.blocked)}/><span>Blocked</span></label><Field label="Muted until"><input name="muted_until" defaultValue={policy?.muted_until || ""} placeholder="2026-06-20T22:00:00.000Z"/></Field></section><section className="contact-point-panel"><h3>Contact timeline</h3><label className="toggle-row"><input type="checkbox" checked={showAgentDetails} onChange={event => setShowAgentDetails(event.target.checked)}/><span>Show private agent details</span></label><div className="contact-timeline-list">{timeline.length ? timeline.map(item => <div className={`contact-timeline-row ${item.kind}`} key={item.id}><span className="timeline-kind">{item.kind}</span><div><strong>{item.summary}</strong><span>{item.source} · {item.status} · {formatListTime(item.occurred_at)}</span><small>{item.detail}</small></div>{item.private && <span className={`privacy-pill ${item.redacted ? "redacted" : ""}`}>{item.redacted ? "Private hidden" : "Private shown"}</span>}</div>) : <div className="empty-inline">No timeline events yet.</div>}</div></section><section className="contact-point-panel"><h3>Contact points</h3><div className="contact-point-list">{points.length ? points.map(point => <div className="contact-point-row" key={point.id}><span><strong>{point.label || point.kind}</strong><small>{point.value}{point.is_primary ? " · primary" : ""}{point.blocked_at ? " · blocked" : ""}</small></span><button type="button" className={point.blocked_at ? "button secondary" : "button danger"} onClick={async () => { await api.setContactPointBlocked(point.id, !point.blocked_at); await refreshPoints(); await refreshTimeline(); }}>{point.blocked_at ? "Unblock" : "Block"}</button></div>) : <div className="empty-inline">No contact points yet.</div>}</div><div className="contact-point-form"><Field label="Point kind"><select name="point_kind" defaultValue="phone"><option value="phone">Phone</option><option value="email">Email</option><option value="handle">Handle</option></select></Field><Field label="Point label"><input name="point_label" placeholder="mobile, work, assistant"/></Field><Field label="Point value"><input name="point_value" placeholder="+1 555 123 4567"/></Field><label className="toggle-row"><input type="checkbox" name="point_primary"/><span>Primary contact point</span></label><button type="button" className="button secondary full" disabled={pointBusy} onClick={event => void addPoint(new FormData(event.currentTarget.form!))}>{pointBusy ? "Adding..." : "Add contact point"}</button>{pointError && <div className="modal-error" role="alert">{pointError}</div>}</div></section><button type="button" className="button danger full" onClick={async () => { if (!window.confirm(`Delete ${displayName(contact)}? This removes the contact and its numbers.`)) return; await api.deleteContact(contact.id); await onDeleted(); }}>Delete contact</button></div></Modal>;
}

function StatusRow({ label, ready }: { label: string; ready?: boolean }) { return <div className="status-row"><span>{label}</span><span className={`config-pill ${ready ? "ready" : "missing"}`}>{ready ? <Icon name="check" size={14}/> : <Icon name="alert" size={14}/>} {ready ? "Configured" : "Missing"}</span></div>; }

function Settings({ config, status, dataStatus, mcpStatus, agentChannels, attentionPolicy, host, onConfigure, onConsole, onImport, onRemove, onToggle, onBackup, onExport, onRestore, onRetention, onAttentionSave, onMcpCreate, onMcpRevoke, onMcpTest, onChannelCreate, onChannelRotate, onChannelRevoke, onChannelEnabled }: { config?: ConfigStatus; status?: DesktopStatus; dataStatus?: DataStatus; mcpStatus?: McpStatus; agentChannels: AgentChannelStatus[]; attentionPolicy?: AttentionPolicy; host: string; onConfigure(): void; onConsole(): void; onImport(): void; onRemove(): void; onToggle(): void; onBackup(): void; onExport(): void; onRestore(): void; onRetention(days: number): void; onAttentionSave(policy: AttentionPolicy): void; onMcpCreate(): void; onMcpRevoke(): void; onMcpTest(): void; onChannelCreate(): void; onChannelRotate(id: string): void; onChannelRevoke(id: string): void; onChannelEnabled(id: string, enabled: boolean): void }) {
  const [retentionDays, setRetentionDays] = useState(365);
  const [policyDraft, setPolicyDraft] = useState<AttentionPolicy>(attentionPolicy || DEFAULT_ATTENTION_POLICY);
  const commands = mcpStatus?.install_commands || {};
  useEffect(() => { setPolicyDraft(attentionPolicy || DEFAULT_ATTENTION_POLICY); }, [attentionPolicy]);
  const updatePolicy = (patch: Partial<AttentionPolicy>) => setPolicyDraft(current => ({ ...current, ...patch }));
  return <main className="content-panel page-panel settings-page"><header className="page-header"><div><span className="eyebrow">Application</span><h1>Settings</h1><p>Connection health, local data safety, and the environment this app uses.</p></div></header><div className="settings-grid"><section className="settings-card"><div className="settings-card-head"><div className="settings-icon"><Icon name="settings"/></div><div><h2>Twilio connection</h2><p>Your SMS/MMS provider — credentials stay encrypted in the desktop process.</p></div></div><div className="status-list"><StatusRow label="Account SID" ready={config?.account_sid}/><StatusRow label="Auth token" ready={config?.auth_token}/><StatusRow label="Phone number" ready={config?.phone_number}/><StatusRow label="Public webhook URL" ready={config?.public_base_url}/></div><p className="settings-source">Credential source: <strong>{status?.credential_source || "none"}</strong></p>{status?.configured === false && <p className="settings-source">Local-only mode — agent messages and the local inbox work without a telecom provider; add one above to send/receive SMS.</p>}{status?.environment_import_available && status.credential_source === "environment" && <button className="button secondary full" onClick={onImport}>Import environment credentials securely</button>}<button className="button primary full" onClick={onConfigure}>{status?.configured ? "Update connection" : "Configure connection"}</button>{status?.credential_source === "stored" && <button className="button danger full" onClick={onRemove}>Remove stored credentials</button>}</section><section className="settings-card"><div className="settings-card-head"><div className="settings-icon"><Icon name="external"/></div><div><h2>Twilio Console</h2><p>Manage numbers, messaging webhooks, and usage.</p></div></div><button className="button secondary full" onClick={onConsole}>Open Twilio Console <Icon name="external" size={16}/></button></section><section className="settings-card"><div className="settings-card-head"><div className="settings-icon"><Icon name="nodes"/></div><div><h2>Channels and providers</h2><p>ForgeLink delivers through provider-neutral channels.</p></div></div><div className="status-list"><StatusRow label="Local (native)" ready={true}/><StatusRow label="Twilio SMS/MMS" ready={status?.configured}/></div><p className="settings-source">Telnyx SMS/MMS is supported via environment configuration; Plivo and Bandwidth are planned. The local channel works with no provider.</p></section><section className="settings-card span-two"><h2>Agent apps / MCP</h2><p>External tools use a separate local token file and can only reach agent-channel routes.</p><div className="status-list"><StatusRow label="Bridge built" ready={mcpStatus?.bridge_built}/><StatusRow label="Token configured" ready={mcpStatus?.configured}/><StatusRow label="Token file present" ready={mcpStatus?.token_file_present}/><StatusRow label="Local API reachable" ready={status?.running !== false}/></div><div className="mcp-paths"><div><span>Token file</span><code>{mcpStatus?.token_file || "..."}</code></div><div><span>MCP server</span><code>{mcpStatus?.bridge_server || "..."}</code></div></div><p className="settings-source">Last rotated: <strong>{mcpStatus?.rotated_at ? formatListTime(mcpStatus.rotated_at) : "never"}</strong>{mcpStatus?.last_test_status ? ` · Last test ${mcpStatus.last_test_status}` : ""}</p><div className="data-actions"><button className="button primary" onClick={onMcpCreate}>{mcpStatus?.configured ? "Rotate token file" : "Create token file"}</button><button className="button secondary" disabled={!mcpStatus?.configured} onClick={onMcpTest}>Test MCP bridge</button><button className="button danger" disabled={!mcpStatus?.configured && !mcpStatus?.token_file_present} onClick={onMcpRevoke}>Revoke token</button></div><div className="install-command-grid">{(["vscode", "claude", "codex", "forgewire"] as const).map(target => <div className="install-command" key={target}><span>{target}</span><code>{commands[target] || "Build MCP status unavailable"}</code></div>)}</div></section><section className="settings-card span-two"><h2>Agent channel credentials</h2><p>Each channel has its own local credential and rate-limit counters.</p><div className="data-actions"><button className="button primary" onClick={onChannelCreate}>Create ForgeWire channel</button></div><div className="channel-list">{agentChannels.length ? agentChannels.map(channel => <div className="channel-row" key={channel.channel_id}><div><strong>{channel.label}</strong><span>{channel.channel_id} · {channel.enabled ? "enabled" : "disabled"} · {channel.configured ? "credential configured" : "credential missing"}</span><code>{channel.token_file || "..."}</code><small>Rejected {channel.rejection_count} · Rate limited {channel.rate_limited_count}</small></div><div className="channel-actions"><button className="button secondary" onClick={() => onChannelRotate(channel.channel_id)}>Rotate</button><button className="button secondary" onClick={() => onChannelEnabled(channel.channel_id, !channel.enabled)}>{channel.enabled ? "Disable" : "Enable"}</button><button className="button danger" onClick={() => onChannelRevoke(channel.channel_id)}>Revoke</button></div></div>) : <div className="empty-inline">No agent channel credentials yet.</div>}</div></section><section className="settings-card span-two"><h2>Attention policy</h2><p>Notification rules keep messages, agent requests, and trusted signals separate by default.</p><div className="attention-grid"><label className="toggle-row"><input type="checkbox" checked={policyDraft.enabled} onChange={event => updatePolicy({ enabled: event.target.checked })}/><span>Enable desktop notifications</span></label><label className="toggle-row"><input type="checkbox" checked={policyDraft.redact_notification_bodies} onChange={event => updatePolicy({ redact_notification_bodies: event.target.checked })}/><span>Redact notification text</span></label><label className="toggle-row"><input type="checkbox" checked={policyDraft.quiet_hours_enabled} onChange={event => updatePolicy({ quiet_hours_enabled: event.target.checked })}/><span>Quiet hours</span></label><label className="toggle-row"><input type="checkbox" checked={policyDraft.quiet_hours_allow_urgent} onChange={event => updatePolicy({ quiet_hours_allow_urgent: event.target.checked })}/><span>Allow urgent agent requests during quiet hours</span></label><label className="field"><span>Quiet starts</span><input type="time" value={policyDraft.quiet_hours_start} onChange={event => updatePolicy({ quiet_hours_start: event.target.value })}/></label><label className="field"><span>Quiet ends</span><input type="time" value={policyDraft.quiet_hours_end} onChange={event => updatePolicy({ quiet_hours_end: event.target.value })}/></label><label className="field"><span>SMS</span><select value={policyDraft.sms_notifications} onChange={event => updatePolicy({ sms_notifications: event.target.value as AttentionPolicy["sms_notifications"] })}><option value="all">All SMS</option><option value="off">Off</option></select></label><label className="field"><span>Agent channels</span><select value={policyDraft.agent_notifications} onChange={event => updatePolicy({ agent_notifications: event.target.value as AttentionPolicy["agent_notifications"] })}><option value="high_and_urgent">High and urgent</option><option value="urgent_only">Urgent only</option><option value="all">All agent messages</option><option value="off">Off</option></select></label><label className="field"><span>Trusted signals</span><select value={policyDraft.signal_notifications} onChange={event => updatePolicy({ signal_notifications: event.target.value as AttentionPolicy["signal_notifications"] })}><option value="off">Off</option><option value="all">All signal updates</option></select></label><label className="field"><span>System notices</span><select value={policyDraft.system_notifications} onChange={event => updatePolicy({ system_notifications: event.target.value as AttentionPolicy["system_notifications"] })}><option value="all">All system notices</option><option value="failures_only">Failures only</option><option value="off">Off</option></select></label><label className="field span-two"><span>Muted sources or channel IDs</span><textarea rows={3} value={policyDraft.muted_sources.join("\n")} onChange={event => updatePolicy({ muted_sources: parseMutedSources(event.target.value) })}/></label></div><div className="data-actions"><button className="button primary" onClick={() => onAttentionSave(policyDraft)}>Save attention policy</button></div></section><section className="settings-card span-two"><h2>Data safety</h2><p>Schema version {dataStatus?.schema_version ?? "..."}. Backups and exports contain private message and contact data.</p>{dataStatus?.recovered_from && <div className="modal-error" role="alert">A damaged database was quarantined as {dataStatus.recovered_from}. Restore a backup if data is missing.</div>}<div className="data-actions"><button className="button primary" onClick={onBackup}>Create backup</button><button className="button secondary" onClick={onExport}>Export JSON</button><button className="button secondary" disabled={!dataStatus?.latest_backup} onClick={onRestore}>Restore latest backup</button></div><p className="settings-source">Managed backups: <strong>{dataStatus?.backup_count ?? 0}</strong>{dataStatus?.latest_backup ? ` · Latest ${dataStatus.latest_backup}` : ""}</p><div className="retention-row"><label className="field"><span>Keep messages for days</span><input type="number" min={30} max={3650} value={retentionDays} onChange={event => setRetentionDays(Number(event.target.value))}/></label><button className="button danger" onClick={() => onRetention(retentionDays)}>Apply retention</button></div></section><section className="settings-card span-two"><h2>Local service</h2><div className="service-address"><code>{host}</code><span>{status?.running === false ? "Stopped" : "Online"}</span></div>{status?.effective_port && status?.configured_port && status.effective_port !== status.configured_port && <p className="settings-source">Port {status.configured_port} was busy; the service is running on <strong>{status.effective_port}</strong>.</p>}{Boolean(status?.backend_restarts) && <p className="settings-source">Auto-recovered restarts: <strong>{status?.backend_restarts}</strong>{typeof status?.last_exit_code === "number" ? ` · last exit code ${status?.last_exit_code}` : ""}</p>}{status?.recovery_message && <div className="modal-error" role="alert">{status.recovery_message}</div>}<button className="button secondary full" onClick={onToggle}>{status?.running === false ? "Start local service" : "Stop local service"}</button></section></div></main>;
}

function ConnectionModal({ status, firstRun, onClose, onValidate, onSave }: { status?: DesktopStatus; firstRun: boolean; onClose(): void; onValidate(values: Record<string, string | number>): Promise<import("./types").ValidationResult>; onSave(values: Record<string, string | number>): Promise<void> }) {
  const current = status?.settings;
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState<import("./types").ValidationResult>();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) onClose(); };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  useEffect(() => { busyRef.current = Boolean(busy); }, [busy]);
  const values = () => { const data = new FormData(formRef.current!); return { ...Object.fromEntries(data.entries()), webhook_port: Number(data.get("webhook_port")) }; };
  async function testConnection() { setBusy("test"); setError(""); try { setValidated(await onValidate(values())); } catch (cause) { setValidated(undefined); setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(null); } }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy("save"); setError(""); try { await onSave(values()); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(null); } }
  return <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><form ref={formRef} className="modal-card" role="dialog" aria-modal="true" aria-label={firstRun ? "Welcome to ForgeLink" : "Twilio connection"} onSubmit={save}><div className="modal-head"><div><div className="eyebrow">{firstRun ? "First-run setup" : "Secure local settings"}</div><h2>{firstRun ? "Connect your Twilio account" : "Twilio connection"}</h2></div><button className="icon-button" type="button" aria-label="Close" disabled={Boolean(busy)} onClick={onClose}><Icon name="close"/></button></div><div className="modal-body"><p>{firstRun ? "Just connect your Twilio account — ForgeLink sets up everything else automatically." : "Test changes against Twilio before saving them locally."}</p>{firstRun && <div className="setup-help"><strong>New to Twilio?</strong><span>ForgeLink sends and receives texts through your own Twilio account. Create a free account, then copy the three values below from your Console dashboard.</span><div className="setup-help-links"><ExtLink href="https://www.twilio.com/try-twilio">Create a free Twilio account</ExtLink><ExtLink href="https://console.twilio.com/">Open the Twilio Console</ExtLink></div></div>}<div className="form-stack"><Field label="Account SID" hint={<>On the <ExtLink href="https://console.twilio.com/">Console dashboard</ExtLink> under Account Info — it starts with <code>AC</code>.</>}><input name="account_sid" defaultValue={current?.account_sid} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" required/></Field><Field label="Auth token" hint={<>Revealed next to the Account SID on the <ExtLink href="https://console.twilio.com/">Console dashboard</ExtLink>. Stored with operating-system encryption; leave blank to keep the current token.</>}><input name="auth_token" type="password" required={!current?.auth_token_configured} placeholder={current?.auth_token_configured ? "Configured; enter to replace" : "Enter auth token"}/></Field><Field label="Twilio number" hint={<>An SMS-capable number on your account, in +country format. <ExtLink href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming">View or get a number →</ExtLink></>}><input name="twilio_number" type="tel" defaultValue={current?.twilio_number} placeholder="+15551234567" required/></Field></div><details className="setup-advanced"><summary>Advanced (optional) — ForgeLink manages these for you</summary><div className="form-stack"><Field label="Public webhook URL" hint="ForgeLink sets this up automatically with a secure tunnel when you connect, so inbound texts just work. Set a value only if you run your own public URL."><input name="public_base_url" type="url" defaultValue={current?.public_base_url} placeholder="Automatic"/></Field><Field label="Local host" hint="The local service stays bound to loopback."><input name="webhook_host" defaultValue={current?.webhook_host || "127.0.0.1"} pattern="127\.0\.0\.1|localhost" required/></Field><Field label="Local port" hint="Default local service port."><input name="webhook_port" type="number" defaultValue={current?.webhook_port || 5055} min={1024} max={65535} required/></Field></div></details>{validated && <div className="validation-success" role="status"><Icon name="check" size={18}/><span><strong>{validated.account_name}</strong><br/>Confirmed {validated.phone_number}</span></div>}{error && <div className="modal-error" role="alert">{error}</div>}</div><div className="modal-actions"><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void testConnection()}>{busy === "test" ? "Testing..." : "Test connection"}</button><button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Validating and saving..." : "Save and restart"}</button></div></form></div>;
}

function LinkModal({ contacts, thread, onClose, onLink, onAdd }: { contacts: Contact[]; thread: Thread; onClose(): void; onLink(contactId: number): Promise<void>; onAdd(): void }) {
  return <Modal title="Link contact" eyebrow={displayName(thread)} onClose={onClose} hideSubmit><div className="contact-picker">{contacts.length ? contacts.map(contact => <button className="contact-picker-row" type="button" key={contact.id} onClick={() => void onLink(contact.id)}><Avatar name={displayName(contact)} size="small"/><span><strong>{displayName(contact)}</strong><small>{contact.number}</small></span><Icon name="chevron" size={16}/></button>) : <div className="empty-inline">No contacts yet.</div>}<button className="button primary full" type="button" onClick={onAdd}>Add new contact</button></div></Modal>;
}
