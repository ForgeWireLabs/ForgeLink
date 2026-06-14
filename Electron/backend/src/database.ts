import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeNumber, utcNow } from "./phone";

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

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
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

export class PhoneDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(SCHEMA);
  }

  close(): void {
    this.connection.close();
  }

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
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  addMessage(message: MessageInput): void {
    const threadId = this.getOrCreateThread(message.number);
    const timestamp = message.ts || utcNow();
    const media = Array.isArray(message.media_urls) ? message.media_urls : message.media_urls ? [message.media_urls] : [];
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.prepare(`INSERT OR REPLACE INTO messages
        (id, thread_id, direction, body, media_urls, status, ts)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(
        message.id, threadId, message.direction, message.body || "", media.join(","), message.status || "", timestamp
      );
      this.connection.prepare("UPDATE threads SET last_msg_ts=?, unread_count=unread_count+? WHERE id=?")
        .run(timestamp, message.direction === "inbound" ? 1 : 0, threadId);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  threads(): ThreadRow[] {
    return this.connection.prepare(`SELECT t.id, t.canonical_number, t.last_msg_ts, t.unread_count,
      NULLIF(c.name, '') AS name FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id
      ORDER BY t.last_msg_ts DESC`).all() as unknown as ThreadRow[];
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
    this.connection.prepare(`INSERT INTO contacts(name, number, last_seen) VALUES(?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen`)
      .run((nameValue || "").trim(), number, utcNow());
    const row = this.connection.prepare("SELECT id FROM contacts WHERE number=?").get(number) as { id: number };
    return row.id;
  }

  linkThread(threadId: number, contactId: number): void {
    const result = this.connection.prepare("UPDATE threads SET contact_id=? WHERE id=?").run(contactId, threadId);
    if (result.changes !== 1) throw new Error("Thread not found.");
  }

  updateMessageStatus(messageId: string, status: string): void {
    this.connection.prepare("UPDATE messages SET status=? WHERE id=?").run(status, messageId);
  }
}
