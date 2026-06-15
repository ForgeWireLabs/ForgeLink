import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PhoneDatabase } from "./database";
import { migrateLegacyData } from "./migration";

test("copies legacy database and uploads only when new data is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-migration-"));
  const legacy = join(directory, "legacy");
  const target = join(directory, "target");
  mkdirSync(join(legacy, "uploads"), { recursive: true });
  const legacyDatabase = new DatabaseSync(join(legacy, "phone.sqlite"));
  legacyDatabase.exec(`
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, number TEXT UNIQUE, tags TEXT DEFAULT '', avatar_path TEXT, last_seen TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, canonical_number TEXT, last_msg_ts TEXT, unread_count INTEGER DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id INTEGER, direction TEXT, body TEXT, media_urls TEXT, status TEXT, ts TEXT);
    INSERT INTO contacts(id, name, number) VALUES(1, 'Legacy Contact', '+15551234567');
    INSERT INTO threads(id, contact_id, canonical_number, last_msg_ts, unread_count) VALUES(1, 1, '+15551234567', '2026-01-01T00:00:00.000Z', 1);
    INSERT INTO messages(id, thread_id, direction, body, media_urls, status, ts) VALUES('SM-LEGACY', 1, 'inbound', 'Preserved message', '', 'received', '2026-01-01T00:00:00.000Z');
  `);
  legacyDatabase.close();
  writeFileSync(join(legacy, "uploads", "photo.png"), "legacy-media");
  try {
    assert.deepEqual(migrateLegacyData(legacy, target), { databaseCopied: true, uploadsCopied: true });
    const migrated = new PhoneDatabase(join(target, "phone.sqlite3"));
    assert.equal(migrated.threads()[0].name, "Legacy Contact");
    assert.equal(migrated.messages(1)[0].body, "Preserved message");
    migrated.close();
    assert.deepEqual(migrateLegacyData(legacy, target), { databaseCopied: false, uploadsCopied: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("copies the previous Twilio Phone sqlite3 database name", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-migration-"));
  const legacy = join(directory, "legacy");
  const target = join(directory, "target");
  mkdirSync(legacy, { recursive: true });
  const legacyDatabase = new DatabaseSync(join(legacy, "phone.sqlite3"));
  legacyDatabase.exec(`
    CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, number TEXT UNIQUE, tags TEXT DEFAULT '', avatar_path TEXT, last_seen TEXT);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, canonical_number TEXT, last_msg_ts TEXT, unread_count INTEGER DEFAULT 0);
    CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id INTEGER, direction TEXT, body TEXT, media_urls TEXT, status TEXT, ts TEXT);
    INSERT INTO contacts(id, name, number) VALUES(1, 'Existing Contact', '+15551234567');
    INSERT INTO threads(id, contact_id, canonical_number, last_msg_ts, unread_count) VALUES(1, 1, '+15551234567', '2026-01-01T00:00:00.000Z', 0);
  `);
  legacyDatabase.close();
  try {
    assert.deepEqual(migrateLegacyData(legacy, target), { databaseCopied: true, uploadsCopied: false });
    const migrated = new PhoneDatabase(join(target, "phone.sqlite3"));
    assert.equal(migrated.threads()[0].name, "Existing Contact");
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
