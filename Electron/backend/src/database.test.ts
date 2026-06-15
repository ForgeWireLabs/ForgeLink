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
    assert.deepEqual(database.applyRetention(365), { deletedMessages: 1, deletedThreads: 1 });
    assert.equal((database.exportData().messages as Array<unknown>).length, 1);
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
