// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

const thread = { id: 1, canonical_number: "+15551234567", name: "Ada Lovelace", last_msg_ts: "2026-06-14T18:00:00.000Z", unread_count: 0 };
const contact = { id: 7, name: "Grace Hopper", number: "+15557654321" };
const message = { id: "SM1", direction: "inbound", body: "Hello", ts: "2026-06-14T18:00:00.000Z", status: "received", media_urls: "" };
const agentMessage = { id: "agent-1", channel_id: "forgewire", source: "forgewire", kind: "approval_request", urgency: "normal", title: "Release approval", body: "ForgeWire wants approval.", actions: JSON.stringify([{ id: "approve", label: "Approve" }]), status: "unread", action_result: "", created_at: "2026-06-14T18:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", last_error: "" };
const signalSubscription = { id: "sigsub-1", title: "Forge Signals", url: "https://example.com/feed.xml", enabled: true, muted: false, fetch_interval_minutes: 60, retention_days: 30, last_fetch_at: "2026-06-15T12:00:00.000Z", last_fetch_status: "ok", last_error: "", created_at: "2026-06-15T10:00:00.000Z", updated_at: "2026-06-15T12:00:00.000Z" };
const signalItem = { id: "sigitem-1", subscription_id: "sigsub-1", source_title: "Forge Signals", title: "Build note", url: "https://example.com/build", summary: "Release candidate ready.", author: "ForgeWire", published_at: "2026-06-15T12:00:00.000Z", received_at: "2026-06-15T12:01:00.000Z", status: "unread", muted: false };
const callRow = { id: 1, local_call_id: "call-1", provider_kind: "voice_edge", provider_name: "twilio", provider_call_id: "CA1", direction: "outbound", from_number: "+15550001111", to_number: "+15557654321", contact_id: 7, contact_point_id: 70, status: "in_progress", started_at: "2026-06-20T21:00:00.000Z", answered_at: "2026-06-20T21:00:10.000Z", ended_at: null, duration_seconds: null, redacted_error: "", created_at: "2026-06-20T21:00:00.000Z", updated_at: "2026-06-20T21:00:10.000Z", contact_name: "Grace Hopper", contact_point_label: "primary", contact_point_value: "+15557654321" };
const mcpStatus = { configured: false, created_at: null, rotated_at: null, revoked_at: null, last_used_at: null, last_test_at: null, last_test_status: null, token_file: "C:\\Users\\test\\.forgelink\\api.token", token_file_present: false, bridge_server: "C:\\Projects\\TWL_phone\\mcp\\forgelink-human\\dist\\server.js", bridge_built: true, base_url: "http://127.0.0.1:5055", install_commands: { vscode: "install vscode", claude: "install claude", codex: "install codex", forgewire: "install forgewire" } };
const agentChannel = { channel_id: "forgewire", label: "ForgeWire Fabric", enabled: true, configured: true, created_at: "2026-06-15T22:00:00.000Z", rotated_at: "2026-06-15T22:00:00.000Z", revoked_at: null, last_used_at: null, last_rejected_at: null, rejection_count: 2, rate_limited_count: 1, token_file: "C:\\Users\\test\\.forgelink\\channels\\forgewire.token", token_file_present: true };
const attentionPolicy = { enabled: true, quiet_hours_enabled: false, quiet_hours_start: "22:00", quiet_hours_end: "07:00", quiet_hours_allow_urgent: false, redact_notification_bodies: true, sms_notifications: "all", agent_notifications: "high_and_urgent", signal_notifications: "off", system_notifications: "all", muted_sources: [] };
let messagesFixture: Array<Record<string, unknown>>;
let olderFixture: Array<Record<string, unknown>>;
let agentMessagesFixture: Array<Record<string, unknown>>;
let callsFixture: Array<Record<string, unknown>>;
let signalSubscriptionsFixture: Array<Record<string, unknown>>;
let signalItemsFixture: Array<Record<string, unknown>>;
let contactPointsFixture: Array<Record<string, unknown>>;
let contactPolicyFixture: Record<string, unknown>;
let contactTimelineFixture: Array<Record<string, unknown>>;

function response(payload: unknown, ok = true): Promise<Response> { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload } as Response); }

beforeEach(() => {
  messagesFixture = [message];
  olderFixture = [];
  agentMessagesFixture = [agentMessage];
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
    if (url.endsWith("/api/signals/subscriptions")) return response(init?.method === "POST" ? { ok: true, subscription: signalSubscription } : signalSubscriptionsFixture);
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/refresh")) return response({ ok: true, added: 1, deleted: 0, subscription: signalSubscription, items: signalItemsFixture });
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/disable")) { signalSubscriptionsFixture = [{ ...signalSubscription, enabled: false }]; return response({ ok: true, subscription: signalSubscriptionsFixture[0] }); }
    if (url.endsWith("/api/signals/subscriptions/sigsub-1/mute")) { signalSubscriptionsFixture = [{ ...signalSubscription, muted: true }]; return response({ ok: true, subscription: signalSubscriptionsFixture[0] }); }
    if (url.endsWith("/api/signals/items?limit=50")) return response(signalItemsFixture);
    if (url.endsWith("/api/signals/items/sigitem-1/archive")) { signalItemsFixture = []; return response({ ok: true, item: { ...signalItem, status: "archived" } }); }
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
    if (url.includes("/api/contacts")) return response(init?.method === "POST" ? { ok: true } : [contact]);
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function selectConversation() {
  render(<App/>);
  await userEvent.click(await screen.findByRole("button", { name: "Channels" }));
  await userEvent.click(await screen.findByRole("button", { name: "Open messages" }));
  await userEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
  await screen.findByRole("heading", { name: "Ada Lovelace" });
}

describe("React renderer parity", () => {
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
    expect(await screen.findByText("Recent outcomes")).toBeTruthy();
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
    await userEvent.click(screen.getByLabelText("Quiet hours"));
    await userEvent.selectOptions(screen.getByLabelText("Trusted signals"), "all");
    await userEvent.type(screen.getByLabelText("Muted sources or channel IDs"), "forgewire");
    await userEvent.click(screen.getByRole("button", { name: "Save attention policy" }));
    await waitFor(() => expect(window.desktop?.saveAttentionPolicy).toHaveBeenCalledWith(expect.objectContaining({
      quiet_hours_enabled: true,
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
});
