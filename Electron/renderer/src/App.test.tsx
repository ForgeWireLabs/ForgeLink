// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { parseOperatorStatus } from "./operatorStatus";
import { SHELL_BRIDGE_CAPABILITIES, shell } from "./shell";
import { ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES, androidLocalCommsStoreAllowsDataClass, buildAndroidLocalCommsStoreSnapshot, parseAndroidLocalCommsStoreSnapshot, serializeAndroidLocalCommsStoreSnapshot } from "./androidLocalCommsStore";
import { DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES, buildDesktopLinkedNodeStatus, desktopLinkedNodeStatusAcceptsDataClass } from "./desktopLinkedNodeStatus";
import { buildRedactedLinkedNodeLifecycleStatus, linkedNodeLifecycleLocksPrivateData, linkedNodeLifecyclePausesLinkedOperations } from "./linkedNodeLifecycle";
import { evaluatePrivateDataPolicyGate, type PrivateDataPolicyGateInput } from "./privateDataPolicyGate";
import { buildSignedLinkEnvelopeReplayKey, validateSignedLinkEnvelopeFixture, type SignedLinkEnvelopeFixture } from "./signedLinkEnvelopeValidator";
import { validateMetadataChangeSetFixture, type MetadataChangeSetFixture } from "./metadataChangeSetValidator";

const thread = { id: 1, canonical_number: "+15551234567", name: "Ada Lovelace", last_msg_ts: "2026-06-14T18:00:00.000Z", unread_count: 0 };
const contact = { id: 7, name: "Grace Hopper", number: "+15557654321" };
const operatorContact = { id: 8, name: "Primary Operator", number: "+15550000001", trust_level: "operator" };
const familyContact = { id: 9, name: "Katherine Johnson", number: "+15550000002", tags: "family" };
const blockedContact = { id: 10, name: "Blocked Sender", number: "+15550000003", trust_level: "blocked" };
const message = { id: "SM1", direction: "inbound", body: "Hello", ts: "2026-06-14T18:00:00.000Z", status: "received", media_urls: "" };
const agentMessage = { id: "agent-1", channel_id: "forgewire", source: "forgewire", kind: "approval_request", urgency: "normal", title: "Release approval", body: "ForgeWire wants approval.", actions: JSON.stringify([{ id: "approve", label: "Approve" }]), status: "unread", action_result: "", created_at: "2026-06-14T18:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", last_error: "" };
const signalSubscription = { id: "sigsub-1", title: "Forge Signals", url: "https://example.com/feed.xml", enabled: true, muted: false, fetch_interval_minutes: 60, retention_days: 30, last_fetch_at: "2026-06-15T12:00:00.000Z", last_fetch_status: "ok", last_error: "", created_at: "2026-06-15T10:00:00.000Z", updated_at: "2026-06-15T12:00:00.000Z" };
const signalItem = { id: "sigitem-1", subscription_id: "sigsub-1", source_title: "Forge Signals", title: "Build note", url: "https://example.com/build", summary: "Release candidate ready.", author: "ForgeWire", published_at: "2026-06-15T12:00:00.000Z", received_at: "2026-06-15T12:01:00.000Z", status: "unread", muted: false };
const callRow = { id: 1, local_call_id: "call-1", provider_kind: "voice_edge", provider_name: "twilio", provider_call_id: "CA1", direction: "outbound", from_number: "+15550001111", to_number: "+15557654321", contact_id: 7, contact_point_id: 70, status: "in_progress", started_at: "2026-06-20T21:00:00.000Z", answered_at: "2026-06-20T21:00:10.000Z", ended_at: null, duration_seconds: null, redacted_error: "", created_at: "2026-06-20T21:00:00.000Z", updated_at: "2026-06-20T21:00:10.000Z", contact_name: "Grace Hopper", contact_point_label: "primary", contact_point_value: "+15557654321" };
const mcpStatus = { configured: false, created_at: null, rotated_at: null, revoked_at: null, last_used_at: null, last_test_at: null, last_test_status: null, token_file: "C:\\Users\\test\\.forgelink\\api.token", token_file_present: false, bridge_server: "C:\\Projects\\TWL_phone\\mcp\\forgelink-human\\dist\\server.js", bridge_built: true, base_url: "http://127.0.0.1:5055", install_commands: { vscode: "install vscode", claude: "install claude", codex: "install codex", forgewire: "install forgewire" } };
const agentChannel = { channel_id: "forgewire", label: "ForgeWire Fabric", enabled: true, configured: true, created_at: "2026-06-15T22:00:00.000Z", rotated_at: "2026-06-15T22:00:00.000Z", revoked_at: null, last_used_at: null, last_rejected_at: null, rejection_count: 2, rate_limited_count: 1, token_file: "C:\\Users\\test\\.forgelink\\channels\\forgewire.token", token_file_present: true };
const attentionPolicy = { enabled: true, operator_mode: "available", quiet_hours_enabled: false, quiet_hours_start: "22:00", quiet_hours_end: "07:00", quiet_hours_allow_urgent: false, redact_notification_bodies: true, sms_notifications: "all", agent_notifications: "high_and_urgent", signal_notifications: "off", system_notifications: "all", emergency_contact_bypass: true, emergency_agent_requires_policy: true, presence_enabled: true, presence_app_focus: "unknown", presence_input: "unknown", presence_network: "unknown", presence_do_not_disturb: false, presence_paired_mobile: "unknown", muted_sources: [] };
const outboundDraft = { id: "draft-1", agent_id: "forgewire", channel_id: "forgewire", channel_kind: "sms", to_number: "+15557654321", contact_id: 7, body: "Hi from the agent. (draft)", media_urls: "", status: "draft", firewall_decision: "require_approval", reason: "needs_review", provider_message_id: "", last_error: "", created_at: "2026-06-20T20:00:00.000Z", updated_at: "2026-06-20T20:00:00.000Z", decided_at: null, scheduled_at: null };
let outboundDraftsFixture: Array<Record<string, unknown>>;
let sampleStatusFixture: Record<string, unknown>;
let messagesFixture: Array<Record<string, unknown>>;
let olderFixture: Array<Record<string, unknown>>;
let agentMessagesFixture: Array<Record<string, unknown>>;
let contactsFixture: Array<Record<string, unknown>>;
let callsFixture: Array<Record<string, unknown>>;
let signalSubscriptionsFixture: Array<Record<string, unknown>>;
let signalItemsFixture: Array<Record<string, unknown>>;
let contactPointsFixture: Array<Record<string, unknown>>;
let contactPolicyFixture: Record<string, unknown>;
let contactTimelineFixture: Array<Record<string, unknown>>;

function response(payload: unknown, ok = true): Promise<Response> { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload } as Response); }

beforeEach(() => {
  outboundDraftsFixture = [outboundDraft];
  sampleStatusFixture = { loaded: false, counts: { contacts: 0, agents: 0, approvals: 0, outcomes: 0, channels: 0 } };
  messagesFixture = [message];
  olderFixture = [];
  agentMessagesFixture = [agentMessage];
  contactsFixture = [contact];
  callsFixture = [];
  signalSubscriptionsFixture = [signalSubscription];
  signalItemsFixture = [signalItem];
  contactPointsFixture = [{ id: 70, contact_id: 7, kind: "phone", value: "+15557654321", label: "primary", is_primary: 1, blocked_at: null }];
  contactPolicyFixture = { contact_id: 7, trust_level: "unknown", allow_agent_messages: 1, allow_approval_requests: 0, allow_urgent_interrupts: 0, quiet_hours_override: 0, muted_until: null, blocked: 0 };
  contactTimelineFixture = [
    { id: "message:SM1", kind: "message", occurred_at: "2026-06-20T20:00:00.000Z", summary: "Inbound message", detail: "ordinary text", status: "received", direction: "inbound", source: "primary · +15557654321", private: false, redacted: false },
    { id: "agent:agent-private", kind: "agent", occurred_at: "2026-06-20T20:05:00.000Z", summary: "approval request · unread", detail: "Private agent details hidden", status: "urgent", direction: "agent", source: "fabric · forgewire", private: true, redacted: true }
  ];
  window.desktop = {
    notify: vi.fn(),
    notifyEvent: vi.fn().mockResolvedValue({ notify: true, reason: "allowed", title: "ForgeLink", body: "ForgeLink has an update." }),
    openExternal: vi.fn(),
    backendConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:5055", apiToken: "renderer-api-token" }),
    getStatus: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored", needs_onboarding: false, settings: { account_sid: "AC123", auth_token_configured: true, twilio_number: "+15550001111", public_base_url: "https://phone.example.com", webhook_host: "127.0.0.1", webhook_port: 5055, attention_policy: attentionPolicy } }),
    validateSettings: vi.fn().mockResolvedValue({ account_name: "Test Account", account_status: "active", phone_number: "+15550002222" }),
    startServer: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5056", configured: true, credential_source: "stored", validation: { account_name: "Test Account", account_status: "active", phone_number: "+15550002222" }, settings: { account_sid: "AC999", auth_token_configured: true, twilio_number: "+15550002222", public_base_url: "https://new.example.com", webhook_host: "127.0.0.1", webhook_port: 5056 } }),
    startLocalOnly: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", onboarding_complete: true, needs_onboarding: false, settings: { account_sid: "", auth_token_configured: false, twilio_number: "", public_base_url: "", webhook_host: "127.0.0.1", webhook_port: 5055 } }),
    importEnvironment: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored" }),
    removeCredentials: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", onboarding_complete: true, needs_onboarding: false }),
    stopServer: vi.fn().mockResolvedValue({ running: false, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored", settings: { account_sid: "AC999", auth_token_configured: true, twilio_number: "+15550002222", public_base_url: "https://new.example.com", webhook_host: "127.0.0.1", webhook_port: 5056 } }),
    mcpStatus: vi.fn().mockResolvedValue(mcpStatus),
    createMcpToken: vi.fn().mockResolvedValue({ ...mcpStatus, configured: true, token_file_present: true, rotated_at: "2026-06-15T22:00:00.000Z" }),
    revokeMcpToken: vi.fn().mockResolvedValue({ ...mcpStatus, configured: false, token_file_present: false, revoked_at: "2026-06-15T22:01:00.000Z" }),
    testMcpBridge: vi.fn().mockResolvedValue({ ...mcpStatus, configured: true, token_file_present: true, last_test_status: "passed", last_test_at: "2026-06-15T22:02:00.000Z" }),
    agentChannels: vi.fn().mockResolvedValue([agentChannel]),
    attentionPolicy: vi.fn().mockResolvedValue(attentionPolicy),
    saveAttentionPolicy: vi.fn().mockResolvedValue({ ...attentionPolicy, signal_notifications: "all", quiet_hours_enabled: true, muted_sources: ["forgewire"] }),
    createAgentChannel: vi.fn().mockResolvedValue(agentChannel),
    rotateAgentChannel: vi.fn().mockResolvedValue({ ...agentChannel, rotated_at: "2026-06-15T22:03:00.000Z" }),
    revokeAgentChannel: vi.fn().mockResolvedValue({ ...agentChannel, configured: false, revoked_at: "2026-06-15T22:04:00.000Z", token_file_present: false }),
    setAgentChannelEnabled: vi.fn().mockResolvedValue({ ...agentChannel, enabled: false }),
    emailSettings: vi.fn().mockResolvedValue({ configured: false, host: "", port: 465, secure: true, user: "", from: "", password_present: false, inbound_secret_present: false, action_secret_present: false }),
    saveEmailSettings: vi.fn().mockResolvedValue({ configured: true, host: "smtp.example.com", port: 587, secure: false, user: "ops@example.com", from: "ops@example.com", password_present: true, inbound_secret_present: false, action_secret_present: false }),
    removeEmailSettings: vi.fn().mockResolvedValue({ configured: false, host: "", port: 465, secure: true, user: "", from: "", password_present: false, inbound_secret_present: false, action_secret_present: false }),
    pushSettings: vi.fn().mockResolvedValue({ configured: false, provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe", topic_present: false, token_present: false }),
    pairingStatus: vi.fn().mockResolvedValue({ state: "unpaired", label: "Unpaired", detail: "This Android device has not been paired with the desktop ForgeLink authority.", capabilities: [] }),
    nodeLinkStatus: vi.fn().mockResolvedValue({ schema_version: 1, node_id: "local-android-node", platform: "android", device_label: "Android local node", link_state: "local_only", trust_state: "local", sync_mode: "none", capability_claims: ["cockpit.local", "sync.none"], authority_node_id: null, linked_at: null, last_seen_at: null, revoked_at: null, stale_after: null, detail: "This ForgeLink node is running local-only. No desktop link or private-data sync is active." }),
    desktopLinkedNodeStatus: vi.fn().mockResolvedValue(buildDesktopLinkedNodeStatus()),
    savePushSettings: vi.fn().mockResolvedValue({ configured: true, provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe", topic_present: true, token_present: false }),
    removePushSettings: vi.fn().mockResolvedValue({ configured: false, provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe", topic_present: false, token_present: false }),
    onServerStatus: vi.fn()
  };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer renderer-api-token") return response({ error: "Unauthorized" }, false);
    if (url.includes("/api/messages")) return response(url.includes("before=") ? olderFixture : messagesFixture);
    if (url.endsWith("/api/agent-messages")) return response(agentMessagesFixture);
    if (url.startsWith("http://127.0.0.1:5055/api/calls?")) return response(callsFixture);
    if (url.endsWith("/api/calls/start")) { callsFixture = [callRow]; return response({ ok: true, call: callRow }); }
    if (url.endsWith("/api/calls/end")) { callsFixture = [{ ...callRow, status: "completed", ended_at: "2026-06-20T21:01:00.000Z", duration_seconds: 60 }]; return response({ ok: true, call: callsFixture[0] }); }
    if (url.endsWith("/api/agent-messages/agent-1/read")) { agentMessagesFixture = [{ ...agentMessage, status: "read" }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    if (url.endsWith("/api/agent-messages/agent-1/dismiss")) { agentMessagesFixture = [{ ...agentMessage, status: "dismissed" }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    if (url.endsWith("/api/agent-messages/agent-1/actions/approve")) { agentMessagesFixture = [{ ...agentMessage, status: "acted", action_result: JSON.stringify({ action_id: "approve" }) }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    const actionMatch = url.match(/\/api\/agent-messages\/([^/]+)\/actions\/([^/]+)$/);
    if (actionMatch) {
      const [, id, actionId] = actionMatch.map(decodeURIComponent);
      const next = (agentMessagesFixture.find(item => item.id === id) || agentMessage) as typeof agentMessage;
      agentMessagesFixture = agentMessagesFixture.map(item => item.id === id ? { ...item, status: "acted", action_result: JSON.stringify({ action_id: actionId, decided_at: new Date().toISOString() }) } : item);
      return response({ ok: true, message: { ...next, status: "acted", action_result: JSON.stringify({ action_id: actionId, decided_at: new Date().toISOString() }) } });
    }
    if (url.endsWith("/api/signals/subscriptions")) return response(init?.method === "POST" ? { ok: true, subscription: signalSubscription } : signalSubscriptionsFixture);
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/refresh")) return response({ ok: true, added: 1, deleted: 0, subscription: signalSubscription, items: signalItemsFixture });
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/disable")) { signalSubscriptionsFixture = [{ ...signalSubscription, enabled: false }]; return response({ ok: true, subscription: signalSubscriptionsFixture[0] }); }
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/mute")) { signalSubscriptionsFixture = [{ ...signalSubscription, muted: true }]; return response({ ok: true, subscription: signalSubscriptionsFixture[0] }); }
    if (url.endsWith("/api/signals/items?limit=50")) return response(signalItemsFixture);
    if (url.endsWith("/api/signals/items/sigitem-1/archive")) { signalItemsFixture = []; return response({ ok: true, item: { ...signalItem, status: "archived" } }); }
    if (url.endsWith("/api/outbound-drafts/dispatch-due")) return response({ ok: true, dispatched: 0, results: [] });
    if (url.endsWith("/api/outbound-drafts/draft-1/approve-send")) { outboundDraftsFixture = [{ ...outboundDraft, status: "sent", provider_message_id: "SM-OUT", decided_at: "2026-06-20T20:05:00.000Z" }]; return response({ ok: true, draft: outboundDraftsFixture[0] }); }
    if (url.endsWith("/api/outbound-drafts/draft-1/deny")) { outboundDraftsFixture = [{ ...outboundDraft, status: "denied", reason: "denied" }]; return response({ ok: true, draft: outboundDraftsFixture[0] }); }
    if (url.endsWith("/api/outbound-drafts/draft-1/edit")) { const body = JSON.parse(String(init?.body || "{}")); outboundDraftsFixture = [{ ...outboundDraft, body: body.body }]; return response({ ok: true, draft: outboundDraftsFixture[0] }); }
    if (url.endsWith("/api/outbound-drafts/draft-1/schedule")) { const body = JSON.parse(String(init?.body || "{}")); outboundDraftsFixture = [{ ...outboundDraft, status: "scheduled", scheduled_at: body.scheduled_at }]; return response({ ok: true, draft: outboundDraftsFixture[0] }); }
    if (url.endsWith("/api/outbound-drafts/draft-1/cancel-schedule")) { outboundDraftsFixture = [outboundDraft]; return response({ ok: true, draft: outboundDraftsFixture[0] }); }
    if (url.includes("/api/outbound-drafts")) return response(outboundDraftsFixture);
    if (url.endsWith("/api/redaction-profiles/preview")) { const body = JSON.parse(String(init?.body || "{}")); const profile = String(body.profile || ""); const full = profile === "desktop_full"; const note = body.notification || {}; return response({ profile: { id: profile, label: profile }, notification: { title: note.title || "", body: full ? note.body || "" : "", redaction_profile: profile, redacted: !full } }); }
    if (url.includes("/api/device/operator-status")) return response({ ok: true, target: "emulator-only", authority: "readonly-emulator-inspection", mode: "operator-status", request_id: "forgelink-op-001", bridge_version: "rom_lab.forgelink_operator_status.v1", device: { android_release: "15", sdk: "35", model: "Android SDK built for x86_64", hardware: "ranchu", fingerprint: "fp" }, boot: { completed: true }, network: { summary: "network-read: 52 sanitized line(s)" }, storage: { summary: "storage-read: 52 sanitized line(s)" }, activity: { current_user: "0", top_activity: "ACTIVITY com.android.launcher3/.uioverrides.QuickstepLauncher 7b3f70c" }, packages: { summary: "packages: 40 visible package line(s)", count: 40 } });
    if (url.endsWith("/api/channels/email/status")) return response({ configured: false, host_present: false, from_present: false, recorded_count: 0 });
    if (url.endsWith("/api/channels/push/status")) return response({ configured: false, provider: "ntfy", url: "https://ntfy.sh", profile: "lock_screen_safe", topic_present: false, token_present: false });
    if (url.endsWith("/api/push/test")) return response({ ok: true, status: "sent" });
    if (url.endsWith("/api/sample/status")) return response(sampleStatusFixture);
    if (url.endsWith("/api/sample/load")) { sampleStatusFixture = { loaded: true, counts: { contacts: 3, agents: 3, approvals: 4, outcomes: 1, channels: 1 } }; return response({ ok: true, ...sampleStatusFixture }); }
    if (url.endsWith("/api/sample/clear")) { sampleStatusFixture = { loaded: false, counts: { contacts: 0, agents: 0, approvals: 0, outcomes: 0, channels: 0 } }; return response({ ok: true, ...sampleStatusFixture }); }
    if (url.endsWith("/api/threads")) return response([thread]);
    if (url.includes("/api/contacts/points?")) return response(contactPointsFixture);
    if (url.includes("/api/contacts/timeline?")) return response(url.includes("include_agent_details=1") ? contactTimelineFixture.map(item => item.id === "agent:agent-private" ? { ...item, detail: "Deploy approval: Private body", redacted: false } : item) : contactTimelineFixture);
    if (url.endsWith("/api/contacts/points")) {
      const body = JSON.parse(String(init?.body || "{}"));
      contactPointsFixture = [...contactPointsFixture, { id: 71, contact_id: body.contact_id, kind: body.kind, value: body.value, label: body.label, is_primary: body.is_primary ? 1 : 0, blocked_at: null }];
      return response({ ok: true, id: 71 });
    }
    if (url.endsWith("/api/contacts/points/block")) {
      const body = JSON.parse(String(init?.body || "{}"));
      contactPointsFixture = contactPointsFixture.map(point => point.id === body.point_id ? { ...point, blocked_at: body.blocked ? "2026-06-20T00:00:00.000Z" : null } : point);
      return response({ ok: true });
    }
    if (url.includes("/api/contacts/policy?")) return response(contactPolicyFixture);
    if (url.endsWith("/api/contacts/policy")) {
      contactPolicyFixture = { ...contactPolicyFixture, ...JSON.parse(String(init?.body || "{}")) };
      return response(contactPolicyFixture);
    }
    if (url.includes("/api/contacts")) return response(init?.method === "POST" ? { ok: true } : contactsFixture);
    if (url.endsWith("/api/unknown-number/ignore")) return response({ ok: true });
    if (url.endsWith("/api/unknown-number/block")) return response({ ok: true, id: 9 });
    if (url.endsWith("/api/config-status")) return response({ account_sid: true, auth_token: true, phone_number: true, public_base_url: true });
    if (url.endsWith("/api/data/status")) return response({ schema_version: 7, latest_backup: "backup-test", backup_count: 1, recovered_from: null, migration_backup: null });
    if (url.endsWith("/api/data/backup")) return response({ ok: true, name: "backup-test" });
    if (url.endsWith("/api/data/export")) return response({ ok: true, name: "export-test.json" });
    if (url.endsWith("/api/data/restore-latest")) return response({ ok: true, name: "backup-test" });
    if (url.endsWith("/api/data/retention")) return response({ ok: true, deletedMessages: 2, deletedThreads: 1, deletedUploads: 1, deletedAgentMessages: 1, deletedSignalItems: 1, deletedCalls: 1 });
    if (url.includes("/api/draft")) return response(init?.method === "POST" ? { ok: true } : { body: "" });
    if (url.endsWith("/api/send")) return response({ sid: "SM2", status: "queued" });
    if (url.endsWith("/api/retry")) return response({ sid: "SM2", status: "queued" });
    if (url.endsWith("/api/link-thread")) return response({ ok: true });
    if (url.endsWith("/upload")) return response({ url: "http://127.0.0.1:5055/media/file.png" });
    return response({});
  }));
});

afterEach(() => { cleanup(); delete window.forgeLinkShell; delete window.__TAURI__; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function selectConversation() {
  render(<App/>);
  await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
  await userEvent.click(await screen.findByRole("button", { name: "Open messages" }));
  await userEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
  await screen.findByRole("heading", { name: "Ada Lovelace" });
}

describe("React renderer parity", () => {
  it("prefers the ForgeLink shell bridge over the legacy Electron preload name", async () => {
    const legacyStatus = vi.mocked(window.desktop!.getStatus);
    const shellStatus = vi.fn().mockResolvedValue({
      running: true,
      baseUrl: "http://127.0.0.1:5055",
      configured: true,
      credential_source: "stored",
      needs_onboarding: false
    });
    window.forgeLinkShell = {
      ...window.desktop!,
      getStatus: shellStatus,
      backendConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:5055", apiToken: "renderer-api-token" })
    };

    render(<App/>);

    await screen.findByRole("heading", { name: "Decisions" });
    expect(shellStatus).toHaveBeenCalled();
    expect(legacyStatus).not.toHaveBeenCalled();
  });

  it("documents the shared shell bridge capabilities needed by Tauri", async () => {
    const capabilityNames = Object.values(SHELL_BRIDGE_CAPABILITIES).flat();
    expect(SHELL_BRIDGE_CAPABILITIES.localService).toEqual(expect.arrayContaining(["backendConnection", "startServer", "startLocalOnly", "stopServer"]));
    expect(SHELL_BRIDGE_CAPABILITIES.notifications).toEqual(expect.arrayContaining(["notify", "notifyEvent"]));
    expect(SHELL_BRIDGE_CAPABILITIES.navigation).toContain("openExternal");
    expect(SHELL_BRIDGE_CAPABILITIES.secureSettings).toEqual(expect.arrayContaining(["importEnvironment", "emailSettings", "pushSettings"]));
    expect(SHELL_BRIDGE_CAPABILITIES.agentCredentials).toEqual(expect.arrayContaining(["mcpStatus", "agentChannels", "setAgentChannelEnabled"]));
    expect(capabilityNames.every(name => typeof window.desktop?.[name as keyof typeof window.desktop] === "function")).toBe(true);
  });

  it("routes shell calls through Tauri invoke when running under a Tauri shell", async () => {
    delete window.forgeLinkShell;
    delete window.desktop;
    const invokeMock = vi.fn(async (command: string): Promise<unknown> => {
      if (command === "forgelink_get_status") return { running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", needs_onboarding: false };
      if (command === "forgelink_backend_connection") return { baseUrl: "http://127.0.0.1:5055", apiToken: "renderer-api-token" };
      return {};
    });
    const invoke = invokeMock as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    window.__TAURI__ = { core: { invoke } };

    render(<App/>);

    await screen.findByRole("heading", { name: "Decisions" });
    expect(invokeMock).toHaveBeenCalledWith("forgelink_get_status");
    expect(invokeMock).toHaveBeenCalledWith("forgelink_backend_connection");
  });

  it("authenticates every local API request with the per-launch credential", async () => {
    render(<App/>);
    expect(await screen.findByRole("heading", { name: "Decisions" })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, init]) => new Headers(init?.headers).get("Authorization") === "Bearer renderer-api-token")).toBe(true);
  });

  it("opens first-run onboarding and tests credentials without saving", async () => {
    vi.mocked(window.desktop!.getStatus).mockResolvedValueOnce({ running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", needs_onboarding: true, settings: { account_sid: "", auth_token_configured: false, twilio_number: "", public_base_url: "", webhook_host: "127.0.0.1", webhook_port: 5055 } });
    render(<App/>);
    expect(await screen.findByRole("dialog", { name: "Welcome to ForgeLink" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Account SID"), `AC${"a".repeat(32)}`);
    await userEvent.type(screen.getByPlaceholderText("Enter auth token"), "secret");
    await userEvent.type(screen.getByLabelText("Twilio number"), "+15550002222");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Confirmed +15550002222")).toBeTruthy();
    expect(window.desktop?.validateSettings).toHaveBeenCalled();
    expect(window.desktop?.startServer).not.toHaveBeenCalled();
  });

  it("starts first-run in local-only mode without validating Twilio", async () => {
    vi.mocked(window.desktop!.getStatus).mockResolvedValueOnce({ running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", onboarding_complete: false, needs_onboarding: true, settings: { account_sid: "", auth_token_configured: false, twilio_number: "", public_base_url: "", webhook_host: "127.0.0.1", webhook_port: 5055 } });
    render(<App/>);
    expect(await screen.findByRole("dialog", { name: "Welcome to ForgeLink" })).toBeTruthy();
    expect(screen.getByText(/ForgeLink works without a telecom provider/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start local-only" }));
    await waitFor(() => expect(window.desktop?.startLocalOnly).toHaveBeenCalledWith(expect.objectContaining({ webhook_host: "127.0.0.1", webhook_port: 5055 })));
    expect(window.desktop?.validateSettings).not.toHaveBeenCalled();
    expect(window.desktop?.startServer).not.toHaveBeenCalled();
  });

  it("switches views and filters contacts", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    expect(await screen.findByRole("heading", { name: "People" })).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people" }), "missing");
    expect(screen.getByText("No people found")).toBeTruthy();
  });

  it("groups people by relationship and makes unknown and blocked distinct", async () => {
    contactsFixture = [operatorContact, familyContact, { ...contact, trust_level: "trusted" }, { id: 11, name: "External Vendor", number: "+15550000004", company: "Example Co" }, { id: 12, name: "Build Agent", number: "+15550000005", tags: "agent" }, { id: 13, name: "Pager System", number: "+15550000006", role: "system" }, { id: 14, name: "Mystery Caller", number: "+15550000007" }, blockedContact];
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    expect(await screen.findByRole("heading", { name: "People" })).toBeTruthy();
    for (const group of ["Operator", "Family", "Trusted humans", "External contacts", "Agents", "Systems", "Unknown", "Blocked"]) {
      expect(screen.getByRole("region", { name: group })).toBeTruthy();
    }
    expect(within(screen.getByRole("region", { name: "Unknown" })).getByText("Mystery Caller")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Blocked" })).getByText("Blocked Sender")).toBeTruthy();
  });

  it("places and ends a voice call from the dialpad (CLV-015)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open calls" }));
    expect(await screen.findByRole("heading", { name: "Calls" })).toBeTruthy();
    expect(screen.getByText("Voice ready")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Selected contact"), "7");
    expect((screen.getByLabelText("Dial number") as HTMLInputElement).value).toBe("+15557654321");
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/calls/start"))).toBe(true));
    await waitFor(() => expect(screen.getAllByText("Grace Hopper").length).toBeGreaterThan(0));
    expect(screen.getByText(/outbound · twilio · in progress/)).toBeTruthy();
    expect(screen.getByText(/\+15550001111 -> \+15557654321/)).toBeTruthy();
    expect(screen.getByText(/CA1/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/calls/end"))).toBe(true));
  });

  it("shows voice disabled state when provider configuration is incomplete (CLV-015)", async () => {
    vi.mocked(fetch).mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (new Headers(init?.headers).get("Authorization") !== "Bearer renderer-api-token") return response({ error: "Unauthorized" }, false);
      if (url.endsWith("/api/config-status")) return response({ account_sid: true, auth_token: true, phone_number: true, public_base_url: false });
      if (url.startsWith("http://127.0.0.1:5055/api/calls?")) return response([]);
      if (url.endsWith("/api/threads")) return response([thread]);
      if (url.endsWith("/api/agent-messages")) return response([]);
      if (url.endsWith("/api/signals/subscriptions")) return response([]);
      if (url.endsWith("/api/signals/items?limit=50")) return response([]);
      if (url.includes("/api/contacts")) return response([contact]);
      if (url.endsWith("/api/data/status")) return response({ schema_version: 10, latest_backup: null, backup_count: 0, recovered_from: null, migration_backup: null });
      return response({});
    });
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open calls" }));
    expect(await screen.findByText("Voice disabled")).toBeTruthy();
    expect(screen.getByText(/Public webhook URL/)).toBeTruthy();
    await userEvent.keyboard("5551234567");
    expect((screen.getByRole("button", { name: "Call" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits and deletes contact metadata (CLV-009)", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    await screen.findByText("Grace Hopper");
    await userEvent.click(screen.getByRole("button", { name: "Edit Grace Hopper" }));
    await screen.findByText("Contact policy");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/contacts/policy?contact_id=7"))).toBe(true));
    expect(await screen.findByText("Contact timeline")).toBeTruthy();
    expect(screen.getByText("ordinary text")).toBeTruthy();
    expect(screen.getByText("Private agent details hidden")).toBeTruthy();
    expect(screen.queryByText(/Private body/)).toBeNull();
    await userEvent.click(screen.getByLabelText("Show private agent details"));
    expect(await screen.findByText(/Private body/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Company"), "Navy");
    await userEvent.selectOptions(screen.getByLabelText("Trust level"), "trusted");
    await userEvent.click(screen.getByLabelText("Pinned"));
    await userEvent.click(screen.getByLabelText("Allow approval requests"));
    await userEvent.click(screen.getByLabelText("Allow urgent interrupts"));
    await userEvent.click(screen.getByLabelText("Override quiet hours"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const update = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/contacts/update"));
    expect(update).toBeTruthy();
    const updateBody = JSON.parse(String(update![1]!.body));
    expect(updateBody).toMatchObject({ id: 7, company: "Navy", trust_level: "trusted", pinned: true });
    const policy = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/contacts/policy") && init?.method === "POST");
    expect(policy).toBeTruthy();
    expect(JSON.parse(String(policy![1]!.body))).toMatchObject({ contact_id: 7, trust_level: "trusted", allow_agent_messages: 1, allow_approval_requests: 1, allow_urgent_interrupts: 1, quiet_hours_override: 1, blocked: 0 });

    await userEvent.click(screen.getByRole("button", { name: "Edit Grace Hopper" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete contact" }));
    const remove = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/contacts/delete"));
    expect(remove).toBeTruthy();
    expect(JSON.parse(String(remove![1]!.body))).toEqual({ id: 7 });
    expect(window.confirm).toHaveBeenCalled();
  });

  it("adds contact points and handles unknown conversation actions (CLV-010)", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    await screen.findByText("Grace Hopper");
    await userEvent.click(screen.getByRole("button", { name: "Edit Grace Hopper" }));
    expect(await screen.findByText("+15557654321 · primary")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Point kind"), "email");
    await userEvent.type(screen.getByLabelText("Point label"), "work");
    await userEvent.type(screen.getByLabelText("Point value"), "grace@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add contact point" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/contacts/points"))).toBe(true));
    const pointAdd = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith("/api/contacts/points") && init?.method === "POST")!;
    expect(JSON.parse(String(pointAdd[1]!.body))).toMatchObject({ contact_id: 7, kind: "email", value: "grace@example.com", label: "work" });
    await userEvent.click((await screen.findAllByRole("button", { name: "Block" }))[0]);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/contacts/points/block"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Channels" }));
    await userEvent.click(screen.getByRole("button", { name: "Open messages" }));
    await userEvent.click((await screen.findByText("Ada Lovelace")).closest("button")!);
    await userEvent.click(screen.getByRole("button", { name: "Link contact" }));
    await userEvent.click(await screen.findByRole("button", { name: /Grace Hopper/ }));
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/link-thread"))).toBe(true);
  });

  it("shows agent channel messages without mixing them into SMS conversations", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Decisions" }));
    expect(await screen.findByRole("heading", { name: "Decisions" })).toBeTruthy();
    expect(screen.getByText("Release approval")).toBeTruthy();
    expect(screen.getByText("ForgeWire wants approval.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/agent-messages/agent-1/actions/approve"))).toBe(true));
    expect(within(await screen.findByRole("region", { name: "Completed" })).getByText("Release approval")).toBeTruthy();
  });

  it("splits agent work into decision triage lanes", async () => {
    agentMessagesFixture = [
      agentMessage,
      { ...agentMessage, id: "waiting-1", title: "Waiting for tool", actions: "[]", status: "read" },
      { ...agentMessage, id: "info-1", title: "FYI signal", kind: "notice", actions: "[]" },
      { ...agentMessage, id: "failed-1", title: "Repair request", last_error: "validation failed" },
      { ...agentMessage, id: "muted-1", title: "Muted agent", source: "muted-source" },
      { ...agentMessage, id: "expired-1", title: "Expired approval", status: "expired" },
      { ...agentMessage, id: "done-1", title: "Completed approval", status: "acted" }
    ];
    vi.mocked(window.desktop!.attentionPolicy).mockResolvedValueOnce({ ...attentionPolicy, muted_sources: ["muted-source"] } as import("./types").AttentionPolicy);
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Decisions" }));
    expect(within(await screen.findByRole("region", { name: "Needs decision" })).getByText("Release approval")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Waiting on agent" })).getByText("Waiting for tool")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Informational" })).getByText("FYI signal")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Failed / repair" })).getByText("Repair request")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Muted" })).getByText("Muted agent")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Expired" })).getByText("Expired approval")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Completed" })).getByText("Completed approval")).toBeTruthy();
  });

  it("batches low-risk approvals and shows fatigue pressure", async () => {
    const today = new Date().toISOString();
    agentMessagesFixture = [
      { ...agentMessage, id: "batch-1", title: "Patch release", actions: JSON.stringify([{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }]), created_at: today, urgency: "normal", risk: "low" },
      { ...agentMessage, id: "batch-2", title: "Docs release", actions: JSON.stringify([{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }]), created_at: today, urgency: "low", risk: "medium" },
      { ...agentMessage, id: "urgent-1", title: "Urgent production change", actions: JSON.stringify([{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }]), created_at: today, urgency: "urgent", risk: "critical" },
      { ...agentMessage, id: "expired-fatigue", title: "Old request", status: "expired", created_at: "2026-06-20T00:00:00.000Z" },
      { ...agentMessage, id: "denied-fatigue", title: "Denied request", status: "acted", action_result: JSON.stringify({ action_id: "deny", decided_at: today }), created_at: today }
    ];
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Decisions" }));
    expect(await screen.findByRole("region", { name: "Batch approvals" })).toBeTruthy();
    expect(screen.getByText("2 low or medium risk approvals")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Human fatigue budget" })).toBeTruthy();
    expect(screen.getByText("Interruptions today")).toBeTruthy();
    expect(screen.getByText("Denied requests")).toBeTruthy();
    const batchChecks = screen.getAllByLabelText("Batch item");
    await userEvent.click(batchChecks[0]);
    await userEvent.click(screen.getByRole("button", { name: "Approve selected" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/agent-messages/batch-1/actions/approve"))).toBe(true));
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/api/agent-messages/urgent-1/actions/approve"))).toBe(false);
  });

  it("shows advisory agent reputation without granting authority", async () => {
    agentMessagesFixture = [
      { ...agentMessage, id: "rep-approve", source: "steady-agent", status: "acted", action_result: JSON.stringify({ action_id: "approve" }) },
      { ...agentMessage, id: "rep-deny", source: "noisy-agent", status: "acted", action_result: JSON.stringify({ action_id: "deny" }) },
      { ...agentMessage, id: "rep-expired", source: "noisy-agent", status: "expired" },
      { ...agentMessage, id: "rep-scope", source: "noisy-agent", last_error: "modified scope attempted" },
      { ...agentMessage, id: "rep-urgent", source: "noisy-agent", urgency: "urgent" }
    ];
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Agents" }));
    expect(await screen.findByRole("heading", { name: "Agent reputation" })).toBeTruthy();
    expect(screen.getByText("Reputation is advisory; it informs review and suggestions but never grants authority automatically.")).toBeTruthy();
    expect(screen.getAllByText("noisy-agent").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("losing trust")).toBeTruthy();
    expect(screen.getByText("1 scope flags")).toBeTruthy();
  });

  it("shows trusted signals in a separate quiet reading surface", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open signals" }));
    expect(await screen.findByRole("heading", { name: "Signals" })).toBeTruthy();
    expect(screen.getAllByText("Forge Signals").length).toBeGreaterThan(0);
    expect(screen.getByText("Build note")).toBeTruthy();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(window.desktop?.openExternal).toHaveBeenCalledWith("https://example.com/build");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Build note")).toBeNull());
    expect(window.desktop?.notifyEvent).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "signal" }));
  });

  it("adds and controls signal subscriptions without exposing them to message views", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open signals" }));
    await userEvent.click(screen.getByRole("button", { name: "Add feed" }));
    await userEvent.type(screen.getByLabelText("Feed URL"), "https://example.com/feed.xml");
    await userEvent.click(screen.getAllByRole("button", { name: "Add feed" })[1]);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/signals/subscriptions") && init?.method === "POST")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.queryByRole("heading", { name: "Ada Lovelace" })).toBeNull();
  });

  it("surfaces the Tauri mobile decision terminal flow without private database replication", async () => {
    vi.mocked(window.desktop!.attentionPolicy).mockResolvedValueOnce({ ...attentionPolicy, presence_paired_mobile: "nearby" } as import("./types").AttentionPolicy);
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open mobile terminal" }));
    expect(await screen.findByRole("heading", { name: "Mobile Terminal" })).toBeTruthy();
    expect(screen.getAllByText("Release approval").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("mobile_lock_screen")).toBeTruthy();
    expect(screen.getByText("No private DB replication")).toBeTruthy();
    expect(screen.getByText("Tauri mobile signs the decision with the paired device key.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Defer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request info" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Short reply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke device" })).toBeTruthy();
  });

  it("surfaces Android mobile-local runtime status from Settings when desktop API is unavailable", async () => {
    const invoke = vi.fn(async (command: string) => { if (command === "forgelink_agent_channels") return [agentChannel]; if (command === "forgelink_attention_policy") return attentionPolicy; if (command === "forgelink_pairing_status") return { state: "unpaired", label: "Unpaired", detail: "This Android device has not been paired with the desktop ForgeLink authority.", capabilities: [] }; if (command === "forgelink_node_link_status") return { schema_version: 1, node_id: "local-android-node", platform: "android", device_label: "Android local node", link_state: "local_only", trust_state: "local", sync_mode: "none", capability_claims: ["cockpit.local", "sync.none"], authority_node_id: null, linked_at: null, last_seen_at: null, revoked_at: null, stale_after: null, detail: "This ForgeLink node is running local-only. No desktop link or private-data sync is active." }; return {}; }) as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    window.__TAURI__ = { core: { invoke } };
    vi.mocked(fetch).mockRejectedValue(new Error("desktop offline"));

    render(<App/>);

    expect(await screen.findByText(/Android full cockpit runtime is active/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Android mobile-local runtime active" })).toBeTruthy();
    expect(screen.getByText("The Android cockpit is running from app-local runtime state while the desktop local service is unavailable.")).toBeTruthy();
    expect(screen.getByText("Attention policy available")).toBeTruthy();
    expect(screen.getByText("Agent channel metadata: 1")).toBeTruthy();
    expect(screen.getByText("No private desktop DB replication")).toBeTruthy();
    expect(screen.getByText("Pairing status: Unpaired")).toBeTruthy();
    expect(screen.getAllByText("Node link: Local only").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("This Android device has not been paired with the desktop ForgeLink authority.")).toBeTruthy();
    expect(screen.getByText("This ForgeLink node is running local-only. No desktop link or private-data sync is active.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cross-platform node capability matrix" })).toBeTruthy();
    expect(screen.getByText("Platform: android")).toBeTruthy();
    expect(screen.getByText("Sync mode: No comms sync")).toBeTruthy();
    expect(screen.getByText("Private data sync: private-data policy pending")).toBeTruthy();
    expect(screen.getByText("Lifecycle status: Local only")).toBeTruthy();
    expect(screen.getByText("Private data locked: no")).toBeTruthy();
    expect(screen.getByText("Linked operations paused: no")).toBeTruthy();
    expect(screen.getByText("Recovery: Pair or link only when operator policy allows it.")).toBeTruthy();
    expect(screen.getByText("Calls: available local")).toBeTruthy();
    expect(screen.getByText("Signals: available local")).toBeTruthy();
    expect(screen.getByText("Decisions: available local")).toBeTruthy();
    expect(screen.getByText("Comms sync: unavailable because unlinked")).toBeTruthy();
    expect(screen.getByText("Device pairing: unpaired")).toBeTruthy();
    expect(screen.getByText(/private messages and contacts remain out of this Android-local slice/)).toBeTruthy();
  });

  it("surfaces Android paired-limited status from Settings when desktop API is unavailable", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "forgelink_agent_channels") return [agentChannel];
      if (command === "forgelink_attention_policy") return attentionPolicy;
      if (command === "forgelink_get_status") return { running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored", needs_onboarding: false };
      if (command === "forgelink_backend_connection") return { baseUrl: "http://127.0.0.1:5055", apiToken: "renderer-api-token" };
      if (command === "forgelink_pairing_status") return { state: "paired_limited", label: "Paired limited", detail: "This Android device is paired for limited cockpit capabilities.", capabilities: ["push_notifications"] };
      throw new Error(`unsupported command ${command}`);
    }) as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    window.__TAURI__ = { core: { invoke } };
    vi.mocked(fetch).mockRejectedValue(new Error("desktop offline"));

    render(<App/>);

    expect(await screen.findByText(/Android full cockpit runtime is active/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Pairing status: Paired limited")).toBeTruthy();
    expect(screen.getByText("This Android device is paired for limited cockpit capabilities.")).toBeTruthy();
    expect(screen.getByText("Push notifications: requires link")).toBeTruthy();
    expect(screen.getByText("Device pairing: paired limited")).toBeTruthy();
    expect(screen.getByText("Private data sync: private-data policy pending")).toBeTruthy();
    expect(screen.getByText("Lifecycle status: Local only")).toBeTruthy();
    expect(screen.getByText("Private data locked: no")).toBeTruthy();
    expect(screen.getByText("Linked operations paused: no")).toBeTruthy();
  });


  it.each([
    ["linked", "Linked", "trusted", "metadata_only", "This ForgeLink node is linked to a desktop authority for metadata-only comms sync."],
    ["degraded", "Degraded", "limited", "private_data_disabled", "This ForgeLink node link is degraded; private-data sync remains disabled."],
    ["revoked", "Revoked", "revoked", "private_data_disabled", "This ForgeLink node link has been revoked. Linked capabilities are unavailable."],
    ["stale", "Stale", "stale", "private_data_disabled", "This ForgeLink node link is stale. Revalidation is required before linked capabilities resume."]
  ])("surfaces %s ForgeLink node-link status without private-data access", async (linkState, label, trustState, syncMode, detail) => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "forgelink_agent_channels") return [agentChannel];
      if (command === "forgelink_attention_policy") return attentionPolicy;
      if (command === "forgelink_pairing_status") return { state: "paired_limited", label: "Paired limited", detail: "This Android device is paired for limited cockpit capabilities.", capabilities: ["push_notifications"] };
      if (command === "forgelink_node_link_status") return { schema_version: 1, node_id: "android-node-1", platform: "android", device_label: "Moto One Hyper", link_state: linkState, trust_state: trustState, sync_mode: syncMode, capability_claims: ["cockpit.local", "sync.metadata"], authority_node_id: "desktop-node-1", linked_at: null, last_seen_at: null, revoked_at: null, stale_after: null, detail };
      return {};
    }) as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    window.__TAURI__ = { core: { invoke } };
    vi.mocked(fetch).mockRejectedValue(new Error("desktop offline"));

    render(<App/>);

    expect(await screen.findByText(/Android full cockpit runtime is active/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect((await screen.findAllByText(`Node link: ${label}`)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(`Lifecycle status: ${label}`)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    if (linkState === "linked") {
      expect(await screen.findByText("Comms sync: available linked")).toBeTruthy();
      expect(screen.getByText("Private data locked: no")).toBeTruthy();
      expect(screen.getByText("Linked operations paused: no")).toBeTruthy();
      expect(screen.getByText("Recovery: Continue metadata-only operation unless policy changes.")).toBeTruthy();
    }
    if (linkState === "degraded") {
      expect(screen.getByText("Private data locked: yes")).toBeTruthy();
      expect(screen.getByText("Linked operations paused: no")).toBeTruthy();
      expect(screen.getByText("Recovery: Review redacted health and revalidate before resuming linked operations.")).toBeTruthy();
    }
    if (linkState === "revoked") {
      expect(await screen.findByText("Comms sync: unavailable because revoked")).toBeTruthy();
      expect(screen.getByText("Private data locked: yes")).toBeTruthy();
      expect(screen.getByText("Linked operations paused: yes")).toBeTruthy();
      expect(screen.getByText("Recovery: Create a new operator-approved link to resume linked operations.")).toBeTruthy();
    }
    if (linkState === "stale") {
      expect(await screen.findByText("Comms sync: unavailable because stale")).toBeTruthy();
      expect(screen.getByText("Private data locked: yes")).toBeTruthy();
      expect(screen.getByText("Linked operations paused: yes")).toBeTruthy();
      expect(screen.getByText("Recovery: Revalidate the peer before linked operations resume.")).toBeTruthy();
    }
    expect(screen.getByText("Private data sync: private-data policy pending")).toBeTruthy();
  });

  it("surfaces lifecycle timestamps for stale and revoked linked-node status", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "forgelink_agent_channels") return [agentChannel];
      if (command === "forgelink_attention_policy") return attentionPolicy;
      if (command === "forgelink_pairing_status") return { state: "paired_limited", label: "Paired limited", detail: "This Android device is paired for limited cockpit capabilities.", capabilities: ["push_notifications"] };
      if (command === "forgelink_node_link_status") return {
        schema_version: 1,
        node_id: "android-node-1",
        platform: "android",
        device_label: "Moto One Hyper",
        link_state: "revoked",
        trust_state: "revoked",
        sync_mode: "private_data_disabled",
        capability_claims: ["cockpit.local", "sync.metadata"],
        authority_node_id: "desktop-node-1",
        linked_at: null,
        last_seen_at: "2026-07-10T00:01:00.000Z",
        revoked_at: "2026-07-10T00:05:00.000Z",
        stale_after: "2026-07-10T01:00:00.000Z",
        detail: "This ForgeLink node link has been revoked. Linked capabilities are unavailable."
      };
      return {};
    }) as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    window.__TAURI__ = { core: { invoke } };
    vi.mocked(fetch).mockRejectedValue(new Error("desktop offline"));

    render(<App/>);

    expect(await screen.findByText(/Android full cockpit runtime is active/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Lifecycle status: Revoked")).toBeTruthy();
    expect(screen.getByText("Private data locked: yes")).toBeTruthy();
    expect(screen.getByText("Linked operations paused: yes")).toBeTruthy();
    expect(screen.getByText("Last seen: 2026-07-10T00:01:00.000Z")).toBeTruthy();
    expect(screen.getByText("Stale after: 2026-07-10T01:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("Revoked at: 2026-07-10T00:05:00.000Z")).toBeTruthy();
  });

  it("backs up, exports, restores, and applies local retention from settings", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByText("Schema version 7. Backups and exports contain private message and contact data.");
    await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore latest backup" }));
    await userEvent.clear(screen.getByLabelText("Keep messages for days"));
    await userEvent.type(screen.getByLabelText("Keep messages for days"), "180");
    await userEvent.click(screen.getByRole("button", { name: "Apply retention" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/data/retention"))).toBe(true));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it("saves explicit attention policy controls from settings", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Attention policy" })).toBeTruthy();
    expect(screen.getByLabelText("Local presence snapshot")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Operator mode"), "focus");
    await userEvent.click(screen.getByLabelText("Quiet hours"));
    await userEvent.click(screen.getByLabelText("Manual do-not-disturb signal"));
    await userEvent.click(screen.getByLabelText("Emergency contact bypass"));
    await userEvent.selectOptions(screen.getByLabelText("Paired mobile proximity"), "nearby");
    await userEvent.selectOptions(screen.getByLabelText("Trusted signals"), "all");
    await userEvent.type(screen.getByLabelText("Muted sources or channel IDs"), "forgewire");
    await userEvent.click(screen.getByRole("button", { name: "Save attention policy" }));
    await waitFor(() => expect(window.desktop?.saveAttentionPolicy).toHaveBeenCalledWith(expect.objectContaining({
      operator_mode: "focus",
      quiet_hours_enabled: true,
      presence_do_not_disturb: true,
      presence_paired_mobile: "nearby",
      emergency_contact_bypass: false,
      signal_notifications: "all",
      muted_sources: ["forgewire"]
    })));
  });

  it("opens a modal, closes it with Escape, and restores focus", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open messages" }));
    const trigger = screen.getAllByRole("button", { name: "New message" })[0];
    trigger.focus();
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "New message" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Phone number"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("sends a new message with the expected payload", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open messages" }));
    await userEvent.click(screen.getAllByRole("button", { name: "New message" })[0]);
    await userEvent.type(screen.getByLabelText("Phone number"), "+15551234567");
    await userEvent.type(screen.getByLabelText("Message"), "Testing React");
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/send") && String(init?.body).includes('"body":"Testing React"') && String(init?.body).includes('"local_id":"local-'))).toBe(true));
  });

  it("sends from the composer with Enter and preserves Shift+Enter", async () => {
    await selectConversation();
    const composer = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(composer, "line one{shift>}{enter}{/shift}line two");
    expect((composer as HTMLTextAreaElement).value).toBe("line one\nline two");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/api/send") && String(init?.body).includes("line one\\nline two"))).toBe(true));
  });

  it("restores drafts and retries durable failed messages", async () => {
    messagesFixture = [{ ...message, id: "local-failed", direction: "outbound", body: "Try again", status: "failed", attempt_count: 1 }];
    vi.mocked(fetch).mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (new Headers(init?.headers).get("Authorization") !== "Bearer renderer-api-token") return response({ error: "Unauthorized" }, false);
      if (url.includes("/api/draft")) return response(init?.method === "POST" ? { ok: true } : { body: "Saved draft" });
      if (url.includes("/api/messages")) return response(messagesFixture);
      if (url.endsWith("/api/agent-messages")) return response([]);
      if (url.endsWith("/api/signals/subscriptions")) return response([]);
      if (url.endsWith("/api/signals/items?limit=50")) return response([]);
      if (url.endsWith("/api/threads")) return response([thread]);
      if (url.includes("/api/contacts")) return response([contact]);
      if (url.endsWith("/api/config-status")) return response({ account_sid: true, auth_token: true, phone_number: true, public_base_url: true });
      if (url.endsWith("/api/data/status")) return response({ schema_version: 4, latest_backup: null, backup_count: 0, recovered_from: null, migration_backup: null });
      if (url.endsWith("/api/retry")) { messagesFixture = [{ ...messagesFixture[0], status: "queued", attempt_count: 2 }]; return response({ ok: true }); }
      return response({});
    });
    await selectConversation();
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("Saved draft");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("queued")).toBeTruthy());
  });

  it("uploads and removes an attachment", async () => {
    await selectConversation();
    const file = new File(["image"], "photo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Attach file"), file);
    expect(await screen.findByText("Attachment ready")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(screen.queryByText("Attachment ready")).toBeNull();
  });

  it("renders media and opens non-image attachments externally", async () => {
    messagesFixture = [{ ...message, media_urls: "https://example.com/photo.png,https://example.com/report.pdf" }];
    await selectConversation();
    expect(screen.getByRole("img", { name: "Message attachment" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open attachment" }));
    expect(window.desktop?.openExternal).toHaveBeenCalledWith("https://example.com/report.pdf");
  });

  it("loads earlier messages without replacing the current page", async () => {
    messagesFixture = Array.from({ length: 200 }, (_, index) => ({ ...message, id: `SM${index}`, body: `Message ${index}`, ts: `2026-06-14T18:${String(index % 60).padStart(2, "0")}:00.000Z` }));
    olderFixture = [{ ...message, id: "SM-older", body: "Older message", ts: "2026-06-13T18:00:00.000Z" }];
    await selectConversation();
    await userEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("Older message")).toBeTruthy();
    expect(screen.getByText("Message 199")).toBeTruthy();
  });

  it("adds and links contacts from a conversation", async () => {
    await selectConversation();
    await userEvent.click(screen.getByRole("button", { name: "Link contact" }));
    await userEvent.click(screen.getByRole("button", { name: /Grace Hopper/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/link-thread"), expect.objectContaining({ method: "POST", body: JSON.stringify({ thread_id: 1, contact_id: 7 }) })));
  });

  it("saves connection settings and controls the local service", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Update connection" }));
    await userEvent.clear(screen.getByLabelText("Account SID"));
    await userEvent.type(screen.getByLabelText("Account SID"), "AC999");
    await userEvent.clear(screen.getByLabelText("Local port"));
    await userEvent.type(screen.getByLabelText("Local port"), "5056");
    await userEvent.click(screen.getByRole("button", { name: "Save and restart" }));
    await waitFor(() => expect(window.desktop?.startServer).toHaveBeenCalledWith(expect.objectContaining({ account_sid: "AC999", webhook_port: 5056 })));
    await userEvent.click(screen.getByRole("button", { name: "Stop local service" }));
    expect(window.desktop?.stopServer).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Open Twilio Console" }));
    expect(window.desktop?.openExternal).toHaveBeenCalledWith("https://console.twilio.com/");
    await userEvent.click(screen.getByRole("button", { name: "Remove stored credentials" }));
    expect(window.desktop?.removeCredentials).toHaveBeenCalled();
  });

  it("manages MCP token status without rendering the token value", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Agent apps / MCP")).toBeTruthy();
    expect(screen.getByText("install codex")).toBeTruthy();
    expect(screen.queryByText(/flmcp_/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Create token file" }));
    await waitFor(() => expect(window.desktop?.createMcpToken).toHaveBeenCalled());
    vi.mocked(window.desktop!.mcpStatus).mockResolvedValue({ ...mcpStatus, configured: true, token_file_present: true, rotated_at: "2026-06-15T22:00:00.000Z" });
    expect(screen.queryByText(/flmcp_/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Test MCP bridge" }));
    await waitFor(() => expect(window.desktop?.testMcpBridge).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(window.desktop?.revokeMcpToken).toHaveBeenCalled());
  });

  it("manages agent channel credentials without rendering secret values", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Agent channel credentials")).toBeTruthy();
    expect(screen.getByText("ForgeWire Fabric")).toBeTruthy();
    expect(screen.getByText(/Rejected 2/)).toBeTruthy();
    expect(screen.queryByText(/flchan_/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Create ForgeWire channel" }));
    await waitFor(() => expect(window.desktop?.createAgentChannel).toHaveBeenCalledWith({ channel_id: "forgewire", label: "ForgeWire Fabric" }));
    await userEvent.click(screen.getByRole("button", { name: "Rotate" }));
    await waitFor(() => expect(window.desktop?.rotateAgentChannel).toHaveBeenCalledWith("forgewire"));
    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(window.desktop?.setAgentChannelEnabled).toHaveBeenCalledWith("forgewire", false));
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(window.desktop?.revokeAgentChannel).toHaveBeenCalledWith("forgewire"));
    expect(screen.queryByText(/flchan_/)).toBeNull();
  });

  it("imports complete environment credentials explicitly", async () => {
    vi.mocked(window.desktop!.getStatus).mockResolvedValueOnce({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "environment", environment_import_available: true, needs_onboarding: false, settings: { account_sid: "ACENV", auth_token_configured: true, twilio_number: "+15550003333", public_base_url: "https://env.example.com", webhook_host: "127.0.0.1", webhook_port: 5055 } });
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import environment credentials securely" }));
    expect(window.desktop?.importEnvironment).toHaveBeenCalled();
  });

  it("reviews an agent-drafted external message, previews channel redaction, and denies it (OCX-014/015)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open reviewed outbox" }));
    await screen.findByRole("heading", { name: "Reviewed outbox" });
    // The draft is visible and clearly separated as pending review.
    expect(screen.getByText("Hi from the agent. (draft)")).toBeTruthy();
    // Channel redaction preview shows what each channel reveals before dispatch.
    await userEvent.click(screen.getByRole("button", { name: "Preview redaction across channels" }));
    expect(await screen.findByText("Mobile lock screen")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/body hidden on this channel/).length).toBeGreaterThan(0));
    // Denying the draft removes the pending send action.
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve & send" })).toBeNull());
  });

  it("shows the email channel configuration card (EMAIL-005)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Email channel" })).toBeTruthy();
    expect(screen.getByText(/not the default human-approval loop/)).toBeTruthy();
    expect(screen.getByText(/Enter SMTP credentials below/)).toBeTruthy();
  });

  it("saves email credentials through the secure store bridge (EMAIL-002)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Email channel" });
    await userEvent.type(screen.getByPlaceholderText("smtp.provider.example"), "smtp.example.com");
    await userEvent.type(screen.getByPlaceholderText("ops@your-domain"), "ops@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save email credentials" }));
    await waitFor(() => expect(window.desktop?.saveEmailSettings).toHaveBeenCalled());
  });

  it("shows the push channel card with a lock-screen-safe redaction preview (PUSH-006)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Push notifications" })).toBeTruthy();
    expect(screen.getByText(/grants no approval authority/)).toBeTruthy();
    expect(screen.getByText(/An approval is waiting in ForgeLink/)).toBeTruthy();
  });

  it("saves push credentials through the secure store bridge (PUSH-003/006)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Push notifications" });
    await userEvent.click(screen.getByRole("button", { name: "Save push credentials" }));
    await waitFor(() => expect(window.desktop?.savePushSettings).toHaveBeenCalled());
  });

  it("loads and clears the first-run sample workspace with a synthetic-data banner (OCX-018)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Load sample workspace" }));
    expect(await screen.findByText(/Sample workspace active/)).toBeTruthy();
    expect(window.desktop?.notify).toBeDefined();
    await userEvent.click(await screen.findByRole("button", { name: "Clear sample workspace" }));
    await waitFor(() => expect(screen.queryByText(/Sample workspace active/)).toBeNull());
  });

  it("renders the advisory Android/Fabric device health panel from a bridge status (030/0017)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open mobile terminal" }));
    await screen.findByRole("heading", { name: "Android / Fabric Device Health" });
    // Advisory framing is shown and no live transport exists yet.
    expect(screen.getByText(/advisory and cannot grant authority/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show sample status" }));
    expect(await screen.findByText("Status: Online")).toBeTruthy();
    expect(screen.getByText("15 / SDK 35")).toBeTruthy();
    expect(screen.getByText("QuickstepLauncher")).toBeTruthy();
    expect(screen.getByText("ranchu")).toBeTruthy();
  });

  it("fetches live operator-status through the transport endpoint (030/TAURI-009)", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open mobile terminal" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check device status" }));
    expect(await screen.findByText("Status: Online")).toBeTruthy();
    expect(screen.getByText("ranchu")).toBeTruthy();
  });
});

describe("Android operator-status parsing", () => {
  it("classifies a complete ok payload as online", () => {
    const parsed = parseOperatorStatus({ ok: true, mode: "operator-status", request_id: "r1", device: { android_release: "15", sdk: "35", model: "m", hardware: "h", fingerprint: "f" } });
    expect(parsed.health).toBe("online");
  });
  it("treats ok:false and malformed payloads as degraded without throwing", () => {
    expect(parseOperatorStatus({ ok: false, mode: "operator-status", request_id: "r2", error: "bridge offline" }).health).toBe("degraded");
    expect(parseOperatorStatus(null).health).toBe("degraded");
    expect(parseOperatorStatus({ ok: true, mode: "operator-status", request_id: "r3" }).health).toBe("degraded");
  });
});


describe("Android local comms store stub", () => {
  const localNode = {
    schema_version: 1,
    node_id: "local-android-node",
    platform: "android" as const,
    device_label: "Android local node",
    link_state: "local_only" as const,
    trust_state: "local" as const,
    sync_mode: "none" as const,
    capability_claims: ["cockpit.local", "sync.none"],
    authority_node_id: null,
    linked_at: null,
    last_seen_at: null,
    revoked_at: null,
    stale_after: null,
    detail: "Local-only metadata store."
  };

  it("builds a metadata-only Android-local store snapshot without desktop DB copying", () => {
    const snapshot = buildAndroidLocalCommsStoreSnapshot(localNode, { now: "2026-07-10T00:00:00.000Z" });

    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.platform).toBe("android");
    expect(snapshot.node_id).toBe("local-android-node");
    expect(snapshot.storage_kind).toBe("app_local_file_state");
    expect(snapshot.private_data_enabled).toBe(false);
    expect(snapshot.desktop_db_copy_enabled).toBe(false);
    expect(snapshot.link_metadata.link_state).toBe("local_only");
    expect(snapshot.capability_cache).toEqual(["cockpit.local", "sync.none"]);
    expect(snapshot.sync_checkpoints[0].data_classes).toEqual([
      "schema_version",
      "node_id",
      "link_metadata",
      "capability_cache",
      "sync_checkpoint_metadata",
      "redacted_status_rows"
    ]);
    expect(snapshot.redacted_status_rows[0].detail).toContain("Metadata-only");
  });

  it("rejects private communication data classes from the Android-local stub", () => {
    expect(androidLocalCommsStoreAllowsDataClass("link_metadata")).toBe(true);
    expect(androidLocalCommsStoreAllowsDataClass("sync_checkpoint_metadata")).toBe(true);

    for (const forbidden of ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES) {
      expect(androidLocalCommsStoreAllowsDataClass(forbidden)).toBe(false);
    }

    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("raw_messages");
    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("contacts");
    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("calls");
    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("signal_content");
    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("attachments");
    expect(ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES).toContain("secrets");
  });
});


describe("Desktop linked node status stub", () => {
  const linkedAndroidNode = {
    schema_version: 1,
    node_id: "local-android-node",
    platform: "android" as const,
    device_label: "Android local node",
    link_state: "linked" as const,
    trust_state: "limited" as const,
    sync_mode: "metadata_only" as const,
    capability_claims: ["cockpit.local", "sync.metadata"],
    authority_node_id: "desktop-authority-node",
    linked_at: "2026-07-10T00:00:00.000Z",
    last_seen_at: "2026-07-10T00:01:00.000Z",
    revoked_at: null,
    stale_after: "2026-07-10T01:00:00.000Z",
    detail: "Linked metadata-only node."
  };

  it("builds redacted desktop linked-node metadata without private change-set acceptance", () => {
    const status = buildDesktopLinkedNodeStatus([linkedAndroidNode], {
      authority_node_id: "desktop-authority-node",
      last_checked_at: "2026-07-10T00:02:00.000Z"
    });

    expect(status.schema_version).toBe(1);
    expect(status.authority_node_id).toBe("desktop-authority-node");
    expect(status.linked_nodes).toHaveLength(1);
    expect(status.linked_nodes[0].node_id).toBe("local-android-node");
    expect(status.sync_health.redacted).toBe(true);
    expect(status.sync_health.accepts_private_change_sets).toBe(false);
    expect(status.sync_health.private_data_sync_enabled).toBe(false);
    expect(status.sync_health.broad_background_sync_enabled).toBe(false);
    expect(status.sync_health.clustering_enabled).toBe(false);
    expect(status.accepted_data_classes).toEqual([
      "node_link_status",
      "capability_cache",
      "sync_checkpoint_metadata",
      "redacted_sync_health",
      "wipe_status"
    ]);
    expect(status.capability_claims).toContain("linked_nodes.list");
    expect(status.capability_claims).toContain("sync.health.redacted");
    expect(status.capability_claims).toContain("change_sets.private.reject");
  });

  it("rejects private data classes from desktop linked-node metadata", () => {
    expect(desktopLinkedNodeStatusAcceptsDataClass("node_link_status")).toBe(true);
    expect(desktopLinkedNodeStatusAcceptsDataClass("redacted_sync_health")).toBe(true);

    for (const forbidden of DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES) {
      expect(desktopLinkedNodeStatusAcceptsDataClass(forbidden)).toBe(false);
    }

    expect(DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES).toContain("raw_private_data");
    expect(DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES).toContain("credentials");
    expect(DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES).toContain("provider_secrets");
    expect(DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES).toContain("tokens");
  });

  it("exposes a shell command stub for desktop linked-node status", async () => {
    expect(SHELL_BRIDGE_CAPABILITIES.nodeLink).toContain("desktopLinkedNodeStatus");

    const status = await shell.desktopLinkedNodeStatus();

    expect(status.sync_health.redacted).toBe(true);
    expect(status.sync_health.accepts_private_change_sets).toBe(false);
    expect(status.detail).toContain("redacted sync health");
  });
});


describe("Redacted linked node lifecycle status model", () => {
  const baseNode = {
    schema_version: 1,
    node_id: "local-android-node",
    platform: "android" as const,
    device_label: "Android local node",
    link_state: "linked" as const,
    trust_state: "limited" as const,
    sync_mode: "metadata_only" as const,
    capability_claims: ["cockpit.local", "sync.metadata"],
    authority_node_id: "desktop-authority-node",
    linked_at: "2026-07-10T00:00:00.000Z",
    last_seen_at: "2026-07-10T00:01:00.000Z",
    revoked_at: null,
    stale_after: "2026-07-10T01:00:00.000Z",
    detail: "Linked metadata-only node."
  };

  it("builds linked lifecycle status without unlocking private data", () => {
    const status = buildRedactedLinkedNodeLifecycleStatus(baseNode, {
      lifecycle_state: "linked",
      link_id: "link-1",
      audit_event_id: "audit-linked-1"
    });

    expect(status.schema_version).toBe(1);
    expect(status.node_id).toBe("local-android-node");
    expect(status.platform).toBe("android");
    expect(status.device_label).toBe("Android local node");
    expect(status.link_id).toBe("link-1");
    expect(status.lifecycle_state).toBe("linked");
    expect(status.redacted_health_label).toBe("Linked");
    expect(status.private_data_locked).toBe(false);
    expect(status.linked_operations_paused).toBe(false);
    expect(status.audit_event_id).toBe("audit-linked-1");
    expect(status.redacted_health_detail).toContain("Private data remains policy-gated");
  });

  it("locks private data for degraded, stale, lost, revoked, wipe pending, and wiped states", () => {
    const unsafeStates = ["degraded", "stale", "lost", "revoked", "wipe_pending", "wiped"] as const;

    for (const lifecycle_state of unsafeStates) {
      const status = buildRedactedLinkedNodeLifecycleStatus(baseNode, { lifecycle_state });

      expect(status.lifecycle_state).toBe(lifecycle_state);
      expect(status.private_data_locked).toBe(true);
      expect(linkedNodeLifecycleLocksPrivateData(lifecycle_state)).toBe(true);
      expect(status.redacted_health_detail.length).toBeGreaterThan(10);
      expect(status.recovery_action_hint.length).toBeGreaterThan(10);
    }
  });

  it("pauses linked operations for stale, lost, revoked, wipe pending, and wiped states", () => {
    const pausedStates = ["stale", "lost", "revoked", "wipe_pending", "wiped"] as const;

    for (const lifecycle_state of pausedStates) {
      const status = buildRedactedLinkedNodeLifecycleStatus(baseNode, { lifecycle_state });
      expect(status.linked_operations_paused).toBe(true);
      expect(linkedNodeLifecyclePausesLinkedOperations(lifecycle_state)).toBe(true);
    }

    const degraded = buildRedactedLinkedNodeLifecycleStatus(baseNode, { lifecycle_state: "degraded" });
    expect(degraded.private_data_locked).toBe(true);
    expect(degraded.linked_operations_paused).toBe(false);
  });

  it("carries stale, revoked, wipe, and audit metadata without private payloads", () => {
    const revokedNode = {
      ...baseNode,
      link_state: "revoked" as const,
      trust_state: "revoked" as const,
      sync_mode: "private_data_disabled" as const,
      revoked_at: "2026-07-10T00:05:00.000Z"
    };

    const status = buildRedactedLinkedNodeLifecycleStatus(revokedNode, {
      lifecycle_state: "wipe_pending",
      link_id: "link-1",
      wipe_request_id: "wipe-request-1",
      audit_event_id: "audit-wipe-1"
    });

    expect(status.revoked_at).toBe("2026-07-10T00:05:00.000Z");
    expect(status.stale_after).toBe("2026-07-10T01:00:00.000Z");
    expect(status.wipe_request_id).toBe("wipe-request-1");
    expect(status.wipe_ack_id).toBeNull();
    expect(status.audit_event_id).toBe("audit-wipe-1");
    expect(status.private_data_locked).toBe(true);
    expect(status.redacted_health_detail).not.toContain("Hello");
    expect(status.redacted_health_detail).not.toContain("+1555");
  });
});


describe("Private data policy gate helper", () => {
  const readyRequest = (
    overrides: Partial<PrivateDataPolicyGateInput> = {}
  ): PrivateDataPolicyGateInput => ({
    source_node_id: "desktop-node-1",
    target_node_id: "android-node-1",
    link_id: "link-desktop-android-1",
    data_domain: "messages",
    sensitivity_class: "private",
    requested_sync_mode: "private_change_set",
    link_state: "linked",
    trust_state: "trusted",
    policy_present: true,
    policy_expires_at: "2026-07-11T00:00:00.000Z",
    operator_confirmation_present: true,
    encryption_ready: true,
    retention_ready: true,
    revocation_behavior_ready: true,
    wipe_behavior_ready: true,
    conflict_handling_ready: true,
    rollback_ready: true,
    audit_ready: true,
    now: "2026-07-10T00:00:00.000Z",
    ...overrides
  });

  it("denies by default when policy is missing", () => {
    expect(
      evaluatePrivateDataPolicyGate(
        readyRequest({ policy_present: false })
      )
    ).toMatchObject({
      decision: "deny",
      reason_code: "missing_policy",
      audit_event_type: "private_data_policy_gate.denied"
    });
  });

  it.each([
    ["policy_expired", { policy_expires_at: "2026-07-09T00:00:00.000Z" }],
    ["missing_operator_confirmation", { operator_confirmation_present: false }],
    ["encryption_unavailable", { encryption_ready: false }],
    ["retention_undefined", { retention_ready: false }],
    ["revocation_undefined", { revocation_behavior_ready: false }],
    ["wipe_undefined", { wipe_behavior_ready: false }],
    ["conflict_handling_undefined", { conflict_handling_ready: false }],
    ["rollback_undefined", { rollback_ready: false }],
    ["audit_undefined", { audit_ready: false }],
    ["link_stale", { link_state: "stale" }],
    ["link_revoked", { link_state: "revoked" }],
    ["link_lost", { link_state: "lost" }],
    ["link_degraded", { link_state: "degraded" }],
    ["unsupported_data_domain", { data_domain: "desktop_database" }],
    ["unsupported_sync_mode", { requested_sync_mode: "whole_database_copy" }]
  ] as const)(
    "denies the %s path",
    (reasonCode, overrides) => {
      expect(
        evaluatePrivateDataPolicyGate(
          readyRequest(overrides as Partial<PrivateDataPolicyGateInput>)
        )
      ).toMatchObject({
        decision: "deny",
        reason_code: reasonCode,
        audit_event_type: "private_data_policy_gate.denied"
      });
    }
  );

  it("does not treat pairing, a link, or metadata sync as private-data approval", () => {
    expect(
      evaluatePrivateDataPolicyGate(
        readyRequest({
          requested_sync_mode: "metadata_only",
          policy_present: true,
          operator_confirmation_present: true
        })
      )
    ).toMatchObject({
      decision: "deny",
      reason_code: "not_private_data_request"
    });

    expect(
      evaluatePrivateDataPolicyGate(
        readyRequest({
          link_state: "linked",
          trust_state: "limited"
        })
      )
    ).toMatchObject({
      decision: "deny",
      reason_code: "trust_not_approved"
    });

    expect(
      evaluatePrivateDataPolicyGate(
        readyRequest({
          link_state: "link_requested"
        })
      )
    ).toMatchObject({
      decision: "deny",
      reason_code: "link_not_active"
    });
  });

  it("allows only a fully satisfied policy evaluation without moving data", () => {
    const decision = evaluatePrivateDataPolicyGate(readyRequest());

    expect(decision).toEqual({
      decision: "allow",
      reason_code: "allowed",
      redacted_reason:
        "The request satisfies the modeled private-data policy prerequisites.",
      audit_event_type: "private_data_policy_gate.allowed"
    });

    expect(decision).not.toHaveProperty("payload");
    expect(decision).not.toHaveProperty("messages");
    expect(decision).not.toHaveProperty("contacts");
    expect(decision).not.toHaveProperty("credentials");
  });
});


describe("Signed link envelope fixture validator", () => {
  const validEnvelope = (
    overrides: Partial<SignedLinkEnvelopeFixture> = {}
  ): SignedLinkEnvelopeFixture => ({
    schema_version: 1,
    op: "change_set_offer",
    source_node_id: "desktop-node-1",
    target_node_id: "android-node-1",
    link_id: "link-desktop-android-1",
    timestamp: "2026-07-10T15:30:00.000Z",
    nonce: "nonce-fixture-001",
    required_capabilities: [
      "node.capabilities.read",
      "sync.metadata"
    ],
    data_classes: [
      "change_set_metadata",
      "audit_event"
    ],
    sync_mode: "metadata_only",
    policy_id: "policy.metadata-only.1",
    base_checkpoint_hash: "sha256:checkpoint-1",
    change_set_hash: "sha256:change-set-1",
    audit_parent_hash: "sha256:audit-parent-1",
    payload_hash: "sha256:payload-1",
    signature: {
      algorithm: "ed25519",
      key_id: "fixture-key-1",
      value: "fixture-signature-not-production-crypto"
    },
    ...overrides
  });

  const validationOptions = {
    now: "2026-07-10T15:30:30.000Z",
    max_clock_skew_ms: 60_000
  };

  it("accepts a valid metadata-only fixture envelope", () => {
    const envelope = validEnvelope();
    const result = validateSignedLinkEnvelopeFixture(
      envelope,
      validationOptions
    );

    expect(result).toEqual({
      valid: true,
      reason_code: "valid",
      redacted_reason:
        "The signed link-envelope fixture satisfies the metadata contract.",
      replay_key:
        "desktop-node-1:android-node-1:link-desktop-android-1:change_set_offer:nonce-fixture-001",
      audit_event_type: "signed_link_envelope.accepted"
    });

    expect(result).not.toHaveProperty("private_key");
    expect(result).not.toHaveProperty("payload");
  });

  it.each([
    ["unknown_operation", { op: "database_replication" }],
    ["missing_nonce", { nonce: "" }],
    ["missing_timestamp", { timestamp: "" }],
    ["missing_policy_id", { policy_id: "" }],
    ["missing_payload_hash", { payload_hash: "" }],
    ["missing_signature_metadata", { signature: null }],
    ["unsupported_sync_mode", { sync_mode: "whole_database_copy" }],
    ["invalid_hash_linkage", { audit_parent_hash: "" }]
  ] as const)(
    "rejects the %s path",
    (reasonCode, overrides) => {
      expect(
        validateSignedLinkEnvelopeFixture(
          validEnvelope(
            overrides as Partial<SignedLinkEnvelopeFixture>
          ),
          validationOptions
        )
      ).toMatchObject({
        valid: false,
        reason_code: reasonCode,
        audit_event_type: "signed_link_envelope.rejected"
      });
    }
  );

  it.each([
    "raw_private_data",
    "raw_messages",
    "contacts",
    "calls",
    "call_history",
    "attachments",
    "raw_signal_content",
    "credentials",
    "provider_secrets",
    "tokens",
    "private_keys"
  ])("rejects forbidden data class %s", dataClass => {
    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({ data_classes: [dataClass] }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "forbidden_data_class"
    });
  });

  it("rejects envelopes outside the accepted timestamp window", () => {
    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({
          timestamp: "2026-07-10T15:20:00.000Z"
        }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "timestamp_outside_window"
    });
  });

  it("rejects a repeated replay tuple", () => {
    const envelope = validEnvelope();
    const replayKey =
      buildSignedLinkEnvelopeReplayKey(envelope);

    expect(
      validateSignedLinkEnvelopeFixture(envelope, {
        ...validationOptions,
        seen_replay_keys: new Set([replayKey])
      })
    ).toMatchObject({
      valid: false,
      reason_code: "replayed_nonce",
      replay_key: replayKey
    });
  });

  it("does not confuse different nonce or operation tuples", () => {
    const first = validEnvelope();
    const seen = new Set([
      buildSignedLinkEnvelopeReplayKey(first)
    ]);

    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({ nonce: "nonce-fixture-002" }),
        {
          ...validationOptions,
          seen_replay_keys: seen
        }
      )
    ).toMatchObject({
      valid: true,
      reason_code: "valid"
    });

    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({
          op: "change_set_ack",
          nonce: "nonce-fixture-001"
        }),
        {
          ...validationOptions,
          seen_replay_keys: seen
        }
      )
    ).toMatchObject({
      valid: true,
      reason_code: "valid"
    });
  });

  it("validates fixture signature shape without production cryptography", () => {
    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({
          signature: {
            algorithm: "ed25519",
            key_id: "",
            value: "fixture-value"
          }
        }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "missing_signature_key_id"
    });

    expect(
      validateSignedLinkEnvelopeFixture(
        validEnvelope({
          signature: {
            algorithm: "ed25519",
            key_id: "fixture-key-1",
            value: ""
          }
        }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "missing_signature_value"
    });
  });
});


describe("Metadata change-set fixture validator", () => {
  const validChangeSet = (
    overrides: Partial<MetadataChangeSetFixture> = {}
  ): MetadataChangeSetFixture => ({
    schema_version: 1,
    change_set_id: "change-set-001",
    source_node_id: "desktop-node-1",
    target_node_id: "android-node-1",
    link_id: "link-desktop-android-1",
    policy_id: "policy.metadata-only.1",
    checkpoint_base_hash: "sha256:checkpoint-base-1",
    checkpoint_result_hash: "sha256:checkpoint-result-1",
    envelope_hash: "sha256:envelope-1",
    data_classes: [
      "node_link_status",
      "change_set_metadata"
    ],
    sync_mode: "metadata_only",
    created_at: "2026-07-10T16:00:00.000Z",
    expires_at: "2026-07-10T16:10:00.000Z",
    operation_count: 2,
    payload_hash: "sha256:payload-1",
    redaction_profile: "metadata_only_v1",
    audit_parent_hash: "sha256:audit-parent-1",
    operations: [
      {
        operation_id: "operation-001",
        data_class: "node_link_status",
        operation_type: "observe",
        operation_timestamp: "2026-07-10T16:01:00.000Z",
        operation_hash: "sha256:operation-001",
        redacted: true
      },
      {
        operation_id: "operation-002",
        data_class: "change_set_metadata",
        operation_type: "upsert_metadata",
        operation_timestamp: "2026-07-10T16:02:00.000Z",
        operation_hash: "sha256:operation-002",
        redacted: true
      }
    ],
    ...overrides
  });

  const validationOptions = {
    now: "2026-07-10T16:05:00.000Z",
    max_operations: 128
  };

  it("accepts a bounded metadata-only communication change set", () => {
    expect(
      validateMetadataChangeSetFixture(
        validChangeSet(),
        validationOptions
      )
    ).toEqual({
      valid: true,
      reason_code: "valid",
      redacted_reason:
        "The metadata change-set fixture satisfies the bounded communication-sync contract.",
      audit_event_type: "metadata_change_set.accepted"
    });
  });

  it.each([
    ["missing_change_set_id", { change_set_id: "" }],
    ["missing_policy_id", { policy_id: "" }],
    ["missing_checkpoint_base_hash", { checkpoint_base_hash: "" }],
    ["missing_checkpoint_result_hash", { checkpoint_result_hash: "" }],
    ["checkpoint_hash_unchanged", {
      checkpoint_result_hash: "sha256:checkpoint-base-1"
    }],
    ["missing_envelope_hash", { envelope_hash: "" }],
    ["missing_payload_hash", { payload_hash: "" }],
    ["missing_audit_parent_hash", { audit_parent_hash: "" }],
    ["missing_redaction_profile", { redaction_profile: "" }],
    ["unsupported_sync_mode", { sync_mode: "whole_database_copy" }],
    ["operation_count_mismatch", { operation_count: 1 }],
    ["change_set_expired", {
      expires_at: "2026-07-10T16:04:00.000Z"
    }]
  ] as const)(
    "rejects the %s path",
    (reasonCode, overrides) => {
      expect(
        validateMetadataChangeSetFixture(
          validChangeSet(
            overrides as Partial<MetadataChangeSetFixture>
          ),
          validationOptions
        )
      ).toMatchObject({
        valid: false,
        reason_code: reasonCode,
        audit_event_type: "metadata_change_set.rejected"
      });
    }
  );

  it.each([
    "raw_private_data",
    "raw_messages",
    "contacts",
    "calls",
    "call_history",
    "attachments",
    "raw_signal_content",
    "credentials",
    "provider_secrets",
    "tokens",
    "private_keys",
    "desktop_database",
    "database_dump"
  ])("rejects forbidden data class %s", dataClass => {
    expect(
      validateMetadataChangeSetFixture(
        validChangeSet({
          data_classes: [dataClass],
          operation_count: 0,
          operations: []
        }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "forbidden_data_class"
    });
  });

  it("rejects an operation outside declared metadata classes", () => {
    expect(
      validateMetadataChangeSetFixture(
        validChangeSet({
          operations: [
            {
              operation_id: "operation-001",
              data_class: "audit_event",
              operation_type: "observe",
              operation_timestamp:
                "2026-07-10T16:01:00.000Z",
              operation_hash: "sha256:operation-001",
              redacted: true
            },
            {
              operation_id: "operation-002",
              data_class: "change_set_metadata",
              operation_type: "upsert_metadata",
              operation_timestamp:
                "2026-07-10T16:02:00.000Z",
              operation_hash: "sha256:operation-002",
              redacted: true
            }
          ]
        }),
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "operation_data_class_mismatch"
    });
  });

  it("rejects duplicate operation identifiers", () => {
    const changeSet = validChangeSet();

    expect(
      validateMetadataChangeSetFixture(
        {
          ...changeSet,
          operations: [
            changeSet.operations[0],
            {
              ...changeSet.operations[1],
              operation_id: "operation-001"
            }
          ]
        },
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "duplicate_operation_id"
    });
  });

  it("rejects operations that are not explicitly redacted", () => {
    const changeSet = validChangeSet();

    expect(
      validateMetadataChangeSetFixture(
        {
          ...changeSet,
          operations: [
            {
              ...changeSet.operations[0],
              redacted: false as true
            },
            changeSet.operations[1]
          ]
        },
        validationOptions
      )
    ).toMatchObject({
      valid: false,
      reason_code: "operation_not_redacted"
    });
  });

  it("contains no raw communication payload or database copy", () => {
    const changeSet = validChangeSet();
    const serialized = JSON.stringify(changeSet);

    expect(serialized).not.toContain("message_body");
    expect(serialized).not.toContain("contact_number");
    expect(serialized).not.toContain("credential_value");
    expect(serialized).not.toContain("private_key_value");
    expect(serialized).not.toContain("database_dump");
  });
});
