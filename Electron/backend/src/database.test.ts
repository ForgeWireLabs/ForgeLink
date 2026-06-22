import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, PhoneDatabase } from "./database";
import { normalizeNumber } from "./phone";

test("normalizes US phone numbers", () => {
  assert.equal(normalizeNumber("(555) 123-4567"), "+15551234567");
  assert.throws(() => normalizeNumber("123"));
});

test("stores messages, unread state, and linked contacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-ts-"));
  const database = new PhoneDatabase(join(directory, "test.sqlite3"));
  try {
    database.addMessage({ id: "SM1", number: "+15551234567", direction: "inbound", body: "hello", status: "received" });
    const thread = database.threads()[0];
    assert.equal(thread.unread_count, 1);
    assert.equal(database.messages(thread.id)[0].body, "hello");
    assert.equal(database.threads()[0].unread_count, 0);
    const contactId = database.upsertContact("Ada", "+15551234567");
    database.linkThread(thread.id, contactId);
    assert.equal(database.threads()[0].name, "Ada");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps inbound messages idempotent and persists drafts and outbound attempts", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-reliability-"));
  const path = join(directory, "phone.sqlite3");
  let database = new PhoneDatabase(path);
  try {
    assert.equal(database.addMessage({ id: "SM-IN", number: "+15551234567", direction: "inbound", body: "hello" }), true);
    assert.equal(database.addMessage({ id: "SM-IN", number: "+15551234567", direction: "inbound", body: "hello" }), false);
    const thread = database.threads()[0];
    assert.equal(thread.unread_count, 1);
    database.saveDraft(thread.id, "restart-safe draft");
    database.createPendingMessage("local-1", thread.canonical_number, "outbound", []);
    database.markMessageFailed("local-1", "network timeout");
    assert.equal(database.beginRetry("local-1").attempt_count, 2);
    database.markMessageSent("local-1", "SM-OUT", "queued");
    assert.equal(database.updateDeliveryStatus("SM-OUT", "delivered"), true);
    assert.equal(database.updateDeliveryStatus("SM-OUT", "sent"), false);
    database.createPendingMessage("local-interrupted", thread.canonical_number, "interrupted", []);
    database.close();
    database = new PhoneDatabase(path);
    assert.equal(database.draft(thread.id), "restart-safe draft");
    const outbound = database.messages(thread.id).find((item) => item.id === "local-1")!;
    assert.equal(outbound.status, "delivered");
    assert.equal(outbound.attempt_count, 2);
    assert.equal(database.messages(thread.id).find((item) => item.id === "local-interrupted")?.status, "failed");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("upgrades a version-one database with a pre-migration backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-upgrade-"));
  const path = join(directory, "phone.sqlite3");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', number TEXT NOT NULL UNIQUE, last_seen TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER REFERENCES contacts(id), canonical_number TEXT NOT NULL UNIQUE, last_msg_ts TEXT, unread_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id), direction TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', media_urls TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', ts TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  legacy.close();
  let database: PhoneDatabase | undefined;
  try {
    database = new PhoneDatabase(path);
    assert.equal(database.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(database.state.migrationBackup);
    assert.equal(existsSync(database.state.migrationBackup!), true);
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_metadata'").get() as { name: string }).name, "app_metadata");
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Schema-migration coordination (work item 015, CLV-022; decision 0011): every
// migration must upgrade cleanly from a previously shipped schema, and an already
// partly-migrated database must only run the steps above its version. v7 is the
// pre-015 baseline (messaging core with delivery-reliability columns) before the
// 015 band (v8-v10) added contact metadata, contact points/policy, and calls.
test("upgrades a version-seven (pre-015) database to the current schema without data loss", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-v7-upgrade-"));
  const path = join(directory, "phone.sqlite3");
  const legacy = new DatabaseSync(path);
  // Mirror the shipped v7 messaging core: base contacts/threads plus the v3
  // delivery-reliability columns on messages and the drafts table that startup
  // recovery relies on. Unrelated v4-v7 tables (agent messaging, signals) are not
  // touched by the 015 migrations or startup, so they are omitted from the fixture.
  legacy.exec(`
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', number TEXT NOT NULL UNIQUE, last_seen TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER REFERENCES contacts(id), canonical_number TEXT NOT NULL UNIQUE, last_msg_ts TEXT, unread_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id), direction TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', media_urls TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', ts TEXT NOT NULL, provider_sid TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX idx_messages_provider_sid ON messages(provider_sid) WHERE provider_sid IS NOT NULL;
    CREATE TABLE drafts (thread_id INTEGER PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    INSERT INTO contacts(id, name, number) VALUES(1, 'Pre-015 Contact', '+15551234567');
    INSERT INTO threads(id, contact_id, canonical_number, last_msg_ts, unread_count) VALUES(1, 1, '+15551234567', '2026-02-01T00:00:00.000Z', 0);
    INSERT INTO messages(id, thread_id, direction, body, media_urls, status, ts) VALUES('SM-V7', 1, 'inbound', 'Survives the 015 migrations', '', 'received', '2026-02-01T00:00:00.000Z');
    PRAGMA user_version=7;
  `);
  legacy.close();
  let database: PhoneDatabase | undefined;
  try {
    database = new PhoneDatabase(path);
    assert.equal(database.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(database.state.migrationBackup && existsSync(database.state.migrationBackup), "pre-migration backup must exist");
    // Existing contact/message data is preserved across the v8-v10 migrations.
    assert.equal(database.threads()[0].name, "Pre-015 Contact");
    assert.equal(database.messages(1)[0].body, "Survives the 015 migrations");
    // v8 backfills a primary phone contact point; v10 introduces the calls table.
    assert.ok((database.connection.prepare("SELECT COUNT(*) AS n FROM contact_points WHERE contact_id=1").get() as { n: number }).n >= 1, "v8 must backfill a contact point");
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calls'").get() as { name: string } | undefined)?.name, "calls");
    // v11 (016 AGH-001) seeds the primary operator Human Card on upgrade too.
    assert.equal(database.humanCardByAlias("operator:primary")?.role, "operator");
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Human Cards (work item 016, AGH-001): resolvable local operator authority.
test("seeds, resolves, and manages Human Cards (AGH-001)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-human-cards-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // Fresh install ships a primary operator card.
    assert.equal(database.humanCards().length, 1);
    assert.equal(database.humanCardByAlias("operator:primary")?.display_name, "Primary Operator");

    // Well-known operator:* aliases fall back to the primary operator until defined.
    const fallback = database.resolveHumanCard("operator:emergency_only");
    assert.equal(fallback?.resolved_via, "operator:primary");
    assert.ok(fallback?.authority_scopes.includes("emergency"));
    // Non-operator aliases do not silently fall back.
    assert.equal(database.resolveHumanCard("agent:rogue"), undefined);

    // Define a dedicated release-approval operator and resolve it exactly.
    database.upsertHumanCard({ alias: "operator:release_approval", display_name: "Release Approver", role: "operator", authority_scopes: ["release_approval"], preferred_channels: ["local"], notes: "private note" });
    assert.equal(database.humanCards().length, 2);
    const release = database.resolveHumanCard("operator:release_approval");
    assert.equal(release?.resolved_via, "operator:release_approval");
    assert.deepEqual(release?.authority_scopes, ["release_approval"]);
    // Redacted resolution does not expose operator-private notes.
    assert.equal((release as unknown as Record<string, unknown>).notes, undefined);

    // Upsert is idempotent on alias (updates, not duplicates).
    database.upsertHumanCard({ alias: "operator:release_approval", display_name: "Release Approver 2", role: "operator" });
    assert.equal(database.humanCards().length, 2);
    assert.equal(database.humanCardByAlias("operator:release_approval")?.display_name, "Release Approver 2");

    // Malformed aliases are rejected; the primary card cannot be deleted.
    assert.throws(() => database.upsertHumanCard({ alias: "not an alias" }), /alias/);
    assert.throws(() => database.deleteHumanCard("operator:primary"), /primary operator/);
    assert.equal(database.deleteHumanCard("operator:release_approval"), true);
    assert.equal(database.humanCards().length, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("creates verified backups, restores data, exports JSON, and applies retention", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-lifecycle-"));
  const path = join(directory, "phone.sqlite3");
  const backupPath = join(directory, "backup.sqlite3");
  const database = new PhoneDatabase(path);
  try {
    database.addMessage({ id: "OLD", number: "+15551234567", direction: "inbound", body: "old", ts: "2020-01-01T00:00:00.000Z" });
    database.addMessage({ id: "NEW", number: "+15557654321", direction: "inbound", body: "new", ts: new Date().toISOString() });
    await database.backupTo(backupPath);
    database.addMessage({ id: "AFTER", number: "+15550001111", direction: "outbound", body: "after backup" });
    database.restoreFrom(backupPath);
    const exported = database.exportData() as { format: string; schema_version: number; messages: Array<{ id: string }> };
    assert.equal(exported.format, "forgelink-export-v1");
    assert.equal(exported.schema_version, CURRENT_SCHEMA_VERSION);
    assert.equal(exported.messages.some((message) => message.id === "AFTER"), false);
    assert.deepEqual(database.applyRetention(365), { deletedMessages: 1, deletedThreads: 1, deletedAgentMessages: 0, deletedSignalItems: 0, deletedCalls: 0 });
    assert.equal((database.exportData().messages as Array<unknown>).length, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stores agent channel messages separately with export, actions, expiry, and retention", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-agent-channel-"));
  const path = join(directory, "phone.sqlite3");
  const database = new PhoneDatabase(path);
  try {
    database.addMessage({ id: "SMS", number: "+15551234567", direction: "inbound", body: "person" });
    const stored = database.addAgentMessage({
      id: "agent-1",
      channel_id: "forgewire",
      source: "forgewire",
      kind: "approval_request",
      urgency: "normal",
      title: "Release approval",
      body: "ForgeWire wants approval.",
      actions: [{ id: "approve", label: "Approve" }],
      created_at: "2020-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z"
    });
    assert.equal(stored.status, "unread");
    assert.equal(database.agentMessages()[0].channel_id, "forgewire");
    assert.equal(database.updateAgentMessageStatus("agent-1", "acted", "approve").status, "acted");
    const exported = database.exportData() as { messages: Array<unknown>; agent_messages: Array<{ id: string }> };
    assert.equal(exported.messages.length, 1);
    assert.deepEqual(exported.agent_messages.map((message) => message.id), ["agent-1"]);
    database.addAgentMessage({ id: "expired", channel_id: "forgewire", source: "forgewire", kind: "alert", urgency: "high", title: "Old alert", body: "Expired", expires_at: "2020-01-01T00:00:00.000Z" });
    assert.equal(database.agentMessage("expired")?.status, "expired");
    assert.equal(database.applyRetention(365).deletedAgentMessages, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stores trusted signals separately with duplicate handling, export, archive, and retention", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-signals-"));
  const path = join(directory, "phone.sqlite3");
  const database = new PhoneDatabase(path);
  try {
    database.addMessage({ id: "SMS", number: "+15551234567", direction: "inbound", body: "person" });
    const subscription = database.upsertSignalSubscription({ title: "Tech", url: "https://example.com/feed.xml", fetch_interval_minutes: 30, retention_days: 7 });
    assert.equal(subscription.enabled, true);
    assert.equal(database.addSignalItem({ subscription_id: subscription.id, external_id: "item-1", title: "Signal", url: "https://example.com/item", summary: "<b>text</b>", published_at: "2026-06-15T00:00:00.000Z" }), true);
    assert.equal(database.addSignalItem({ subscription_id: subscription.id, external_id: "item-1", title: "Signal duplicate", url: "https://example.com/item" }), false);
    assert.equal(database.signalItems().length, 1);
    const exported = database.exportData() as { messages: Array<unknown>; signal_subscriptions: Array<{ id: string }>; signal_items: Array<{ title: string }> };
    assert.equal(exported.messages.length, 1);
    assert.equal(exported.signal_subscriptions[0].id, subscription.id);
    assert.equal(exported.signal_items[0].title, "Signal");
    assert.equal(database.archiveSignalItem(database.signalItems()[0].id).status, "archived");
    assert.equal(database.signalItems().length, 0);
    database.addSignalItem({ subscription_id: subscription.id, external_id: "old", title: "Old", url: "https://example.com/old" });
    database.connection.prepare("UPDATE signal_items SET received_at='2020-01-01T00:00:00.000Z' WHERE external_id='old'").run();
    assert.equal(database.applySignalRetention(subscription.id), 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stores only MCP token hashes and redacted metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-mcp-token-"));
  const path = join(directory, "phone.sqlite3");
  const database = new PhoneDatabase(path);
  try {
    const hash = "a".repeat(64);
    const status = database.setMcpTokenHash(hash);
    assert.equal(status.configured, true);
    assert.equal(database.mcpTokenRecord()?.token_hash, hash);
    database.markMcpTokenUsed();
    database.markMcpTest("passed");
    const exported = database.exportData() as { mcp_tokens: Array<Record<string, unknown>> };
    assert.equal(exported.mcp_tokens.length, 1);
    assert.equal("token_hash" in exported.mcp_tokens[0], false);
    assert.equal(database.revokeMcpToken().configured, false);
    assert.ok(database.mcpTokenStatus().revoked_at);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stores agent channel credentials as redacted metadata with audit counters", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-agent-channel-credentials-"));
  const path = join(directory, "phone.sqlite3");
  const database = new PhoneDatabase(path);
  try {
    const hash = "b".repeat(64);
    const channel = database.setAgentChannelCredential("forgewire", "ForgeWire Fabric", hash);
    assert.equal(channel.configured, true);
    assert.equal(database.agentChannelRecord("forgewire")?.credential_hash, hash);
    database.markAgentChannelUsed("forgewire", "normal");
    database.markAgentChannelRejected("forgewire", "urgent", "rate_limited");
    const exported = database.exportData() as { agent_channels: Array<Record<string, unknown>> };
    assert.equal(exported.agent_channels.length, 1);
    assert.equal("credential_hash" in exported.agent_channels[0], false);
    assert.equal(database.agentChannels()[0].rate_limited_count, 1);
    assert.equal(database.revokeAgentChannel("forgewire").configured, false);
    assert.ok(database.agentChannelRecord("forgewire")?.revoked_at);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("quarantines a corrupt database and starts a recoverable empty store", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-corrupt-"));
  const path = join(directory, "phone.sqlite3");
  writeFileSync(path, "not a sqlite database");
  try {
    const database = new PhoneDatabase(path);
    assert.equal(database.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(database.state.recoveredFrom);
    assert.equal(existsSync(database.state.recoveredFrom!), true);
    assert.equal(readdirSync(directory).some((name) => name.includes(".corrupt-")), true);
    database.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("stores contact metadata, points, and policy (CLV-009/010/011)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-contacts-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const id = database.upsertContact("Grace", "+15551230000");
    database.updateContact(id, { company: "Navy", role: "Rear Admiral", tags: "vip,mentor", notes: "COBOL", pinned: true, favorite: true });
    const contact = database.contacts().find((c) => c.id === id) as Record<string, unknown>;
    assert.equal(contact.company, "Navy");
    assert.equal(contact.pinned, 1);
    assert.equal(contact.favorite, 1);
    // upsert created a primary phone point
    assert.ok(database.contactPoints(id).some((p) => p.value === "+15551230000" && p.is_primary === 1));
    // multiple labeled numbers + email; new primary
    database.addContactPoint(id, "phone", "+15559990000", "work", true);
    database.addContactPoint(id, "email", "grace@example.com", "work");
    assert.equal(database.resolveContactIdByValue("+15559990000"), id);
    assert.equal(database.resolveContactIdByValue("+19999999999"), null);
    assert.equal((database.contactPoints(id).find((p) => p.is_primary === 1) as Record<string, unknown>).value, "+15559990000");
    // policy: trusted; unknown contacts default to no approval/urgent privileges
    const policy = database.setContactPolicy(id, { trust_level: "trusted", allow_approval_requests: true });
    assert.equal(policy.trust_level, "trusted");
    assert.equal(policy.allow_approval_requests, 1);
    const unknown = database.getContactPolicy(99999);
    assert.equal(unknown.allow_approval_requests, 0);
    assert.equal(unknown.allow_urgent_interrupts, 0);
    // delete removes the contact and its points/policy
    database.deleteContact(id);
    assert.equal(database.contacts().some((c) => c.id === id), false);
    assert.equal(database.contactPoints(id).length, 0);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stores durable call rows and applies idempotent voice status callbacks (CLV-013)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-calls-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const contactId = database.upsertContact("Ada", "+15551234567");
    const call = database.createCall({
      localCallId: "call-local-1",
      providerKind: "voice_edge",
      providerName: "twilio",
      direction: "outbound",
      from: "+15550000000",
      to: "+15551234567",
      status: "queued"
    });
    assert.equal(call.contact_id, contactId);
    assert.equal(call.contact_point_id, database.contactPoints(contactId)[0].id);
    assert.equal(call.contact_name, "Ada");
    assert.equal(call.contact_point_label, "primary");

    const started = database.markCallStarted("call-local-1", "CA123", "ringing");
    assert.equal(started.provider_call_id, "CA123");
    assert.equal(started.status, "ringing");
    assert.equal(database.applyCallStatus({ providerCallId: "CA123", status: "queued" }), false);
    assert.equal(database.applyCallStatus({ providerCallId: "CA123", status: "in_progress", answeredAt: "2026-06-20T21:00:00.000Z" }), true);
    assert.equal(database.applyCallStatus({ providerCallId: "CA123", status: "completed", endedAt: "2026-06-20T21:01:00.000Z", durationSeconds: 60 }), true);
    assert.equal(database.applyCallStatus({ providerCallId: "CA123", status: "failed", redactedError: "late failure" }), false);

    const completed = database.callByProviderCallId("CA123")!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.duration_seconds, 60);
    assert.equal(completed.redacted_error, "");
    const exported = database.exportData() as { calls: Array<{ local_call_id: string }> };
    assert.deepEqual(exported.calls.map((row) => row.local_call_id), ["call-local-1"]);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("keeps call history exportable and applies retention to old ended calls (CLV-016)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-call-history-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const contactId = database.upsertContact("Grace", "+15557654321");
    database.createCall({
      localCallId: "call-old",
      providerKind: "voice_edge",
      providerName: "twilio",
      providerCallId: "CA-OLD",
      direction: "outbound",
      from: "+15550000000",
      to: "+15557654321",
      contactId,
      status: "completed",
      startedAt: "2024-01-01T00:00:00.000Z",
      endedAt: "2024-01-01T00:02:00.000Z",
      durationSeconds: 120
    });
    database.createCall({
      localCallId: "call-new",
      providerKind: "voice_edge",
      providerName: "twilio",
      providerCallId: "CA-NEW",
      direction: "inbound",
      from: "+15557654321",
      to: "+15550000000",
      status: "failed",
      redactedError: "Provider rejected request: [redacted]"
    });

    const history = database.calls();
    assert.equal(history[0].local_call_id, "call-new");
    assert.equal(history.find(call => call.local_call_id === "call-old")?.contact_name, "Grace");
    assert.equal(history.find(call => call.local_call_id === "call-old")?.duration_seconds, 120);

    const exported = database.exportData() as { calls: Array<{ local_call_id: string; provider_call_id: string; redacted_error: string }> };
    assert.deepEqual(exported.calls.map(call => call.local_call_id), ["call-old", "call-new"]);
    assert.ok(exported.calls.every(call => !JSON.stringify(call).includes("voice-token")));

    const result = database.applyRetention(365);
    assert.equal(result.deletedCalls, 1);
    assert.deepEqual(database.calls().map(call => call.local_call_id), ["call-new"]);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("resolves inbound threads through contact points and handles unknown numbers (CLV-010)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-contact-points-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    assert.equal(database.addMessage({ id: "UNKNOWN", number: "+15550001111", direction: "inbound", body: "who is this" }), true);
    let unknownThread = database.threads().find((thread) => thread.canonical_number === "+15550001111")!;
    assert.equal(unknownThread.name, null);
    assert.equal(database.contacts().length, 0);
    database.ignoreThread(unknownThread.id);
    unknownThread = database.threads().find((thread) => thread.canonical_number === "+15550001111")!;
    assert.equal(unknownThread.unread_count, 0);

    const adaId = database.upsertContact("Ada", "+15551230000");
    database.addContactPoint(adaId, "phone", "+15559990000", "work", false);
    assert.equal(database.addMessage({ id: "WORK", number: "+15559990000", direction: "inbound", body: "from work" }), true);
    const workThread = database.threads().find((thread) => thread.canonical_number === "+15559990000")!;
    assert.equal(workThread.name, "Ada");

    const graceId = database.upsertContact("Grace", "+15557654321");
    database.linkThread(unknownThread.id, graceId);
    assert.ok(database.contactPoints(graceId).some((point) => point.value === "+15550001111" && point.label === "attached"));
    assert.equal(database.threads().find((thread) => thread.id === unknownThread.id)!.name, "Grace");

    database.addMessage({ id: "BLOCK", number: "+15554443333", direction: "inbound", body: "stop" });
    const blockedThread = database.threads().find((thread) => thread.canonical_number === "+15554443333")!;
    const blockedContactId = database.blockThread(blockedThread.id);
    assert.equal(database.getContactPolicy(blockedContactId).blocked, 1);
    assert.ok(database.contactPoints(blockedContactId).some((point) => point.value === "+15554443333" && point.blocked_at));

    database.addMessage({ id: "NEWCONTACT", number: "+15556667777", direction: "inbound", body: "hi" });
    const newThread = database.threads().find((thread) => thread.canonical_number === "+15556667777")!;
    const newContactId = database.createContactFromThread(newThread.id, "Katherine");
    assert.equal(database.threads().find((thread) => thread.id === newThread.id)!.name, "Katherine");
    assert.ok(database.contactPoints(newContactId).some((point) => point.value === "+15556667777" && point.is_primary === 1));
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("enforces contact policy for inbound attention and agent privileges (CLV-011)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-contact-policy-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const contactId = database.upsertContact("Operator", "+15551230000");
    database.addContactPoint(contactId, "handle", "fabric", "agent", false);
    assert.equal(database.agentContactPolicyDecision("fabric", "approval_request", "normal").allowed, false);
    assert.equal(database.agentContactPolicyDecision("fabric", "alert", "urgent").reason, "urgent_interrupts_disallowed");
    let policy = database.setContactPolicy(contactId, { trust_level: "operator", allow_agent_messages: true, allow_approval_requests: true, allow_urgent_interrupts: true, quiet_hours_override: true });
    assert.equal(policy.quiet_hours_override, 1);
    assert.equal(database.agentContactPolicyDecision("fabric", "approval_request", "urgent").allowed, true);

    policy = database.setContactPolicy(contactId, { trust_level: "operator", allow_agent_messages: true, allow_approval_requests: true, allow_urgent_interrupts: true, muted_until: "2099-01-01T00:00:00.000Z" });
    assert.equal(database.addMessage({ id: "MUTED", number: "+15551230000", direction: "inbound", body: "quiet" }), true);
    assert.equal(database.threads().find((thread) => thread.canonical_number === "+15551230000")!.unread_count, 0);
    assert.equal(database.agentContactPolicyDecision("fabric", "alert", "normal").reason, "contact_muted");

    database.setContactPolicy(contactId, { trust_level: "blocked", allow_agent_messages: false, blocked: true });
    assert.equal(database.addMessage({ id: "BLOCKED", number: "+15551230000", direction: "inbound", body: "blocked" }), true);
    assert.equal(database.threads().find((thread) => thread.canonical_number === "+15551230000")!.unread_count, 0);
    assert.equal(database.agentContactPolicyDecision("fabric", "alert", "normal").reason, "contact_blocked");

    assert.equal(database.agentContactPolicyDecision("unknown-source", "approval_request", "urgent").allowed, true);
    const unknown = database.getContactPolicy(99999);
    assert.equal(unknown.allow_approval_requests, 0);
    assert.equal(unknown.allow_urgent_interrupts, 0);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("builds contact timeline while redacting private agent details by default (CLV-017)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-contact-timeline-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const contactId = database.upsertContact("Operator", "+15551230000");
    database.addContactPoint(contactId, "handle", "fabric", "agent", false);
    database.addMessage({ id: "MSG-TL", number: "+15551230000", direction: "inbound", body: "ordinary text", ts: "2026-06-20T20:00:00.000Z" });
    database.createCall({ localCallId: "call-tl", providerKind: "voice_edge", providerName: "twilio", providerCallId: "CA-TL", direction: "outbound", from: "+15550000000", to: "+15551230000", contactId, status: "completed", startedAt: "2026-06-20T20:05:00.000Z", endedAt: "2026-06-20T20:06:00.000Z", durationSeconds: 60 });
    database.addAgentMessage({ id: "agent-tl", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "urgent", title: "Deploy approval", body: "Private approval body", actions: [{ id: "approve", label: "Approve" }], created_at: "2026-06-20T20:10:00.000Z" });

    const redacted = database.contactTimeline(contactId);
    assert.deepEqual(redacted.map(item => item.kind), ["agent", "call", "message"]);
    assert.equal(redacted.find(item => item.kind === "message")?.detail, "ordinary text");
    assert.match(redacted.find(item => item.kind === "call")?.detail || "", /CA-TL/);
    const agent = redacted.find(item => item.kind === "agent")!;
    assert.equal(agent.private, true);
    assert.equal(agent.redacted, true);
    assert.equal(agent.detail.includes("Private approval body"), false);

    const revealed = database.contactTimeline(contactId, true);
    const revealedAgent = revealed.find(item => item.kind === "agent")!;
    assert.equal(revealedAgent.redacted, false);
    assert.match(revealedAgent.detail, /Private approval body/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
