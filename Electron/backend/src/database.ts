import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { normalizeNumber, utcNow } from "./phone";

export const CURRENT_SCHEMA_VERSION = 3;

export interface ThreadRow {
  id: number;
  canonical_number: string;
  last_msg_ts: string | null;
  unread_count: number;
  name: string | null;
}

export interface MessageInput {
  id: string;
  number: string;
  direction: "inbound" | "outbound";
  body?: string;
  media_urls?: string[] | string;
  status?: string;
  ts?: string;
}

export interface OutboundMessage {
  id: string;
  thread_id: number;
  number: string;
  body: string;
  media_urls: string;
  status: string;
  attempt_count: number;
}

export interface DatabaseState {
  schemaVersion: number;
  recoveredFrom?: string;
  migrationBackup?: string;
}

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL UNIQUE,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id),
  canonical_number TEXT NOT NULL UNIQUE,
  last_msg_ts TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  direction TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_urls TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_last_msg ON threads(last_msg_ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON messages(thread_id, ts DESC);
`;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hasUserTables(connection: DatabaseSync): boolean {
  const row = connection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
  return row.count > 0;
}

class DatabaseCorruptionError extends Error {}

function integrityCheck(connection: DatabaseSync): void {
  const rows = connection.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
  if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw new DatabaseCorruptionError("SQLite integrity check failed.");
}

export class PhoneDatabase {
  connection!: DatabaseSync;
  readonly path: string;
  readonly state: DatabaseState = { schemaVersion: 0 };

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.openWithRecovery();
    this.connection.prepare("UPDATE messages SET status='failed', last_error='The app closed before delivery was confirmed.' WHERE direction='outbound' AND status='pending'").run();
  }

  private openWithRecovery(): void {
    try {
      this.connection = new DatabaseSync(this.path, { timeout: 5000 });
      integrityCheck(this.connection);
      this.migrate();
    } catch (error) {
      try { this.connection?.close(); } catch { /* Preserve the original failure. */ }
      if (!(error instanceof DatabaseCorruptionError) && !String(error).toLowerCase().includes("malformed") && !String(error).toLowerCase().includes("not a database")) throw error;
      if (!existsSync(this.path)) throw error;
      const quarantined = `${this.path}.corrupt-${timestamp()}`;
      renameSync(this.path, quarantined);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(`${this.path}${suffix}`)) renameSync(`${this.path}${suffix}`, `${quarantined}${suffix}`);
      }
      this.state.recoveredFrom = quarantined;
      this.connection = new DatabaseSync(this.path, { timeout: 5000 });
      this.migrate();
    }
  }

  private migrate(): void {
    this.connection.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    let version = Number((this.connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than this app supports.`);
    if (version < CURRENT_SCHEMA_VERSION && hasUserTables(this.connection)) {
      this.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const migrationBackup = `${this.path}.pre-migration-v${version}-${timestamp()}`;
      copyFileSync(this.path, migrationBackup);
      this.state.migrationBackup = migrationBackup;
    }
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      if (version === 0) {
        this.connection.exec(CREATE_SCHEMA);
        version = 1;
        this.connection.exec("PRAGMA user_version=1");
      }
      if (version === 1) {
        this.connection.exec("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        this.connection.prepare("INSERT OR REPLACE INTO app_metadata(key, value) VALUES('schema_migrated_at', ?)").run(utcNow());
        version = 2;
        this.connection.exec("PRAGMA user_version=2");
      }
      if (version === 2) {
        this.connection.exec(`
          ALTER TABLE messages ADD COLUMN provider_sid TEXT;
          ALTER TABLE messages ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE messages ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_sid ON messages(provider_sid) WHERE provider_sid IS NOT NULL;
          CREATE TABLE IF NOT EXISTS drafts (
            thread_id INTEGER PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
            body TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );
        `);
        version = 3;
        this.connection.exec("PRAGMA user_version=3");
      }
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    this.state.schemaVersion = version;
  }

  async backupTo(target: string): Promise<void> {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) throw new Error("Backup target already exists.");
    await backup(this.connection, target);
    const verification = new DatabaseSync(target, { readOnly: true });
    try { integrityCheck(verification); } finally { verification.close(); }
  }

  restoreFrom(source: string): void {
    const verification = new DatabaseSync(source, { readOnly: true });
    try { integrityCheck(verification); } finally { verification.close(); }
    const rollback = `${this.path}.before-restore-${timestamp()}`;
    this.connection.close();
    copyFileSync(this.path, rollback);
    try {
      rmSync(`${this.path}-wal`, { force: true });
      rmSync(`${this.path}-shm`, { force: true });
      copyFileSync(source, this.path);
      this.connection = new DatabaseSync(this.path, { timeout: 5000 });
      integrityCheck(this.connection);
      this.migrate();
    } catch (error) {
      try { this.connection?.close(); } catch { /* Restore the known-good database below. */ }
      rmSync(`${this.path}-wal`, { force: true });
      rmSync(`${this.path}-shm`, { force: true });
      copyFileSync(rollback, this.path);
      this.connection = new DatabaseSync(this.path, { timeout: 5000 });
      this.migrate();
      throw error;
    }
  }

  exportData(): Record<string, unknown> {
    return {
      format: "forgelink-export-v1",
      exported_at: utcNow(),
      schema_version: this.state.schemaVersion,
      contacts: this.connection.prepare("SELECT * FROM contacts ORDER BY id").all(),
      threads: this.connection.prepare("SELECT * FROM threads ORDER BY id").all(),
      messages: this.connection.prepare("SELECT * FROM messages ORDER BY ts, id").all()
    };
  }

  applyRetention(days: number): { deletedMessages: number; deletedThreads: number } {
    if (!Number.isInteger(days) || days < 30 || days > 3650) throw new Error("Retention must be between 30 and 3650 days.");
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const deletedMessages = Number(this.connection.prepare("DELETE FROM messages WHERE ts < ?").run(cutoff).changes);
      const deletedThreads = Number(this.connection.prepare("DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.thread_id=threads.id)").run().changes);
      this.connection.prepare("UPDATE threads SET last_msg_ts=(SELECT MAX(ts) FROM messages WHERE messages.thread_id=threads.id)").run();
      this.connection.exec("COMMIT");
      return { deletedMessages, deletedThreads };
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  referencedLocalMedia(): Set<string> {
    const names = new Set<string>();
    const rows = this.connection.prepare("SELECT media_urls FROM messages WHERE media_urls <> ''").all() as Array<{ media_urls: string }>;
    for (const row of rows) {
      for (const value of row.media_urls.split(",")) {
        try {
          const pathname = new URL(value).pathname;
          if (pathname.startsWith("/media/")) names.add(pathname.slice("/media/".length));
        } catch { /* Ignore legacy non-URL media values. */ }
      }
    }
    return names;
  }

  close(): void { this.connection.close(); }

  getOrCreateThread(numberValue: string): number {
    const number = normalizeNumber(numberValue);
    const existing = this.connection.prepare("SELECT id FROM threads WHERE canonical_number=?").get(number) as { id: number } | undefined;
    if (existing) return existing.id;
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.prepare("INSERT OR IGNORE INTO contacts(name, number, last_seen) VALUES('', ?, ?)").run(number, utcNow());
      const contact = this.connection.prepare("SELECT id FROM contacts WHERE number=?").get(number) as { id: number };
      const result = this.connection.prepare("INSERT INTO threads(contact_id, canonical_number, last_msg_ts) VALUES(?, ?, ?)").run(contact.id, number, utcNow());
      this.connection.exec("COMMIT");
      return Number(result.lastInsertRowid);
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }

  addMessage(message: MessageInput): boolean {
    const threadId = this.getOrCreateThread(message.number);
    const timestampValue = message.ts || utcNow();
    const media = Array.isArray(message.media_urls) ? message.media_urls : message.media_urls ? [message.media_urls] : [];
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.connection.prepare("INSERT OR IGNORE INTO messages (id, thread_id, direction, body, media_urls, status, ts) VALUES(?, ?, ?, ?, ?, ?, ?)")
        .run(message.id, threadId, message.direction, message.body || "", media.join(","), message.status || "", timestampValue);
      if (result.changes === 1) this.connection.prepare("UPDATE threads SET last_msg_ts=?, unread_count=unread_count+? WHERE id=?").run(timestampValue, message.direction === "inbound" ? 1 : 0, threadId);
      this.connection.exec("COMMIT");
      return result.changes === 1;
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }

  createPendingMessage(id: string, number: string, body: string, mediaUrls: string[]): OutboundMessage {
    const threadId = this.getOrCreateThread(number);
    const ts = utcNow();
    this.connection.prepare("INSERT INTO messages(id, thread_id, direction, body, media_urls, status, ts, attempt_count) VALUES(?, ?, 'outbound', ?, ?, 'pending', ?, 1)")
      .run(id, threadId, body, mediaUrls.join(","), ts);
    this.connection.prepare("UPDATE threads SET last_msg_ts=? WHERE id=?").run(ts, threadId);
    return this.outboundMessage(id)!;
  }

  outboundMessage(id: string): OutboundMessage | undefined {
    return this.connection.prepare("SELECT m.id, m.thread_id, t.canonical_number AS number, m.body, m.media_urls, m.status, m.attempt_count FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.id=? AND m.direction='outbound'").get(id) as unknown as OutboundMessage | undefined;
  }

  beginRetry(id: string): OutboundMessage {
    const result = this.connection.prepare("UPDATE messages SET status='pending', last_error='', attempt_count=attempt_count+1 WHERE id=? AND direction='outbound' AND status IN ('failed', 'undelivered')").run(id);
    if (result.changes !== 1) throw new Error("Only failed messages can be retried.");
    return this.outboundMessage(id)!;
  }

  markMessageSent(id: string, providerSid: string, status: string): void {
    this.connection.prepare("UPDATE messages SET provider_sid=?, status=?, last_error='' WHERE id=?").run(providerSid, status || "queued", id);
  }

  markMessageFailed(id: string, error: string): void {
    this.connection.prepare("UPDATE messages SET status='failed', last_error=? WHERE id=?").run(error.slice(0, 500), id);
  }

  updateDeliveryStatus(providerSid: string, status: string): boolean {
    const rank: Record<string, number> = { pending: 0, accepted: 1, queued: 1, sending: 2, sent: 3, delivered: 4, undelivered: 4, failed: 4 };
    const current = this.connection.prepare("SELECT id, status FROM messages WHERE provider_sid=? OR id=?").get(providerSid, providerSid) as { id: string; status: string } | undefined;
    if (!current || !(status in rank) || status === current.status || (rank[status] <= (rank[current.status] ?? 0))) return false;
    this.connection.prepare("UPDATE messages SET status=? WHERE id=?").run(status, current.id);
    return true;
  }

  draft(threadId: number): string {
    return (this.connection.prepare("SELECT body FROM drafts WHERE thread_id=?").get(threadId) as { body: string } | undefined)?.body || "";
  }

  saveDraft(threadId: number, body: string): void {
    if (!this.connection.prepare("SELECT id FROM threads WHERE id=?").get(threadId)) throw new Error("Thread not found.");
    if (!body) this.connection.prepare("DELETE FROM drafts WHERE thread_id=?").run(threadId);
    else this.connection.prepare("INSERT INTO drafts(thread_id, body, updated_at) VALUES(?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at").run(threadId, body, utcNow());
  }

  threads(): ThreadRow[] {
    return this.connection.prepare("SELECT t.id, t.canonical_number, t.last_msg_ts, t.unread_count, NULLIF(c.name, '') AS name FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id ORDER BY t.last_msg_ts DESC").all() as unknown as ThreadRow[];
  }

  messages(threadId: number, before?: string): Record<string, unknown>[] {
    const rows = before
      ? this.connection.prepare("SELECT * FROM messages WHERE thread_id=? AND ts < ? ORDER BY ts DESC LIMIT 200").all(threadId, before)
      : this.connection.prepare("SELECT * FROM messages WHERE thread_id=? ORDER BY ts DESC LIMIT 200").all(threadId);
    if (!before) this.connection.prepare("UPDATE threads SET unread_count=0 WHERE id=?").run(threadId);
    return [...rows].reverse() as Record<string, unknown>[];
  }

  contacts(query = ""): Record<string, unknown>[] {
    if (!query) return this.connection.prepare("SELECT * FROM contacts ORDER BY name, number").all() as Record<string, unknown>[];
    const like = `%${query}%`;
    return this.connection.prepare("SELECT * FROM contacts WHERE name LIKE ? OR number LIKE ? ORDER BY name, number").all(like, like) as Record<string, unknown>[];
  }

  upsertContact(nameValue: string, numberValue: string): number {
    const number = normalizeNumber(numberValue);
    this.connection.prepare("INSERT INTO contacts(name, number, last_seen) VALUES(?, ?, ?) ON CONFLICT(number) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen").run((nameValue || "").trim(), number, utcNow());
    return (this.connection.prepare("SELECT id FROM contacts WHERE number=?").get(number) as { id: number }).id;
  }

  linkThread(threadId: number, contactId: number): void {
    if (this.connection.prepare("UPDATE threads SET contact_id=? WHERE id=?").run(contactId, threadId).changes !== 1) throw new Error("Thread not found.");
  }

  updateMessageStatus(messageId: string, status: string): void {
    this.updateDeliveryStatus(messageId, status);
  }
}
