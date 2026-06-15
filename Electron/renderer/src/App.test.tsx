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
let messagesFixture: Array<Record<string, unknown>>;
let olderFixture: Array<Record<string, unknown>>;
let agentMessagesFixture: Array<Record<string, unknown>>;

function response(payload: unknown, ok = true): Promise<Response> { return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => payload } as Response); }

beforeEach(() => {
  messagesFixture = [message];
  olderFixture = [];
  agentMessagesFixture = [agentMessage];
  window.desktop = {
    notify: vi.fn(),
    openExternal: vi.fn(),
    backendConnection: vi.fn().mockResolvedValue({ baseUrl: "http://127.0.0.1:5055", apiToken: "renderer-api-token" }),
    getStatus: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored", needs_onboarding: false, settings: { account_sid: "AC123", auth_token_configured: true, twilio_number: "+15550001111", public_base_url: "https://phone.example.com", webhook_host: "127.0.0.1", webhook_port: 5055 } }),
    validateSettings: vi.fn().mockResolvedValue({ account_name: "Test Account", account_status: "active", phone_number: "+15550002222" }),
    startServer: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5056", configured: true, credential_source: "stored", validation: { account_name: "Test Account", account_status: "active", phone_number: "+15550002222" }, settings: { account_sid: "AC999", auth_token_configured: true, twilio_number: "+15550002222", public_base_url: "https://new.example.com", webhook_host: "127.0.0.1", webhook_port: 5056 } }),
    importEnvironment: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored" }),
    removeCredentials: vi.fn().mockResolvedValue({ running: true, baseUrl: "http://127.0.0.1:5055", configured: false, credential_source: "none", needs_onboarding: true }),
    stopServer: vi.fn().mockResolvedValue({ running: false, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "stored", settings: { account_sid: "AC999", auth_token_configured: true, twilio_number: "+15550002222", public_base_url: "https://new.example.com", webhook_host: "127.0.0.1", webhook_port: 5056 } }),
    onServerStatus: vi.fn()
  };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer renderer-api-token") return response({ error: "Unauthorized" }, false);
    if (url.includes("/api/messages")) return response(url.includes("before=") ? olderFixture : messagesFixture);
    if (url.endsWith("/api/agent-messages")) return response(agentMessagesFixture);
    if (url.endsWith("/api/agent-messages/agent-1/read")) { agentMessagesFixture = [{ ...agentMessage, status: "read" }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    if (url.endsWith("/api/agent-messages/agent-1/dismiss")) { agentMessagesFixture = [{ ...agentMessage, status: "dismissed" }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    if (url.endsWith("/api/agent-messages/agent-1/actions/approve")) { agentMessagesFixture = [{ ...agentMessage, status: "acted", action_result: JSON.stringify({ action_id: "approve" }) }]; return response({ ok: true, message: agentMessagesFixture[0] }); }
    if (url.endsWith("/api/threads")) return response([thread]);
    if (url.includes("/api/contacts")) return response(init?.method === "POST" ? { ok: true } : [contact]);
    if (url.endsWith("/api/config-status")) return response({ account_sid: true, auth_token: true, phone_number: true, public_base_url: true });
    if (url.endsWith("/api/data/status")) return response({ schema_version: 4, latest_backup: "backup-test", backup_count: 1, recovered_from: null, migration_backup: null });
    if (url.endsWith("/api/data/backup")) return response({ ok: true, name: "backup-test" });
    if (url.endsWith("/api/data/export")) return response({ ok: true, name: "export-test.json" });
    if (url.endsWith("/api/data/restore-latest")) return response({ ok: true, name: "backup-test" });
    if (url.endsWith("/api/data/retention")) return response({ ok: true, deletedMessages: 2, deletedThreads: 1, deletedUploads: 1, deletedAgentMessages: 1 });
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
  await userEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
  await screen.findByRole("heading", { name: "Ada Lovelace" });
}

describe("React renderer parity", () => {
  it("authenticates every local API request with the per-launch credential", async () => {
    render(<App/>);
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
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

  it("switches views and filters contacts", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Contacts" }));
    expect(await screen.findByRole("heading", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search contacts" }), "missing");
    expect(screen.getByText("No contacts found")).toBeTruthy();
  });

  it("shows agent channel messages without mixing them into SMS conversations", async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole("button", { name: "Agents" }));
    expect(await screen.findByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByText("Release approval")).toBeTruthy();
    expect(screen.getByText("ForgeWire wants approval.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/agent-messages/agent-1/actions/approve"))).toBe(true));
    expect(await screen.findByText("Recent outcomes")).toBeTruthy();
  });

  it("backs up, exports, restores, and applies local retention from settings", async () => {
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByText("Schema version 4. Backups and exports contain private message and contact data.");
    await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore latest backup" }));
    await userEvent.clear(screen.getByLabelText("Keep messages for days"));
    await userEvent.type(screen.getByLabelText("Keep messages for days"), "180");
    await userEvent.click(screen.getByRole("button", { name: "Apply retention" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/api/data/retention"))).toBe(true));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it("opens a modal, closes it with Escape, and restores focus", async () => {
    render(<App/>);
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

  it("imports complete environment credentials explicitly", async () => {
    vi.mocked(window.desktop!.getStatus).mockResolvedValueOnce({ running: true, baseUrl: "http://127.0.0.1:5055", configured: true, credential_source: "environment", environment_import_available: true, needs_onboarding: false, settings: { account_sid: "ACENV", auth_token_configured: true, twilio_number: "+15550003333", public_base_url: "https://env.example.com", webhook_host: "127.0.0.1", webhook_port: 5055 } });
    render(<App/>);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import environment credentials securely" }));
    expect(window.desktop?.importEnvironment).toHaveBeenCalled();
  });
});
