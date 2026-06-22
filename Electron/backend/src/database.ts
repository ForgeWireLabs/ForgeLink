import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CallRecordInput, CallStatus, CallStatusUpdate } from "./channels";
import { normalizeNumber, utcNow } from "./phone";

export const CURRENT_SCHEMA_VERSION = 13;

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

export interface ContactPolicyDecision {
  allowed: boolean;
  reason: string;
  contact_id: number | null;
}

// Human Cards (work item 016, AGH-001): resolvable local operator authority so
// agents can address a human by role/alias (for example `operator:primary`)
// rather than by phone number or contact string. Local data; never published to
// providers or external channels.
export interface HumanCardInput {
  alias: string;
  display_name?: string;
  role?: string;
  availability?: string;
  authority_scopes?: string[];
  preferred_channels?: string[];
  quiet_hours?: string;
  redaction_profile?: string;
  notes?: string;
}

export interface HumanCardRow {
  id: number;
  alias: string;
  display_name: string;
  role: string;
  availability: string;
  authority_scopes: string;     // JSON array text
  preferred_channels: string;   // JSON array text
  quiet_hours: string;
  redaction_profile: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// Agent-facing, redacted view returned by alias resolution. Operator-private
// fields (notes, raw quiet-hours config) are not exposed to agents.
export interface ResolvedHumanCard {
  alias: string;
  display_name: string;
  role: string;
  availability: string;
  authority_scopes: string[];
  preferred_channels: string[];
  resolved_via: string;         // the alias actually matched (after fallback)
}

// Authority scopes (work item 016, AGH-002): what an operator may approve.
// Canonical set; approval requests declare the scope they require, and ForgeLink
// rejects/escalates requests addressed to humans who do not hold it.
export const AUTHORITY_SCOPES = ["general_approval", "release_approval", "security_approval", "emergency"] as const;
export type AuthorityScope = typeof AUTHORITY_SCOPES[number];

export function isAuthorityScope(value: string): value is AuthorityScope {
  return (AUTHORITY_SCOPES as readonly string[]).includes(value);
}

export interface AuthorityDecision {
  scope: string;
  addressed_alias: string;
  resolved_via: string | null;  // card matched after fallback, or null if unresolved
  granted: boolean;
  escalate_to: string[];        // aliases that hold the scope (for escalation)
}

// Agent Identity Registry (work item 016, AGH-003): first-class identities for
// agents, MCP clients, systems, and local workflows so agent-originated requests
// are tied to a known identity. Trust-state transitions/probation are AGH-004;
// AGH-003 records identities and gives unknown agents restricted defaults.
export const AGENT_TRUST_STATES = ["unknown", "probation", "trusted", "restricted", "muted", "blocked"] as const;
export type AgentTrustState = typeof AGENT_TRUST_STATES[number];

export function isAgentTrustState(value: string): value is AgentTrustState {
  return (AGENT_TRUST_STATES as readonly string[]).includes(value);
}

export interface AgentIdentityInput {
  id: string;
  display_name?: string;
  source_kind?: string;
  source_uri?: string;
  owner?: string;
  trust_state?: string;
  default_risk_limit?: string;
  allowed_channels?: string[];
  allowed_tools?: string[];
  escalation_alias?: string;
}

export interface AgentIdentityRow {
  id: string;
  display_name: string;
  source_kind: string;
  source_uri: string;
  owner: string;
  signing_key_ref: string;
  trust_state: string;
  default_risk_limit: string;
  allowed_channels: string;   // JSON array text
  allowed_tools: string;      // JSON array text
  escalation_alias: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

// Trust transition audit (work item 016, AGH-004): trust-state changes are
// explicit operator decisions and recorded as tamper-visible events.
export interface AgentTrustEventRow {
  id: number;
  agent_id: string;
  from_state: string;
  to_state: string;
  reason: string;
  changed_at: string;
}

export interface CallRow {
  id: number;
  local_call_id: string;
  provider_kind: string;
  provider_name: string;
  provider_call_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string | null;
  to_number: string;
  contact_id: number | null;
  contact_point_id: number | null;
  status: CallStatus;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  redacted_error: string;
  created_at: string;
  updated_at: string;
  contact_name?: string | null;
  contact_point_label?: string | null;
  contact_point_value?: string | null;
}

export type ContactTimelineKind = "message" | "call" | "agent";
export interface ContactTimelineItem {
  id: string;
  kind: ContactTimelineKind;
  occurred_at: string;
  summary: string;
  detail: string;
  status: string;
  direction: string;
  source: string;
  private: boolean;
  redacted: boolean;
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
      if (version === 8) {
        const existingPolicyColumns = new Set((this.connection.prepare("PRAGMA table_info(contact_policy)").all() as Array<{ name: string }>).map(column => column.name));
        if (!existingPolicyColumns.has("quiet_hours_override")) this.connection.exec("ALTER TABLE contact_policy ADD COLUMN quiet_hours_override INTEGER NOT NULL DEFAULT 0");
        version = 9;
        this.connection.exec("PRAGMA user_version=9");
      }
      if (version === 9) {
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_call_id TEXT NOT NULL UNIQUE,
            provider_kind TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            provider_call_id TEXT UNIQUE,
            direction TEXT NOT NULL,
            from_number TEXT,
            to_number TEXT NOT NULL,
            contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            contact_point_id INTEGER REFERENCES contact_points(id) ON DELETE SET NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            answered_at TEXT,
            ended_at TEXT,
            duration_seconds INTEGER,
            redacted_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_calls_provider_call_id ON calls(provider_call_id);
        `);
        version = 10;
        this.connection.exec("PRAGMA user_version=10");
      }
      if (version === 10) {
        // Human Cards (work item 016, AGH-001; schema v11 per decision 0011).
        // Resolvable local operator authority. Seed a default `operator:primary`
        // so a fresh/local-only install always has a resolvable human authority.
        const now = utcNow();
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS human_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alias TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT '',
            availability TEXT NOT NULL DEFAULT 'available',
            authority_scopes TEXT NOT NULL DEFAULT '[]',
            preferred_channels TEXT NOT NULL DEFAULT '[]',
            quiet_hours TEXT NOT NULL DEFAULT '',
            redaction_profile TEXT NOT NULL DEFAULT 'desktop_full',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.connection.prepare(`
          INSERT OR IGNORE INTO human_cards(alias, display_name, role, availability, authority_scopes, preferred_channels, redaction_profile, created_at, updated_at)
          VALUES('operator:primary', 'Primary Operator', 'operator', 'available', ?, '["local"]', 'desktop_full', ?, ?)
        `).run(JSON.stringify(["release_approval", "security_approval", "general_approval", "emergency"]), now, now);
        version = 11;
        this.connection.exec("PRAGMA user_version=11");
      }
      if (version === 11) {
        // Agent Identity Registry (work item 016, AGH-003; schema v12 per decision 0011).
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS agent_identities (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL DEFAULT '',
            source_kind TEXT NOT NULL DEFAULT 'unknown',
            source_uri TEXT NOT NULL DEFAULT '',
            owner TEXT NOT NULL DEFAULT '',
            signing_key_ref TEXT NOT NULL DEFAULT '',
            trust_state TEXT NOT NULL DEFAULT 'unknown',
            default_risk_limit TEXT NOT NULL DEFAULT 'normal',
            allowed_channels TEXT NOT NULL DEFAULT '[]',
            allowed_tools TEXT NOT NULL DEFAULT '[]',
            escalation_alias TEXT NOT NULL DEFAULT '',
            last_seen_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_agent_identities_trust ON agent_identities(trust_state);
        `);
        version = 12;
        this.connection.exec("PRAGMA user_version=12");
      }
      if (version === 12) {
        // Agent trust transition audit (work item 016, AGH-004; schema v13 per decision 0011).
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS agent_trust_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            from_state TEXT NOT NULL,
            to_state TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            changed_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_agent_trust_events_agent ON agent_trust_events(agent_id, changed_at DESC);
        `);
        version = 13;
        this.connection.exec("PRAGMA user_version=13");
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
      calls: this.connection.prepare("SELECT * FROM calls ORDER BY created_at, id").all(),
      threads: this.connection.prepare("SELECT * FROM threads ORDER BY id").all(),
      messages: this.connection.prepare("SELECT * FROM messages ORDER BY ts, id").all(),
      agent_messages: this.connection.prepare("SELECT * FROM agent_messages ORDER BY created_at, id").all(),
      signal_subscriptions: this.connection.prepare("SELECT * FROM signal_subscriptions ORDER BY title, id").all(),
      signal_items: this.connection.prepare("SELECT * FROM signal_items ORDER BY received_at, id").all(),
      mcp_tokens: this.connection.prepare("SELECT id, created_at, rotated_at, revoked_at, last_used_at, last_test_at, last_test_status FROM mcp_tokens ORDER BY id").all(),
      agent_channels: this.connection.prepare("SELECT channel_id, label, enabled, created_at, rotated_at, revoked_at, last_used_at, last_rejected_at, rejection_count, rate_limited_count FROM agent_channels ORDER BY channel_id").all()
    };
  }

  applyRetention(days: number): { deletedMessages: number; deletedThreads: number; deletedAgentMessages: number; deletedSignalItems: number; deletedCalls: number } {
    if (!Number.isInteger(days) || days < 30 || days > 3650) throw new Error("Retention must be between 30 and 3650 days.");
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const deletedMessages = Number(this.connection.prepare("DELETE FROM messages WHERE ts < ?").run(cutoff).changes);
      const deletedAgentMessages = Number(this.connection.prepare("DELETE FROM agent_messages WHERE created_at < ?").run(cutoff).changes);
      const deletedSignalItems = Number(this.connection.prepare("DELETE FROM signal_items WHERE received_at < ?").run(cutoff).changes);
      const deletedCalls = Number(this.connection.prepare("DELETE FROM calls WHERE COALESCE(ended_at, started_at, created_at) < ?").run(cutoff).changes);
      const deletedThreads = Number(this.connection.prepare("DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.thread_id=threads.id)").run().changes);
      this.connection.prepare("UPDATE threads SET last_msg_ts=(SELECT MAX(ts) FROM messages WHERE messages.thread_id=threads.id)").run();
      this.connection.exec("COMMIT");
      return { deletedMessages, deletedThreads, deletedAgentMessages, deletedSignalItems, deletedCalls };
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
    const attention = message.direction === "inbound" ? this.contactAttentionDecision(message.number, timestampValue) : { allowed: true };
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.connection.prepare("INSERT OR IGNORE INTO messages (id, thread_id, direction, body, media_urls, status, ts) VALUES(?, ?, ?, ?, ?, ?, ?)")
        .run(message.id, threadId, message.direction, message.body || "", media.join(","), message.status || "", timestampValue);
      if (result.changes === 1) this.connection.prepare("UPDATE threads SET last_msg_ts=?, unread_count=unread_count+? WHERE id=?").run(timestampValue, message.direction === "inbound" && attention.allowed ? 1 : 0, threadId);
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

  private contactPointIdByValue(value: string): number | null {
    let normalized = "";
    try { normalized = normalizeNumber(value); } catch { normalized = ""; }
    const row = this.connection.prepare("SELECT id FROM contact_points WHERE value=? OR value=? ORDER BY is_primary DESC, id LIMIT 1").get(normalized, String(value || "").trim()) as { id: number } | undefined;
    return row ? row.id : null;
  }

  createCall(input: CallRecordInput): CallRow {
    const now = utcNow();
    const fromNumber = input.from ? normalizeNumber(input.from) : null;
    const toNumber = normalizeNumber(input.to);
    const identityValue = input.direction === "inbound" ? (fromNumber || toNumber) : toNumber;
    const contactId = input.contactId ?? this.resolveContactIdByValue(identityValue);
    const contactPointId = input.contactPointId ?? this.contactPointIdByValue(identityValue);
    this.connection.prepare(`
      INSERT INTO calls(local_call_id, provider_kind, provider_name, provider_call_id, direction, from_number, to_number, contact_id, contact_point_id, status, started_at, answered_at, ended_at, duration_seconds, redacted_error, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.localCallId,
      input.providerKind,
      input.providerName,
      input.providerCallId || null,
      input.direction,
      fromNumber,
      toNumber,
      contactId,
      contactPointId,
      input.status,
      input.startedAt || null,
      input.answeredAt || null,
      input.endedAt || null,
      input.durationSeconds ?? null,
      (input.redactedError || "").slice(0, 500),
      now,
      now
    );
    return this.callByLocalId(input.localCallId)!;
  }

  callByLocalId(localCallId: string): CallRow | undefined {
    return this.connection.prepare(`
      SELECT calls.*, contacts.name AS contact_name, contact_points.label AS contact_point_label, contact_points.value AS contact_point_value
      FROM calls
      LEFT JOIN contacts ON contacts.id=calls.contact_id
      LEFT JOIN contact_points ON contact_points.id=calls.contact_point_id
      WHERE calls.local_call_id=?
    `).get(localCallId) as unknown as CallRow | undefined;
  }

  callByProviderCallId(providerCallId: string): CallRow | undefined {
    return this.connection.prepare(`
      SELECT calls.*, contacts.name AS contact_name, contact_points.label AS contact_point_label, contact_points.value AS contact_point_value
      FROM calls
      LEFT JOIN contacts ON contacts.id=calls.contact_id
      LEFT JOIN contact_points ON contact_points.id=calls.contact_point_id
      WHERE calls.provider_call_id=?
    `).get(providerCallId) as unknown as CallRow | undefined;
  }

  calls(limit = 100): CallRow[] {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    return this.connection.prepare(`
      SELECT calls.*, contacts.name AS contact_name, contact_points.label AS contact_point_label, contact_points.value AS contact_point_value
      FROM calls
      LEFT JOIN contacts ON contacts.id=calls.contact_id
      LEFT JOIN contact_points ON contact_points.id=calls.contact_point_id
      ORDER BY calls.created_at DESC, calls.id DESC
      LIMIT ?
    `).all(boundedLimit) as unknown as CallRow[];
  }

  markCallStarted(localCallId: string, providerCallId: string | null, status: CallStatus): CallRow {
    const now = utcNow();
    if (this.connection.prepare("UPDATE calls SET provider_call_id=?, status=?, redacted_error='', started_at=COALESCE(started_at, ?), updated_at=? WHERE local_call_id=?").run(providerCallId || null, status, now, now, localCallId).changes !== 1) throw new Error("Call not found.");
    return this.callByLocalId(localCallId)!;
  }

  markCallFailed(localCallId: string, error: string): CallRow {
    const now = utcNow();
    if (this.connection.prepare("UPDATE calls SET status='failed', ended_at=COALESCE(ended_at, ?), redacted_error=?, updated_at=? WHERE local_call_id=?").run(now, error.slice(0, 500), now, localCallId).changes !== 1) throw new Error("Call not found.");
    return this.callByLocalId(localCallId)!;
  }

  applyCallStatus(update: CallStatusUpdate): boolean {
    const rank: Record<CallStatus, number> = { queued: 0, ringing: 1, in_progress: 2, completed: 3, failed: 3, busy: 3, no_answer: 3, canceled: 3 };
    const current = this.connection.prepare("SELECT local_call_id, status FROM calls WHERE provider_call_id=? OR local_call_id=?").get(update.providerCallId, update.providerCallId) as { local_call_id: string; status: CallStatus } | undefined;
    if (!current || !(update.status in rank) || update.status === current.status || rank[update.status] <= (rank[current.status] ?? 0)) return false;
    const now = utcNow();
    const endedAt = update.endedAt || (rank[update.status] >= 3 ? now : null);
    this.connection.prepare(`
      UPDATE calls
      SET status=?,
          started_at=COALESCE(started_at, ?),
          answered_at=COALESCE(answered_at, ?),
          ended_at=COALESCE(ended_at, ?),
          duration_seconds=COALESCE(?, duration_seconds),
          redacted_error=?,
          updated_at=?
      WHERE local_call_id=?
    `).run(
      update.status,
      update.startedAt || (update.status !== "queued" ? now : null),
      update.answeredAt || (update.status === "in_progress" ? now : null),
      endedAt,
      update.durationSeconds ?? null,
      (update.redactedError || "").slice(0, 500),
      now,
      current.local_call_id
    );
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

  contactTimeline(contactId: number, includeAgentDetails = false, limit = 100): ContactTimelineItem[] {
    if (!this.connection.prepare("SELECT id FROM contacts WHERE id=?").get(contactId)) throw new Error("Contact not found.");
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 300));
    const messages = (this.connection.prepare(`
      SELECT m.id, m.direction, m.body, m.status, m.ts, t.canonical_number, cp.label AS point_label
      FROM messages m
      JOIN threads t ON t.id=m.thread_id
      LEFT JOIN contact_points cp ON cp.contact_id=? AND cp.kind='phone' AND cp.value=t.canonical_number
      WHERE t.contact_id=? OR t.canonical_number IN (SELECT value FROM contact_points WHERE contact_id=? AND kind='phone')
      ORDER BY m.ts DESC, m.id DESC
      LIMIT ?
    `).all(contactId, contactId, contactId, boundedLimit) as Array<{ id: string; direction: string; body: string; status: string; ts: string; canonical_number: string; point_label: string | null }>).map((row): ContactTimelineItem => ({
      id: `message:${row.id}`,
      kind: "message",
      occurred_at: row.ts,
      summary: `${row.direction === "inbound" ? "Inbound" : "Outbound"} message`,
      detail: row.body || "(empty message)",
      status: row.status || "message",
      direction: row.direction,
      source: row.point_label ? `${row.point_label} · ${row.canonical_number}` : row.canonical_number,
      private: false,
      redacted: false
    }));
    const calls = (this.connection.prepare(`
      SELECT calls.*, contact_points.label AS point_label
      FROM calls
      LEFT JOIN contact_points ON contact_points.id=calls.contact_point_id
      WHERE calls.contact_id=?
      ORDER BY COALESCE(calls.started_at, calls.created_at) DESC, calls.id DESC
      LIMIT ?
    `).all(contactId, boundedLimit) as unknown as Array<CallRow & { point_label: string | null }>).map((row): ContactTimelineItem => ({
      id: `call:${row.local_call_id}`,
      kind: "call",
      occurred_at: row.started_at || row.created_at,
      summary: `${row.direction === "inbound" ? "Inbound" : "Outbound"} call`,
      detail: `${row.from_number || "unknown"} -> ${row.to_number}${row.provider_call_id ? ` · ${row.provider_call_id}` : ""}${row.redacted_error ? ` · ${row.redacted_error}` : ""}`,
      status: row.duration_seconds ? `${row.status} · ${row.duration_seconds}s` : row.status,
      direction: row.direction,
      source: row.point_label ? `${row.point_label} · ${row.provider_name}` : row.provider_name,
      private: false,
      redacted: false
    }));
    const agents = (this.connection.prepare(`
      SELECT id, channel_id, source, kind, urgency, title, body, status, action_result, created_at
      FROM agent_messages
      WHERE source IN (SELECT value FROM contact_points WHERE contact_id=?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(contactId, boundedLimit) as unknown as AgentMessageRow[]).map((row): ContactTimelineItem => ({
      id: `agent:${row.id}`,
      kind: "agent",
      occurred_at: row.created_at,
      summary: `${row.kind.replace(/_/g, " ")} · ${row.status}`,
      detail: includeAgentDetails ? `${row.title}${row.body ? `: ${row.body}` : ""}${row.action_result ? ` · ${row.action_result}` : ""}` : "Private agent details hidden",
      status: row.urgency,
      direction: "agent",
      source: `${row.source} · ${row.channel_id}`,
      private: true,
      redacted: !includeAgentDetails
    }));
    return [...messages, ...calls, ...agents]
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at) || right.id.localeCompare(left.id))
      .slice(0, boundedLimit);
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
    let normalized = "";
    try { normalized = normalizeNumber(value); } catch { normalized = ""; }
    const row = this.connection.prepare("SELECT contact_id FROM contact_points WHERE value=? OR value=?").get(normalized, String(value || "").trim()) as { contact_id: number } | undefined;
    return row ? row.contact_id : null;
  }

  // Contact policy (CLV-011)
  getContactPolicy(contactId: number): Record<string, unknown> {
    return (this.connection.prepare("SELECT * FROM contact_policy WHERE contact_id=?").get(contactId) as Record<string, unknown> | undefined)
      || { contact_id: contactId, trust_level: "unknown", allow_agent_messages: 1, allow_approval_requests: 0, allow_urgent_interrupts: 0, quiet_hours_override: 0, muted_until: null, blocked: 0 };
  }

  setContactPolicy(contactId: number, policy: Record<string, unknown>): Record<string, unknown> {
    const now = utcNow();
    const trust = String(policy.trust_level ?? "unknown");
    this.connection.prepare("INSERT INTO contact_policy(contact_id, trust_level, allow_agent_messages, allow_approval_requests, allow_urgent_interrupts, quiet_hours_override, muted_until, blocked, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET trust_level=excluded.trust_level, allow_agent_messages=excluded.allow_agent_messages, allow_approval_requests=excluded.allow_approval_requests, allow_urgent_interrupts=excluded.allow_urgent_interrupts, quiet_hours_override=excluded.quiet_hours_override, muted_until=excluded.muted_until, blocked=excluded.blocked, updated_at=excluded.updated_at")
      .run(contactId, trust, policy.allow_agent_messages ? 1 : 0, policy.allow_approval_requests ? 1 : 0, policy.allow_urgent_interrupts ? 1 : 0, policy.quiet_hours_override ? 1 : 0, policy.muted_until ? String(policy.muted_until) : null, policy.blocked ? 1 : 0, now, now);
    this.connection.prepare("UPDATE contacts SET trust_level=?, updated_at=? WHERE id=?").run(trust, now, contactId);
    return this.getContactPolicy(contactId);
  }

  contactAttentionDecision(value: string, nowValue = utcNow()): ContactPolicyDecision {
    let normalized = "";
    try { normalized = normalizeNumber(value); } catch { normalized = ""; }
    const point = this.connection.prepare("SELECT contact_id, blocked_at FROM contact_points WHERE value=? OR value=?").get(normalized, String(value || "").trim()) as { contact_id: number; blocked_at: string | null } | undefined;
    if (!point) return { allowed: true, reason: "unknown_contact", contact_id: null };
    const policy = this.getContactPolicy(point.contact_id);
    if (point.blocked_at || policy.blocked) return { allowed: false, reason: "contact_blocked", contact_id: point.contact_id };
    if (policy.muted_until && String(policy.muted_until) > nowValue) return { allowed: false, reason: "contact_muted", contact_id: point.contact_id };
    return { allowed: true, reason: "allowed", contact_id: point.contact_id };
  }

  agentContactPolicyDecision(source: string, kind: string, urgency: string, nowValue = utcNow()): ContactPolicyDecision {
    const contactId = this.resolveContactIdByValue(source);
    if (!contactId) return { allowed: true, reason: "unknown_source", contact_id: null };
    const policy = this.getContactPolicy(contactId);
    if (policy.blocked) return { allowed: false, reason: "contact_blocked", contact_id: contactId };
    if (policy.muted_until && String(policy.muted_until) > nowValue) return { allowed: false, reason: "contact_muted", contact_id: contactId };
    if (!policy.allow_agent_messages) return { allowed: false, reason: "agent_messages_disallowed", contact_id: contactId };
    if (kind.includes("approval") && !policy.allow_approval_requests) return { allowed: false, reason: "approval_requests_disallowed", contact_id: contactId };
    if (urgency === "urgent" && !policy.allow_urgent_interrupts) return { allowed: false, reason: "urgent_interrupts_disallowed", contact_id: contactId };
    return { allowed: true, reason: "allowed", contact_id: contactId };
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

  // --- Human Cards (work item 016, AGH-001) -----------------------------------

  humanCards(): HumanCardRow[] {
    return this.connection.prepare("SELECT * FROM human_cards ORDER BY alias").all() as unknown as HumanCardRow[];
  }

  humanCardByAlias(alias: string): HumanCardRow | undefined {
    const trimmed = String(alias || "").trim();
    if (!trimmed) return undefined;
    const exact = this.connection.prepare("SELECT * FROM human_cards WHERE alias=?").get(trimmed) as unknown as HumanCardRow | undefined;
    if (exact) return exact;
    // Single-operator default: any unconfigured `operator:*` role resolves to the
    // primary operator so the well-known aliases work without multi-operator setup.
    if (/^operator:/.test(trimmed)) return this.connection.prepare("SELECT * FROM human_cards WHERE alias='operator:primary'").get() as unknown as HumanCardRow | undefined;
    return undefined;
  }

  // Agent-facing resolution: redacted, with operator-private fields removed.
  resolveHumanCard(alias: string): ResolvedHumanCard | undefined {
    const row = this.humanCardByAlias(alias);
    if (!row) return undefined;
    const parseList = (value: string): string[] => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
    return {
      alias: String(alias).trim(),
      display_name: row.display_name,
      role: row.role,
      availability: row.availability,
      authority_scopes: parseList(row.authority_scopes),
      preferred_channels: parseList(row.preferred_channels),
      resolved_via: row.alias
    };
  }

  upsertHumanCard(input: HumanCardInput): HumanCardRow {
    const alias = String(input.alias || "").trim();
    if (!/^[a-z][a-z0-9_]*:[a-z0-9_]+$/.test(alias)) throw new Error("Human Card alias must look like `operator:primary`.");
    const now = utcNow();
    this.connection.prepare(`
      INSERT INTO human_cards(alias, display_name, role, availability, authority_scopes, preferred_channels, quiet_hours, redaction_profile, notes, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias) DO UPDATE SET
        display_name=excluded.display_name,
        role=excluded.role,
        availability=excluded.availability,
        authority_scopes=excluded.authority_scopes,
        preferred_channels=excluded.preferred_channels,
        quiet_hours=excluded.quiet_hours,
        redaction_profile=excluded.redaction_profile,
        notes=excluded.notes,
        updated_at=excluded.updated_at
    `).run(
      alias,
      (input.display_name || "").slice(0, 200),
      (input.role || "").slice(0, 80),
      (input.availability || "available").slice(0, 40),
      JSON.stringify(Array.isArray(input.authority_scopes) ? input.authority_scopes.map((scope) => String(scope).slice(0, 80)) : []),
      JSON.stringify(Array.isArray(input.preferred_channels) ? input.preferred_channels.map((channel) => String(channel).slice(0, 80)) : []),
      (input.quiet_hours || "").slice(0, 200),
      (input.redaction_profile || "desktop_full").slice(0, 60),
      (input.notes || "").slice(0, 2000),
      now,
      now
    );
    return this.connection.prepare("SELECT * FROM human_cards WHERE alias=?").get(alias) as unknown as HumanCardRow;
  }

  deleteHumanCard(alias: string): boolean {
    if (alias === "operator:primary") throw new Error("The primary operator card cannot be deleted.");
    return this.connection.prepare("DELETE FROM human_cards WHERE alias=?").run(String(alias || "").trim()).changes === 1;
  }

  private cardAuthorityScopes(row: HumanCardRow): string[] {
    try { const parsed = JSON.parse(row.authority_scopes); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  }

  humanCardsWithAuthority(scope: string): HumanCardRow[] {
    return this.humanCards().filter((row) => this.cardAuthorityScopes(row).includes(scope));
  }

  // Decide whether the human addressed by `alias` may approve `scope`. When not
  // granted, `escalate_to` lists the aliases that do hold it so the request can be
  // re-addressed or escalated (AGH-002).
  checkAuthority(alias: string, scope: string): AuthorityDecision {
    const addressed = String(alias || "").trim();
    const card = this.humanCardByAlias(addressed);
    const granted = card ? this.cardAuthorityScopes(card).includes(scope) : false;
    const escalateTo = granted ? [] : this.humanCardsWithAuthority(scope).map((row) => row.alias).filter((candidate) => candidate !== card?.alias);
    return { scope, addressed_alias: addressed, resolved_via: card?.alias ?? null, granted, escalate_to: escalateTo };
  }

  // --- Agent Identity Registry (work item 016, AGH-003) -----------------------

  agentIdentities(): AgentIdentityRow[] {
    return this.connection.prepare("SELECT * FROM agent_identities ORDER BY id").all() as unknown as AgentIdentityRow[];
  }

  agentIdentity(id: string): AgentIdentityRow | undefined {
    return this.connection.prepare("SELECT * FROM agent_identities WHERE id=?").get(String(id || "").trim()) as unknown as AgentIdentityRow | undefined;
  }

  // Auto-register an agent the first time it is seen, with restricted defaults
  // (trust_state 'unknown', no allowed channels/tools), and bump last_seen. Ties
  // agent-originated requests to a durable identity without operator setup.
  recordAgentIdentitySeen(id: string, sourceKind = "unknown"): AgentIdentityRow {
    const agentId = String(id || "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(agentId)) throw new Error("Invalid agent identity id.");
    const now = utcNow();
    this.connection.prepare(`
      INSERT INTO agent_identities(id, source_kind, last_seen_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
    `).run(agentId, sourceKind.slice(0, 40), now, now, now);
    return this.agentIdentity(agentId)!;
  }

  // Operator management: create or update governance fields for an agent. Does not
  // touch last_seen. Trust-state transition policy/audit is AGH-004.
  upsertAgentIdentity(input: AgentIdentityInput): AgentIdentityRow {
    const agentId = String(input.id || "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(agentId)) throw new Error("Invalid agent identity id.");
    const trustState = input.trust_state ?? "unknown";
    if (!isAgentTrustState(trustState)) throw new Error("Invalid agent trust state.");
    const now = utcNow();
    const existing = this.agentIdentity(agentId);
    const fromState = existing?.trust_state ?? "unknown";
    this.connection.prepare(`
      INSERT INTO agent_identities(id, display_name, source_kind, source_uri, owner, trust_state, default_risk_limit, allowed_channels, allowed_tools, escalation_alias, last_seen_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name=excluded.display_name,
        source_kind=excluded.source_kind,
        source_uri=excluded.source_uri,
        owner=excluded.owner,
        trust_state=excluded.trust_state,
        default_risk_limit=excluded.default_risk_limit,
        allowed_channels=excluded.allowed_channels,
        allowed_tools=excluded.allowed_tools,
        escalation_alias=excluded.escalation_alias,
        updated_at=excluded.updated_at
    `).run(
      agentId,
      (input.display_name || "").slice(0, 200),
      (input.source_kind || "unknown").slice(0, 40),
      (input.source_uri || "").slice(0, 400),
      (input.owner || "").slice(0, 200),
      trustState,
      (input.default_risk_limit || "normal").slice(0, 40),
      JSON.stringify(Array.isArray(input.allowed_channels) ? input.allowed_channels.map((channel) => String(channel).slice(0, 80)) : []),
      JSON.stringify(Array.isArray(input.allowed_tools) ? input.allowed_tools.map((tool) => String(tool).slice(0, 80)) : []),
      (input.escalation_alias || "").slice(0, 80),
      existing?.last_seen_at ?? null,
      existing?.created_at || now,
      now
    );
    // Any trust change made through management is audited (AGH-004).
    if (fromState !== trustState) this.recordTrustChange(agentId, fromState, trustState, "operator update", now);
    return this.agentIdentity(agentId)!;
  }

  private recordTrustChange(agentId: string, fromState: string, toState: string, reason: string, now: string): void {
    this.connection.prepare("INSERT INTO agent_trust_events(agent_id, from_state, to_state, reason, changed_at) VALUES(?, ?, ?, ?, ?)")
      .run(agentId, fromState, toState, reason.slice(0, 500), now);
  }

  // Explicit, audited trust transition (AGH-004). The identity must exist.
  setAgentTrustState(id: string, toState: string, reason = ""): AgentIdentityRow {
    const agentId = String(id || "").trim();
    if (!isAgentTrustState(toState)) throw new Error("Invalid agent trust state.");
    const existing = this.agentIdentity(agentId);
    if (!existing) throw new Error("Agent identity not found.");
    if (existing.trust_state === toState) return existing;
    const now = utcNow();
    this.connection.prepare("UPDATE agent_identities SET trust_state=?, updated_at=? WHERE id=?").run(toState, now, agentId);
    this.recordTrustChange(agentId, existing.trust_state, toState, reason, now);
    return this.agentIdentity(agentId)!;
  }

  agentTrustEvents(id?: string): AgentTrustEventRow[] {
    if (id) return this.connection.prepare("SELECT * FROM agent_trust_events WHERE agent_id=? ORDER BY changed_at DESC, id DESC").all(String(id).trim()) as unknown as AgentTrustEventRow[];
    return this.connection.prepare("SELECT * FROM agent_trust_events ORDER BY changed_at DESC, id DESC LIMIT 500").all() as unknown as AgentTrustEventRow[];
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
