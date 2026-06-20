import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { normalizeNumber, utcNow } from "./phone";

export const CURRENT_SCHEMA_VERSION = 8;

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

export type AgentUrgency = "low" | "normal" | "high" | "urgent";
export type AgentMessageStatus = "unread" | "read" | "dismissed" | "acted" | "expired";

export interface AgentAction {
  id: string;
  label: string;
}

export interface AgentMessageInput {
  id: string;
  channel_id: string;
  source: string;
  kind: string;
  urgency: AgentUrgency;
  title: string;
  body: string;
  actions?: AgentAction[];
  expires_at?: string | null;
  created_at?: string;
}

export interface AgentMessageRow {
  id: string;
  channel_id: string;
  source: string;
  kind: string;
  urgency: AgentUrgency;
  title: string;
  body: string;
  actions: string;
  status: AgentMessageStatus;
  action_result: string;
  last_error: string;
  created_at: string;
  expires_at?: string | null;
}

export interface McpTokenStatus {
  configured: boolean;
  created_at: string | null;
  rotated_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  last_test_at: string | null;
  last_test_status: string | null;
}

export interface McpTokenRecord extends McpTokenStatus {
  token_hash: string;
}

export interface AgentChannelStatus {
  channel_id: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  created_at: string;
  rotated_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  last_rejected_at: string | null;
  rejection_count: number;
  rate_limited_count: number;
}

export interface AgentChannelRecord extends AgentChannelStatus {
  credential_hash: string;
}

export interface SignalSubscriptionInput {
  title?: string;
  url: string;
  fetch_interval_minutes?: number;
  retention_days?: number;
}

export interface SignalSubscriptionRow {
  id: string;
  title: string;
  url: string;
  enabled: boolean;
  muted: boolean;
  fetch_interval_minutes: number;
  retention_days: number;
  last_fetch_at: string | null;
  last_fetch_status: string;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface SignalItemInput {
  subscription_id: string;
  external_id: string;
  title: string;
  url: string;
  summary?: string;
  author?: string;
  published_at?: string | null;
}

export interface SignalItemRow {
  id: string;
  subscription_id: string;
  source_title: string;
  title: string;
  url: string;
  summary: string;
  author: string;
  published_at: string | null;
  received_at: string;
  status: "unread" | "read" | "archived";
  muted: boolean;
}

type AgentChannelDbRow = Omit<AgentChannelStatus, "enabled" | "configured"> & { enabled: number; configured: number };
type AgentChannelRecordDbRow = Omit<AgentChannelRecord, "enabled" | "configured"> & { enabled: number; configured: number };
type SignalSubscriptionDbRow = Omit<SignalSubscriptionRow, "enabled" | "muted"> & { enabled: number; muted: number };
type SignalItemDbRow = Omit<SignalItemRow, "muted"> & { muted: number };

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
      if (version === 3) {
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS agent_messages (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            source TEXT NOT NULL,
            kind TEXT NOT NULL,
            urgency TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            actions TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'unread',
            action_result TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            expires_at TEXT,
            last_error TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at ON agent_messages(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_agent_messages_channel_id ON agent_messages(channel_id);
          CREATE INDEX IF NOT EXISTS idx_agent_messages_status ON agent_messages(status);
        `);
        version = 4;
        this.connection.exec("PRAGMA user_version=4");
      }
      if (version === 4) {
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS mcp_tokens (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            rotated_at TEXT NOT NULL,
            revoked_at TEXT,
            last_used_at TEXT,
            last_test_at TEXT,
            last_test_status TEXT
          );
        `);
        version = 5;
        this.connection.exec("PRAGMA user_version=5");
      }
      if (version === 5) {
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS agent_channels (
            channel_id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            credential_hash TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            rotated_at TEXT NOT NULL,
            revoked_at TEXT,
            last_used_at TEXT,
            last_rejected_at TEXT,
            rejection_count INTEGER NOT NULL DEFAULT 0,
            rate_limited_count INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS agent_channel_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT NOT NULL,
            urgency TEXT NOT NULL,
            accepted INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_agent_channel_events_window ON agent_channel_events(channel_id, urgency, accepted, created_at);
        `);
        version = 6;
        this.connection.exec("PRAGMA user_version=6");
      }
      if (version === 6) {
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS signal_subscriptions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            muted INTEGER NOT NULL DEFAULT 0,
            fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
            retention_days INTEGER NOT NULL DEFAULT 30,
            last_fetch_at TEXT,
            last_fetch_status TEXT NOT NULL DEFAULT 'never',
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS signal_items (
            id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL REFERENCES signal_subscriptions(id) ON DELETE CASCADE,
            external_id TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            published_at TEXT,
            received_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unread',
            UNIQUE(subscription_id, external_id)
          );
          CREATE INDEX IF NOT EXISTS idx_signal_items_received_at ON signal_items(received_at DESC);
          CREATE INDEX IF NOT EXISTS idx_signal_items_subscription ON signal_items(subscription_id);
          CREATE INDEX IF NOT EXISTS idx_signal_items_status ON signal_items(status);
        `);
        version = 7;
        this.connection.exec("PRAGMA user_version=7");
      }
      if (version === 7) {
        // Contact metadata, contact points, and contact policy (work item 015, CLV-009/010/011).
        // Add columns defensively: legacy-imported contacts tables may already carry some of these
        // (e.g. a `tags` column from the original Twilio Phone schema), so skip any that exist.
        const existingContactColumns = new Set((this.connection.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>).map(column => column.name));
        const contactColumnAdds: Array<[string, string]> = [
          ["notes", "TEXT NOT NULL DEFAULT ''"],
          ["company", "TEXT NOT NULL DEFAULT ''"],
          ["role", "TEXT NOT NULL DEFAULT ''"],
          ["tags", "TEXT NOT NULL DEFAULT ''"],
          ["relationship", "TEXT NOT NULL DEFAULT ''"],
          ["trust_level", "TEXT NOT NULL DEFAULT 'unknown'"],
          ["pinned", "INTEGER NOT NULL DEFAULT 0"],
          ["favorite", "INTEGER NOT NULL DEFAULT 0"],
          ["avatar_media_id", "TEXT NOT NULL DEFAULT ''"],
          ["created_at", "TEXT NOT NULL DEFAULT ''"],
          ["updated_at", "TEXT NOT NULL DEFAULT ''"]
        ];
        for (const [name, definition] of contactColumnAdds) {
          if (!existingContactColumns.has(name)) this.connection.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${definition}`);
        }
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS contact_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'phone',
            value TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            is_primary INTEGER NOT NULL DEFAULT 0,
            verified_at TEXT,
            blocked_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(contact_id, value)
          );
          CREATE INDEX IF NOT EXISTS idx_contact_points_value ON contact_points(value);
          CREATE TABLE IF NOT EXISTS contact_policy (
            contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
            trust_level TEXT NOT NULL DEFAULT 'unknown',
            allow_agent_messages INTEGER NOT NULL DEFAULT 1,
            allow_approval_requests INTEGER NOT NULL DEFAULT 0,
            allow_urgent_interrupts INTEGER NOT NULL DEFAULT 0,
            muted_until TEXT,
            blocked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        // Backfill timestamps + a primary phone contact point for existing contacts (no data loss).
        const now = utcNow();
        this.connection.prepare("UPDATE contacts SET created_at=?, updated_at=? WHERE created_at=''").run(now, now);
        for (const row of this.connection.prepare("SELECT id, number FROM contacts WHERE number IS NOT NULL AND number<>''").all() as Array<{ id: number; number: string }>) {
          this.connection.prepare("INSERT OR IGNORE INTO contact_points(contact_id, kind, value, label, is_primary, created_at, updated_at) VALUES(?, 'phone', ?, 'primary', 1, ?, ?)").run(row.id, row.number, now, now);
        }
        version = 8;
        this.connection.exec("PRAGMA user_version=8");
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
      contact_points: this.connection.prepare("SELECT * FROM contact_points ORDER BY contact_id, id").all(),
      contact_policy: this.connection.prepare("SELECT * FROM contact_policy ORDER BY contact_id").all(),
      threads: this.connection.prepare("SELECT * FROM threads ORDER BY id").all(),
      messages: this.connection.prepare("SELECT * FROM messages ORDER BY ts, id").all(),
      agent_messages: this.connection.prepare("SELECT * FROM agent_messages ORDER BY created_at, id").all(),
      signal_subscriptions: this.connection.prepare("SELECT * FROM signal_subscriptions ORDER BY title, id").all(),
      signal_items: this.connection.prepare("SELECT * FROM signal_items ORDER BY received_at, id").all(),
      mcp_tokens: this.connection.prepare("SELECT id, created_at, rotated_at, revoked_at, last_used_at, last_test_at, last_test_status FROM mcp_tokens ORDER BY id").all(),
      agent_channels: this.connection.prepare("SELECT channel_id, label, enabled, created_at, rotated_at, revoked_at, last_used_at, last_rejected_at, rejection_count, rate_limited_count FROM agent_channels ORDER BY channel_id").all()
    };
  }

  applyRetention(days: number): { deletedMessages: number; deletedThreads: number; deletedAgentMessages: number; deletedSignalItems: number } {
    if (!Number.isInteger(days) || days < 30 || days > 3650) throw new Error("Retention must be between 30 and 3650 days.");
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const deletedMessages = Number(this.connection.prepare("DELETE FROM messages WHERE ts < ?").run(cutoff).changes);
      const deletedAgentMessages = Number(this.connection.prepare("DELETE FROM agent_messages WHERE created_at < ?").run(cutoff).changes);
      const deletedSignalItems = Number(this.connection.prepare("DELETE FROM signal_items WHERE received_at < ?").run(cutoff).changes);
      const deletedThreads = Number(this.connection.prepare("DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.thread_id=threads.id)").run().changes);
      this.connection.prepare("UPDATE threads SET last_msg_ts=(SELECT MAX(ts) FROM messages WHERE messages.thread_id=threads.id)").run();
      this.connection.exec("COMMIT");
      return { deletedMessages, deletedThreads, deletedAgentMessages, deletedSignalItems };
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
    const contactId = this.resolveContactIdByValue(number);
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.connection.prepare("INSERT INTO threads(contact_id, canonical_number, last_msg_ts) VALUES(?, ?, ?)").run(contactId, number, utcNow());
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
    return this.connection.prepare("SELECT DISTINCT c.* FROM contacts c LEFT JOIN contact_points cp ON cp.contact_id=c.id WHERE c.name LIKE ? OR c.number LIKE ? OR cp.value LIKE ? OR cp.label LIKE ? ORDER BY c.name, c.number").all(like, like, like, like) as Record<string, unknown>[];
  }

  upsertContact(nameValue: string, numberValue: string): number {
    const number = normalizeNumber(numberValue);
    const now = utcNow();
    this.connection.prepare("INSERT INTO contacts(name, number, last_seen, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(number) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen, updated_at=excluded.updated_at").run((nameValue || "").trim(), number, now, now, now);
    const id = (this.connection.prepare("SELECT id FROM contacts WHERE number=?").get(number) as { id: number }).id;
    this.connection.prepare("INSERT OR IGNORE INTO contact_points(contact_id, kind, value, label, is_primary, created_at, updated_at) VALUES(?, 'phone', ?, 'primary', 1, ?, ?)").run(id, number, now, now);
    return id;
  }

  // Contact metadata (CLV-009)
  updateContact(id: number, fields: Record<string, unknown>): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of ["name", "notes", "company", "role", "tags", "relationship", "trust_level", "avatar_media_id"]) {
      if (key in fields) { sets.push(`${key}=?`); values.push(String(fields[key] ?? "")); }
    }
    if ("pinned" in fields) { sets.push("pinned=?"); values.push(fields.pinned ? 1 : 0); }
    if ("favorite" in fields) { sets.push("favorite=?"); values.push(fields.favorite ? 1 : 0); }
    if (!sets.length) return;
    sets.push("updated_at=?"); values.push(utcNow()); values.push(id);
    if (this.connection.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id=?`).run(...values as never[]).changes !== 1) throw new Error("Contact not found.");
  }

  deleteContact(id: number): void {
    this.connection.prepare("UPDATE threads SET contact_id=NULL WHERE contact_id=?").run(id);
    this.connection.prepare("DELETE FROM contact_points WHERE contact_id=?").run(id);
    this.connection.prepare("DELETE FROM contact_policy WHERE contact_id=?").run(id);
    this.connection.prepare("DELETE FROM contacts WHERE id=?").run(id);
  }

  // Contact points (CLV-010)
  contactPoints(contactId: number): Record<string, unknown>[] {
    return this.connection.prepare("SELECT * FROM contact_points WHERE contact_id=? ORDER BY is_primary DESC, id").all(contactId) as Record<string, unknown>[];
  }

  addContactPoint(contactId: number, kind: string, value: string, label = "", isPrimary = false): number {
    const now = utcNow();
    const normalized = kind === "phone" ? normalizeNumber(value) : value.trim();
    if (!this.connection.prepare("SELECT id FROM contacts WHERE id=?").get(contactId)) throw new Error("Contact not found.");
    if (isPrimary) this.connection.prepare("UPDATE contact_points SET is_primary=0 WHERE contact_id=?").run(contactId);
    this.connection.prepare("INSERT INTO contact_points(contact_id, kind, value, label, is_primary, created_at, updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(contact_id, value) DO UPDATE SET kind=excluded.kind, label=CASE WHEN contact_points.is_primary=1 AND excluded.is_primary=0 THEN contact_points.label ELSE excluded.label END, is_primary=CASE WHEN excluded.is_primary=1 THEN 1 ELSE contact_points.is_primary END, updated_at=excluded.updated_at").run(contactId, kind, normalized, label, isPrimary ? 1 : 0, now, now);
    if (kind === "phone" && isPrimary) this.connection.prepare("UPDATE contacts SET number=?, updated_at=? WHERE id=?").run(normalized, now, contactId);
    if (kind === "phone") this.connection.prepare("UPDATE threads SET contact_id=? WHERE canonical_number=?").run(contactId, normalized);
    return (this.connection.prepare("SELECT id FROM contact_points WHERE contact_id=? AND value=?").get(contactId, normalized) as { id: number }).id;
  }

  setContactPointBlocked(pointId: number, blocked: boolean): void {
    if (this.connection.prepare("UPDATE contact_points SET blocked_at=?, updated_at=? WHERE id=?").run(blocked ? utcNow() : null, utcNow(), pointId).changes !== 1) throw new Error("Contact point not found.");
  }

  // Resolve contact identity through contact points rather than a flat number.
  resolveContactIdByValue(value: string): number | null {
    const normalized = normalizeNumber(value);
    const row = this.connection.prepare("SELECT contact_id FROM contact_points WHERE value=? OR value=?").get(normalized, value) as { contact_id: number } | undefined;
    return row ? row.contact_id : null;
  }

  // Contact policy (CLV-011)
  getContactPolicy(contactId: number): Record<string, unknown> {
    return (this.connection.prepare("SELECT * FROM contact_policy WHERE contact_id=?").get(contactId) as Record<string, unknown> | undefined)
      || { contact_id: contactId, trust_level: "unknown", allow_agent_messages: 1, allow_approval_requests: 0, allow_urgent_interrupts: 0, muted_until: null, blocked: 0 };
  }

  setContactPolicy(contactId: number, policy: Record<string, unknown>): Record<string, unknown> {
    const now = utcNow();
    const trust = String(policy.trust_level ?? "unknown");
    this.connection.prepare("INSERT INTO contact_policy(contact_id, trust_level, allow_agent_messages, allow_approval_requests, allow_urgent_interrupts, muted_until, blocked, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET trust_level=excluded.trust_level, allow_agent_messages=excluded.allow_agent_messages, allow_approval_requests=excluded.allow_approval_requests, allow_urgent_interrupts=excluded.allow_urgent_interrupts, muted_until=excluded.muted_until, blocked=excluded.blocked, updated_at=excluded.updated_at")
      .run(contactId, trust, policy.allow_agent_messages ? 1 : 0, policy.allow_approval_requests ? 1 : 0, policy.allow_urgent_interrupts ? 1 : 0, policy.muted_until ? String(policy.muted_until) : null, policy.blocked ? 1 : 0, now, now);
    this.connection.prepare("UPDATE contacts SET trust_level=?, updated_at=? WHERE id=?").run(trust, now, contactId);
    return this.getContactPolicy(contactId);
  }

  linkThread(threadId: number, contactId: number): void {
    const thread = this.connection.prepare("SELECT canonical_number FROM threads WHERE id=?").get(threadId) as { canonical_number: string } | undefined;
    if (!thread) throw new Error("Thread not found.");
    this.addContactPoint(contactId, "phone", thread.canonical_number, "attached", false);
    this.connection.prepare("UPDATE threads SET contact_id=? WHERE id=?").run(contactId, threadId);
  }

  createContactFromThread(threadId: number, nameValue: string): number {
    const thread = this.connection.prepare("SELECT canonical_number FROM threads WHERE id=?").get(threadId) as { canonical_number: string } | undefined;
    if (!thread) throw new Error("Thread not found.");
    const contactId = this.upsertContact(nameValue, thread.canonical_number);
    this.linkThread(threadId, contactId);
    return contactId;
  }

  ignoreThread(threadId: number): void {
    if (this.connection.prepare("UPDATE threads SET unread_count=0 WHERE id=?").run(threadId).changes !== 1) throw new Error("Thread not found.");
  }

  blockThread(threadId: number): number {
    const thread = this.connection.prepare("SELECT canonical_number FROM threads WHERE id=?").get(threadId) as { canonical_number: string } | undefined;
    if (!thread) throw new Error("Thread not found.");
    const contactId = this.upsertContact("", thread.canonical_number);
    const pointId = this.addContactPoint(contactId, "phone", thread.canonical_number, "blocked", true);
    this.setContactPointBlocked(pointId, true);
    this.setContactPolicy(contactId, { trust_level: "blocked", allow_agent_messages: false, allow_approval_requests: false, allow_urgent_interrupts: false, blocked: true });
    this.connection.prepare("UPDATE threads SET contact_id=?, unread_count=0 WHERE id=?").run(contactId, threadId);
    return contactId;
  }

  updateMessageStatus(messageId: string, status: string): void {
    this.updateDeliveryStatus(messageId, status);
  }

  addAgentMessage(message: AgentMessageInput): AgentMessageRow {
    const createdAt = message.created_at || utcNow();
    const status: AgentMessageStatus = message.expires_at && new Date(message.expires_at).getTime() <= Date.now() ? "expired" : "unread";
    this.connection.prepare(`
      INSERT INTO agent_messages(id, channel_id, source, kind, urgency, title, body, actions, status, created_at, expires_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(message.id, message.channel_id, message.source, message.kind, message.urgency, message.title, message.body, JSON.stringify(message.actions || []), status, createdAt, message.expires_at || null);
    return this.agentMessage(message.id)!;
  }

  agentMessages(): AgentMessageRow[] {
    this.expireAgentMessages();
    return this.connection.prepare("SELECT * FROM agent_messages ORDER BY created_at DESC, id DESC LIMIT 500").all() as unknown as AgentMessageRow[];
  }

  agentMessage(id: string): AgentMessageRow | undefined {
    this.expireAgentMessages();
    return this.connection.prepare("SELECT * FROM agent_messages WHERE id=?").get(id) as unknown as AgentMessageRow | undefined;
  }

  updateAgentMessageStatus(id: string, status: AgentMessageStatus, actionId = ""): AgentMessageRow {
    if (!["read", "dismissed", "acted"].includes(status)) throw new Error("Unsupported agent message status.");
    const current = this.agentMessage(id);
    if (!current) throw new Error("Agent message not found.");
    if (current.status === "expired") throw new Error("Agent message has expired.");
    const result = this.connection.prepare("UPDATE agent_messages SET status=?, action_result=? WHERE id=?")
      .run(status, actionId ? JSON.stringify({ action_id: actionId, acted_at: utcNow() }) : current.action_result, id);
    if (result.changes !== 1) throw new Error("Agent message not found.");
    return this.agentMessage(id)!;
  }

  private expireAgentMessages(): void {
    this.connection.prepare("UPDATE agent_messages SET status='expired' WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('unread', 'read')").run(utcNow());
  }

  mcpTokenRecord(): McpTokenRecord | undefined {
    return this.connection.prepare("SELECT token_hash, created_at, rotated_at, revoked_at, last_used_at, last_test_at, last_test_status FROM mcp_tokens WHERE id='default'").get() as unknown as McpTokenRecord | undefined;
  }

  mcpTokenStatus(): McpTokenStatus {
    const row = this.mcpTokenRecord();
    return {
      configured: Boolean(row && !row.revoked_at),
      created_at: row?.created_at || null,
      rotated_at: row?.rotated_at || null,
      revoked_at: row?.revoked_at || null,
      last_used_at: row?.last_used_at || null,
      last_test_at: row?.last_test_at || null,
      last_test_status: row?.last_test_status || null
    };
  }

  setMcpTokenHash(tokenHash: string): McpTokenStatus {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error("Invalid MCP token hash.");
    const now = utcNow();
    const existing = this.mcpTokenRecord();
    this.connection.prepare(`
      INSERT INTO mcp_tokens(id, token_hash, created_at, rotated_at, revoked_at)
      VALUES('default', ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, rotated_at=excluded.rotated_at, revoked_at=NULL
    `).run(tokenHash, existing?.created_at || now, now);
    return this.mcpTokenStatus();
  }

  revokeMcpToken(): McpTokenStatus {
    const now = utcNow();
    const existing = this.mcpTokenRecord();
    if (!existing) {
      this.connection.prepare("INSERT INTO mcp_tokens(id, token_hash, created_at, rotated_at, revoked_at) VALUES('default', ?, ?, ?, ?)").run("0".repeat(64), now, now, now);
    } else {
      this.connection.prepare("UPDATE mcp_tokens SET revoked_at=? WHERE id='default'").run(now);
    }
    return this.mcpTokenStatus();
  }

  markMcpTokenUsed(): void {
    this.connection.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id='default' AND revoked_at IS NULL").run(utcNow());
  }

  markMcpTest(status: string): McpTokenStatus {
    this.connection.prepare("UPDATE mcp_tokens SET last_test_at=?, last_test_status=? WHERE id='default'").run(utcNow(), status.slice(0, 80));
    return this.mcpTokenStatus();
  }

  agentChannels(): AgentChannelStatus[] {
    return (this.connection.prepare(`
      SELECT channel_id, label, enabled, created_at, rotated_at, revoked_at, last_used_at, last_rejected_at, rejection_count, rate_limited_count,
             credential_hash <> '' AS configured
      FROM agent_channels ORDER BY channel_id
    `).all() as unknown as AgentChannelDbRow[]).map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      configured: Boolean(row.configured)
    }));
  }

  agentChannelRecord(channelId: string): AgentChannelRecord | undefined {
    const row = this.connection.prepare(`
      SELECT channel_id, label, credential_hash, enabled, credential_hash <> '' AS configured,
             created_at, rotated_at, revoked_at, last_used_at, last_rejected_at, rejection_count, rate_limited_count
      FROM agent_channels WHERE channel_id=?
    `).get(channelId) as unknown as AgentChannelRecordDbRow | undefined;
    return row ? { ...row, enabled: Boolean(row.enabled), configured: Boolean(row.configured) } : undefined;
  }

  setAgentChannelCredential(channelId: string, label: string, credentialHash: string): AgentChannelStatus {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(channelId)) throw new Error("Invalid agent channel id.");
    if (!/^[a-f0-9]{64}$/.test(credentialHash)) throw new Error("Invalid agent channel credential hash.");
    const now = utcNow();
    const existing = this.agentChannelRecord(channelId);
    this.connection.prepare(`
      INSERT INTO agent_channels(channel_id, label, credential_hash, enabled, created_at, rotated_at, revoked_at)
      VALUES(?, ?, ?, 1, ?, ?, NULL)
      ON CONFLICT(channel_id) DO UPDATE SET
        label=excluded.label,
        credential_hash=excluded.credential_hash,
        enabled=1,
        rotated_at=excluded.rotated_at,
        revoked_at=NULL
    `).run(channelId, label.slice(0, 120) || channelId, credentialHash, existing?.created_at || now, now);
    return this.agentChannelRecord(channelId)!;
  }

  setAgentChannelEnabled(channelId: string, enabled: boolean): AgentChannelStatus {
    if (this.connection.prepare("UPDATE agent_channels SET enabled=? WHERE channel_id=?").run(enabled ? 1 : 0, channelId).changes !== 1) throw new Error("Agent channel not found.");
    return this.agentChannelRecord(channelId)!;
  }

  revokeAgentChannel(channelId: string): AgentChannelStatus {
    const now = utcNow();
    if (this.connection.prepare("UPDATE agent_channels SET revoked_at=?, credential_hash='' WHERE channel_id=?").run(now, channelId).changes !== 1) throw new Error("Agent channel not found.");
    return this.agentChannelRecord(channelId)!;
  }

  markAgentChannelUsed(channelId: string, urgency: string): void {
    const now = utcNow();
    this.connection.prepare("UPDATE agent_channels SET last_used_at=? WHERE channel_id=?").run(now, channelId);
    this.connection.prepare("INSERT INTO agent_channel_events(channel_id, urgency, accepted, reason, created_at) VALUES(?, ?, 1, 'accepted', ?)").run(channelId, urgency, now);
  }

  markAgentChannelRejected(channelId: string, urgency: string, reason: string): void {
    const now = utcNow();
    const rateLimited = reason === "rate_limited" ? 1 : 0;
    this.connection.prepare(`
      UPDATE agent_channels
      SET last_rejected_at=?, rejection_count=rejection_count+1, rate_limited_count=rate_limited_count+?
      WHERE channel_id=?
    `).run(now, rateLimited, channelId);
    this.connection.prepare("INSERT INTO agent_channel_events(channel_id, urgency, accepted, reason, created_at) VALUES(?, ?, 0, ?, ?)").run(channelId, urgency || "unknown", reason.slice(0, 80), now);
  }

  agentChannelAcceptedCount(channelId: string, urgency: string, sinceIso: string): number {
    const row = this.connection.prepare(`
      SELECT COUNT(*) AS count FROM agent_channel_events
      WHERE channel_id=? AND urgency=? AND accepted=1 AND created_at >= ?
    `).get(channelId, urgency, sinceIso) as { count: number };
    return Number(row.count);
  }

  upsertSignalSubscription(input: SignalSubscriptionInput): SignalSubscriptionRow {
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Feed URL must use http or https.");
    const now = utcNow();
    const title = (input.title || url.hostname).trim().slice(0, 160) || url.hostname;
    const interval = Number(input.fetch_interval_minutes || 60);
    const retention = Number(input.retention_days || 30);
    if (!Number.isInteger(interval) || interval < 15 || interval > 10080) throw new Error("Fetch interval must be between 15 minutes and 7 days.");
    if (!Number.isInteger(retention) || retention < 7 || retention > 3650) throw new Error("Signal retention must be between 7 and 3650 days.");
    const existing = this.connection.prepare("SELECT id FROM signal_subscriptions WHERE url=?").get(url.toString()) as { id: string } | undefined;
    const id = existing?.id || `sigsub-${randomUUID()}`;
    this.connection.prepare(`
      INSERT INTO signal_subscriptions(id, title, url, enabled, muted, fetch_interval_minutes, retention_days, created_at, updated_at)
      VALUES(?, ?, ?, 1, 0, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET title=excluded.title, fetch_interval_minutes=excluded.fetch_interval_minutes, retention_days=excluded.retention_days, updated_at=excluded.updated_at
    `).run(id, title, url.toString(), interval, retention, existing ? now : now, now);
    return this.signalSubscription(id)!;
  }

  signalSubscriptions(): SignalSubscriptionRow[] {
    return (this.connection.prepare("SELECT * FROM signal_subscriptions ORDER BY title, id").all() as unknown as SignalSubscriptionDbRow[]).map((row) => ({ ...row, enabled: Boolean(row.enabled), muted: Boolean(row.muted) }));
  }

  signalSubscription(id: string): SignalSubscriptionRow | undefined {
    const row = this.connection.prepare("SELECT * FROM signal_subscriptions WHERE id=?").get(id) as unknown as SignalSubscriptionDbRow | undefined;
    return row ? { ...row, enabled: Boolean(row.enabled), muted: Boolean(row.muted) } : undefined;
  }

  setSignalSubscriptionState(id: string, state: Partial<Pick<SignalSubscriptionRow, "enabled" | "muted">>): SignalSubscriptionRow {
    const current = this.signalSubscription(id);
    if (!current) throw new Error("Signal subscription not found.");
    this.connection.prepare("UPDATE signal_subscriptions SET enabled=?, muted=?, updated_at=? WHERE id=?").run((state.enabled ?? current.enabled) ? 1 : 0, (state.muted ?? current.muted) ? 1 : 0, utcNow(), id);
    return this.signalSubscription(id)!;
  }

  markSignalFetch(id: string, status: "ok" | "failed", error = ""): void {
    this.connection.prepare("UPDATE signal_subscriptions SET last_fetch_at=?, last_fetch_status=?, last_error=?, updated_at=? WHERE id=?").run(utcNow(), status, error.slice(0, 500), utcNow(), id);
  }

  updateSignalSubscriptionTitle(id: string, title: string): void {
    if (title.trim()) this.connection.prepare("UPDATE signal_subscriptions SET title=?, updated_at=? WHERE id=?").run(title.trim().slice(0, 160), utcNow(), id);
  }

  addSignalItem(item: SignalItemInput): boolean {
    const subscription = this.signalSubscription(item.subscription_id);
    if (!subscription) throw new Error("Signal subscription not found.");
    const externalId = item.external_id.slice(0, 1000) || item.url || item.title;
    const id = createHash("sha256").update(`${item.subscription_id}\n${externalId}`).digest("hex");
    const result = this.connection.prepare(`
      INSERT OR IGNORE INTO signal_items(id, subscription_id, external_id, title, url, summary, author, published_at, received_at, status)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread')
    `).run(id, item.subscription_id, externalId, item.title.slice(0, 240), item.url.slice(0, 1000), (item.summary || "").slice(0, 1200), (item.author || "").slice(0, 160), item.published_at || null, utcNow());
    return result.changes === 1;
  }

  signalItems(limit = 50): SignalItemRow[] {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const rows = this.connection.prepare(`
      SELECT i.id, i.subscription_id, s.title AS source_title, i.title, i.url, i.summary, i.author, i.published_at, i.received_at, i.status, s.muted
      FROM signal_items i JOIN signal_subscriptions s ON s.id=i.subscription_id
      WHERE i.status <> 'archived'
      ORDER BY COALESCE(i.published_at, i.received_at) DESC, i.received_at DESC, i.id DESC
      LIMIT ?
    `).all(boundedLimit) as unknown as SignalItemDbRow[];
    return rows.map((row) => ({ ...row, muted: Boolean(row.muted) }));
  }

  archiveSignalItem(id: string): SignalItemRow {
    if (this.connection.prepare("UPDATE signal_items SET status='archived' WHERE id=?").run(id).changes !== 1) throw new Error("Signal item not found.");
    const row = this.connection.prepare(`
      SELECT i.id, i.subscription_id, s.title AS source_title, i.title, i.url, i.summary, i.author, i.published_at, i.received_at, i.status, s.muted
      FROM signal_items i JOIN signal_subscriptions s ON s.id=i.subscription_id WHERE i.id=?
    `).get(id) as unknown as SignalItemDbRow;
    return { ...row, muted: Boolean(row.muted) };
  }

  applySignalRetention(subscriptionId?: string): number {
    const subscriptions = subscriptionId ? [this.signalSubscription(subscriptionId)].filter(Boolean) as SignalSubscriptionRow[] : this.signalSubscriptions();
    let deleted = 0;
    for (const subscription of subscriptions) {
      const cutoff = new Date(Date.now() - subscription.retention_days * 86_400_000).toISOString();
      deleted += Number(this.connection.prepare("DELETE FROM signal_items WHERE subscription_id=? AND received_at < ?").run(subscription.id, cutoff).changes);
    }
    return deleted;
  }
}
