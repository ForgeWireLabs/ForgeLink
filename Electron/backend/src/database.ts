import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CallRecordInput, CallStatus, CallStatusUpdate } from "./channels";
import { normalizeNumber, utcNow } from "./phone";

export const CURRENT_SCHEMA_VERSION = 21;

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

export interface EvidencePack {
  summary: string;
  affected_resources: string[];
  diff_summary: string;
  proposed_operation: string;
  checks: string[];
  rollback_plan: string;
  links: string[];
  limitations: string;
  redaction_profile: string;
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
  intent?: string;
  requested_action?: string;
  reason_for_interrupt?: string;
  risk?: string;
  required_authority?: string;
  to_human?: string;
  affected_resources?: string[];
  timeout_behavior?: string;
  deny_behavior?: string;
  decision_options?: AgentAction[];
  template_id?: string;
  evidence_pack?: EvidencePack;
  interruption_policy?: string;
  escalation_behavior?: string;
  expected_response_time?: string;
  no_response_behavior?: string;
  can_batch?: boolean;
  can_wait_until?: string | null;
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
  intent: string;
  requested_action: string;
  reason_for_interrupt: string;
  risk: string;
  required_authority: string;
  to_human: string;
  affected_resources: string;
  timeout_behavior: string;
  deny_behavior: string;
  decision_options: string;
  template_id: string;
  evidence_pack: string;
  interruption_policy: string;
  escalation_behavior: string;
  expected_response_time: string;
  no_response_behavior: string;
  can_batch: number;
  can_wait_until: string | null;
}

export interface AgentMessageEventRow {
  id: number;
  message_id: string;
  event_type: string;
  detail: string;
  created_at: string;
}

// Decision Records (work item 016, AGH-013): persist what the operator saw and
// decided so a completed decision can be replayed and integrity-checked later.
// The request and evidence hashes bind the record to exactly what was approved;
// the decision hash makes a record's own fields tamper-evident.
export interface DecisionRecordInput {
  approval_request_id: string;
  decision: string;              // option id chosen, e.g. "approve" or "deny"
  selected_options?: string[];
  operator_alias?: string;       // Human Card alias; defaults to operator:primary
  device_id?: string;
  decision_comment?: string;
}

export interface DecisionRecordRow {
  id: string;
  approval_request_id: string;
  operator_alias: string;
  device_id: string;
  decision: string;
  selected_options: string;      // JSON array text
  decision_comment: string;
  authority_grant: string;       // authority the operator exercised, if any
  request_hash: string;
  evidence_hash: string;
  decision_hash: string;
  decided_at: string;
}

// Terminal operator decisions that grant no authority. Anything else (an explicit
// approve, or a custom approval option) is treated as granting the request's
// required authority.
const DENIAL_DECISIONS = new Set(["deny", "dismiss", "reject", "decline", "cancel"]);

// Tamper-evident local audit chain (work item 016, AGH-016): an append-only,
// hash-linked log of governance records (approval requests, evidence packs,
// decisions, outcomes). Each entry commits to the previous entry's hash, so a
// later edit to any record or entry breaks the chain and is detectable. This is a
// lightweight local integrity check, not blockchain or remote attestation.
export interface AuditChainRow {
  seq: number;
  entry_type: string;          // approval_request | evidence_pack | decision | outcome
  ref_id: string;              // id of the referenced record
  approval_request_id: string; // owning approval request, for per-request replay
  payload_hash: string;        // hash of the referenced record's canonical content
  prev_hash: string;           // entry_hash of the previous chain entry ("" at genesis)
  entry_hash: string;          // hash committing to this entry and prev_hash
  created_at: string;
}

export interface AuditChainVerification {
  ok: boolean;
  length: number;
  broken_at: number | null;    // seq of the first broken entry, if any
  reason: string;              // "" | broken_link | tampered_entry | tampered_payload
}

// Approval outcomes (work item 016, AGH-015): after a decision, the agent reports
// what actually happened so dangling approvals are visible and scope mismatches are
// flagged. Outcomes are committed to the audit chain (AGH-016).
export interface ApprovalOutcomeInput {
  approval_request_id: string;
  outcome_state: string;
  outcome_summary?: string;
  reported_resources?: string[];
  source?: string;
}

export interface ApprovalOutcomeRow {
  id: string;
  approval_request_id: string;
  source: string;
  outcome_state: string;
  outcome_summary: string;
  scope_match: number;          // 0 when the agent acted outside the approved scope
  reported_resources: string;   // JSON array text of resources actually touched
  reported_at: string;
}

// Lifecycle states an agent may report after approval.
const OUTCOME_STATES = new Set(["action_started", "action_succeeded", "action_failed", "expired_before_use", "used_modified_scope", "cancelled"]);
// Terminal states close out an approval; their absence means it is still dangling.
const TERMINAL_OUTCOME_STATES = ["action_succeeded", "action_failed", "cancelled", "expired_before_use"];

// Decision memory (work item 016, AGH-014): repeated operator decisions become
// *suggested* policy the operator must explicitly confirm. A confirmed rule is
// advisory only — it is never read by the approval path and never auto-decides or
// expands agent authority.
export interface DecisionMemorySuggestion {
  source: string;
  template_id: string;
  required_authority: string;
  suggested_decision: string;    // approve | deny
  occurrences: number;
  last_decided_at: string;
  requires_confirmation: true;
}

export interface DecisionMemoryRuleInput {
  source: string;
  template_id: string;
  required_authority: string;
  suggested_decision: string;
  note?: string;
  occurrences?: number;
}

export interface DecisionMemoryRuleRow {
  id: string;
  source: string;
  template_id: string;
  required_authority: string;
  suggested_decision: string;
  occurrences: number;
  status: string;                // confirmed | dismissed
  note: string;
  created_at: string;
  updated_at: string;
}

const MEMORY_DECISIONS = new Set(["approve", "deny"]);
// A pattern must repeat at least this many times before it is suggested as policy.
const DECISION_MEMORY_MIN_OCCURRENCES = 3;

// Approval replay (work item 016, AGH-017): a derived, read-only view that
// assembles the full lifecycle of an approval into ordered steps — request
// received, risk classified, evidence shown, decision made, action reported, and
// final state — so the operator can inspect exactly what happened. The replay
// redacts according to operator policy: only the `desktop_full` redaction profile
// shows private detail (message body, evidence-pack contents, decision/outcome
// comments); every other surface (mobile lock screen, SMS fallback, etc.) gets a
// redacted view.
export type ReplayStepKind = "request_received" | "risk_classified" | "evidence_shown" | "decision_made" | "action_reported" | "final_state";

export interface ReplayStep {
  step: ReplayStepKind;
  at: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface ApprovalReplay {
  approval_request_id: string;
  redaction_profile: string;
  redacted: boolean;            // true when private detail was withheld
  decided: boolean;
  final_state: string;
  steps: ReplayStep[];
  audit: AuditChainRow[];
  audit_verification: AuditChainVerification;
}

// The one redaction profile that shows full private detail. Any other profile is
// treated as redacted. Full profile semantics (AGH-022) build on this later.
const FULL_REDACTION_PROFILE = "desktop_full";

// Communication firewall (work item 016, AGH-019): operator-defined policy that
// governs how agents may communicate with humans/external channels, enforced
// before channel dispatch. A rule's `rule_kind` is the decision it applies:
//   block           — refuse the external message outright;
//   draft_only      — agent may only draft; the operator must send (the default);
//   require_approval — park as a draft that needs explicit operator approval;
//   allow           — explicit direct-send authority (audited).
export const FIREWALL_RULE_KINDS = ["block", "draft_only", "require_approval", "allow"] as const;
export type FirewallRuleKind = typeof FIREWALL_RULE_KINDS[number];
export function isFirewallRuleKind(value: string): value is FirewallRuleKind {
  return (FIREWALL_RULE_KINDS as readonly string[]).includes(value);
}

// Channel kinds a firewall rule may scope. Drafts are only produced for the
// messageable kinds (see DRAFTABLE_CHANNEL_KINDS); a rule can still `block` a
// non-messageable kind (for example "agents may never call phone numbers").
export const OUTBOUND_CHANNEL_KINDS = ["sms", "mms", "voice", "email"] as const;
const DRAFTABLE_CHANNEL_KINDS = new Set(["sms", "mms"]);
// Kinds ForgeLink can actually dispatch today.
const SENDABLE_CHANNEL_KINDS = new Set(["sms", "mms"]);
// Default posture for external agent communication when no rule matches:
// draft-don't-send (AGH-020).
const DEFAULT_FIREWALL_DECISION: FirewallRuleKind = "draft_only";

export interface CommunicationFirewallRuleInput {
  id?: string;
  agent_id?: string;
  contact_id?: number | null;
  channel_kind?: string;
  rule_kind: string;
  policy?: Record<string, unknown>;
  enabled?: boolean;
}

export interface CommunicationFirewallRuleRow {
  id: string;
  agent_id: string;            // "" matches any agent
  contact_id: number | null;   // null matches any contact
  channel_kind: string;        // "" matches any channel kind
  rule_kind: string;
  policy_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface FirewallEvaluation {
  decision: FirewallRuleKind;
  matched_rule_id: string | null;  // null => default posture, no rule matched
  reason: string;
  sendable: boolean;               // whether ForgeLink can dispatch this channel kind
}

// Draft-don't-send (work item 016, AGH-020): an agent-drafted external message
// held for explicit operator review/edit/approve/deny. The default firewall
// posture parks every external message here rather than sending it.
export interface OutboundDraftInput {
  agent_id: string;
  channel_id: string;
  channel_kind?: string;
  to: string;
  body?: string;
  media_urls?: string[];
}

export interface OutboundDraftRow {
  id: string;
  agent_id: string;
  channel_id: string;
  channel_kind: string;
  to_number: string;
  contact_id: number | null;
  body: string;
  media_urls: string;
  status: string;              // draft | sent | denied | failed
  firewall_decision: string;
  reason: string;
  provider_message_id: string;
  last_error: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

export interface OutboundDraftEventRow {
  id: number;
  draft_id: string;
  event_type: string;
  detail: string;
  created_at: string;
}

// Raised by createOutboundDraft when a `block` rule applies, so the route can
// answer 403 without creating a draft.
export class FirewallBlockedError extends Error {
  readonly reason = "firewall_blocked";
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
      if (version === 13) {
        // Structured approval requests (work item 016, AGH-006; schema v14 per decision 0011).
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
          ALTER TABLE agent_messages ADD COLUMN intent TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN requested_action TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN reason_for_interrupt TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN risk TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN required_authority TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN to_human TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN affected_resources TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE agent_messages ADD COLUMN timeout_behavior TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN deny_behavior TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN decision_options TEXT NOT NULL DEFAULT '[]';
        `);
        version = 14;
        this.connection.exec("PRAGMA user_version=14");
      }
      if (version === 14) {
        // Evidence packs for approval requests (work item 016, AGH-007; schema v15 per decision 0011).
        this.connection.exec(`
          ALTER TABLE agent_messages ADD COLUMN template_id TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN evidence_pack TEXT NOT NULL DEFAULT '{}';
        `);
        version = 15;
        this.connection.exec("PRAGMA user_version=15");
      }
      if (version === 15) {
        // Risk routing, timeout/escalation, and etiquette fields (work item 016, AGH-010/011/012; schema v16 per decision 0011).
        this.connection.exec(`
          ALTER TABLE agent_messages ADD COLUMN interruption_policy TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN escalation_behavior TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN expected_response_time TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN no_response_behavior TEXT NOT NULL DEFAULT '';
          ALTER TABLE agent_messages ADD COLUMN can_batch INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE agent_messages ADD COLUMN can_wait_until TEXT;
          CREATE TABLE IF NOT EXISTS agent_message_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_agent_message_events_message ON agent_message_events(message_id, created_at DESC);
        `);
        version = 16;
        this.connection.exec("PRAGMA user_version=16");
      }
      if (version === 16) {
        // Decision Records (work item 016, AGH-013; schema v17 per decision 0011).
        // Persist what the operator saw and decided — request/evidence hashes,
        // operator and device identity, decision, selected options, comment, and
        // resulting authority grant — so a completed decision can be replayed and
        // integrity-checked later.
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS decision_records (
            id TEXT PRIMARY KEY,
            approval_request_id TEXT NOT NULL,
            operator_alias TEXT NOT NULL,
            device_id TEXT NOT NULL DEFAULT '',
            decision TEXT NOT NULL,
            selected_options TEXT NOT NULL DEFAULT '[]',
            decision_comment TEXT NOT NULL DEFAULT '',
            authority_grant TEXT NOT NULL DEFAULT '',
            request_hash TEXT NOT NULL,
            evidence_hash TEXT NOT NULL,
            decision_hash TEXT NOT NULL,
            decided_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_decision_records_request ON decision_records(approval_request_id, decided_at DESC);
        `);
        version = 17;
        this.connection.exec("PRAGMA user_version=17");
      }
      if (version === 17) {
        // Tamper-evident local audit chain (work item 016, AGH-016; schema v18 per
        // decision 0011). Append-only, hash-linked log of governance records so a
        // later edit to any record or chain entry is detectable after the fact.
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS audit_chain (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            ref_id TEXT NOT NULL,
            approval_request_id TEXT NOT NULL DEFAULT '',
            payload_hash TEXT NOT NULL,
            prev_hash TEXT NOT NULL DEFAULT '',
            entry_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_audit_chain_request ON audit_chain(approval_request_id, seq);
        `);
        version = 18;
        this.connection.exec("PRAGMA user_version=18");
      }
      if (version === 18) {
        // Approval outcomes (work item 016, AGH-015; schema v19 per decision 0011).
        // Agents report what happened after a decision so dangling approvals are
        // visible and scope mismatches are flagged.
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS approval_outcomes (
            id TEXT PRIMARY KEY,
            approval_request_id TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '',
            outcome_state TEXT NOT NULL,
            outcome_summary TEXT NOT NULL DEFAULT '',
            scope_match INTEGER NOT NULL DEFAULT 1,
            reported_resources TEXT NOT NULL DEFAULT '[]',
            reported_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_approval_outcomes_request ON approval_outcomes(approval_request_id, reported_at DESC);
        `);
        version = 19;
        this.connection.exec("PRAGMA user_version=19");
      }
      if (version === 19) {
        // Decision memory rules (work item 016, AGH-014; schema v20 per decision 0011).
        // Operator-confirmed (or dismissed) acknowledgements of repeated decision
        // patterns. Advisory only; never read by the approval path.
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS decision_memory_rules (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT '',
            template_id TEXT NOT NULL DEFAULT '',
            required_authority TEXT NOT NULL DEFAULT '',
            suggested_decision TEXT NOT NULL,
            occurrences INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_memory_pattern ON decision_memory_rules(source, template_id, required_authority, suggested_decision);
        `);
        version = 20;
        this.connection.exec("PRAGMA user_version=20");
      }
      if (version === 20) {
        // Communication firewall + draft-don't-send (work item 016, AGH-019/020;
        // schema v21 per decision 0011). `communication_firewall_rules` is the
        // operator-defined policy enforced before an agent's external message is
        // dispatched; `agent_outbound_drafts` parks agent-drafted external messages
        // for explicit operator review/edit/approve/deny; `outbound_draft_events`
        // is the audit log of each draft's lifecycle.
        this.connection.exec(`
          CREATE TABLE IF NOT EXISTS communication_firewall_rules (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL DEFAULT '',
            contact_id INTEGER,
            channel_kind TEXT NOT NULL DEFAULT '',
            rule_kind TEXT NOT NULL,
            policy_json TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_firewall_rules_match ON communication_firewall_rules(agent_id, channel_kind, enabled);
          CREATE TABLE IF NOT EXISTS agent_outbound_drafts (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL DEFAULT '',
            channel_id TEXT NOT NULL DEFAULT '',
            channel_kind TEXT NOT NULL DEFAULT 'sms',
            to_number TEXT NOT NULL DEFAULT '',
            contact_id INTEGER,
            body TEXT NOT NULL DEFAULT '',
            media_urls TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            firewall_decision TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            provider_message_id TEXT NOT NULL DEFAULT '',
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            decided_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_outbound_drafts_status ON agent_outbound_drafts(status, created_at DESC);
          CREATE TABLE IF NOT EXISTS outbound_draft_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_outbound_draft_events_draft ON outbound_draft_events(draft_id, created_at DESC);
        `);
        version = 21;
        this.connection.exec("PRAGMA user_version=21");
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
      decision_records: this.connection.prepare("SELECT * FROM decision_records ORDER BY decided_at, id").all(),
      audit_chain: this.connection.prepare("SELECT * FROM audit_chain ORDER BY seq").all(),
      approval_outcomes: this.connection.prepare("SELECT * FROM approval_outcomes ORDER BY reported_at, id").all(),
      decision_memory_rules: this.connection.prepare("SELECT * FROM decision_memory_rules ORDER BY updated_at, id").all(),
      communication_firewall_rules: this.connection.prepare("SELECT * FROM communication_firewall_rules ORDER BY updated_at, id").all(),
      agent_outbound_drafts: this.connection.prepare("SELECT * FROM agent_outbound_drafts ORDER BY created_at, id").all(),
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
      INSERT INTO agent_messages(
        id, channel_id, source, kind, urgency, title, body, actions, status, created_at, expires_at,
        intent, requested_action, reason_for_interrupt, risk, required_authority, to_human,
        affected_resources, timeout_behavior, deny_behavior, decision_options, template_id, evidence_pack,
        interruption_policy, escalation_behavior, expected_response_time, no_response_behavior, can_batch, can_wait_until
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.channel_id,
      message.source,
      message.kind,
      message.urgency,
      message.title,
      message.body,
      JSON.stringify(message.actions || []),
      status,
      createdAt,
      message.expires_at || null,
      message.intent || "",
      message.requested_action || "",
      message.reason_for_interrupt || "",
      message.risk || "",
      message.required_authority || "",
      message.to_human || "",
      JSON.stringify(message.affected_resources || []),
      message.timeout_behavior || "",
      message.deny_behavior || "",
      JSON.stringify(message.decision_options || message.actions || []),
      message.template_id || "",
      JSON.stringify(message.evidence_pack || {}),
      message.interruption_policy || "",
      message.escalation_behavior || "",
      message.expected_response_time || "",
      message.no_response_behavior || "",
      message.can_batch ? 1 : 0,
      message.can_wait_until || null
    );
    if (status === "expired") {
      this.connection.prepare("INSERT INTO agent_message_events(message_id, event_type, detail, created_at) VALUES(?, 'expired', ?, ?)")
        .run(message.id, JSON.stringify({ timeout_behavior: message.timeout_behavior || "", no_response_behavior: message.no_response_behavior || "", escalation_behavior: message.escalation_behavior || "" }), createdAt);
    }
    // Commit governed approval requests (and their evidence packs) to the
    // tamper-evident audit chain (AGH-016) so the full lifecycle is integrity-checkable.
    if (message.kind === "approval_request") {
      const row = this.connection.prepare("SELECT * FROM agent_messages WHERE id=?").get(message.id) as unknown as AgentMessageRow;
      this.appendAuditChainEntry("approval_request", row.id, row.id, this.requestHash(row), createdAt);
      if (row.evidence_pack && row.evidence_pack !== "{}") this.appendAuditChainEntry("evidence_pack", row.id, row.id, this.evidenceHashOf(row), createdAt);
    }
    return this.agentMessage(message.id)!;
  }

  agentMessageEvents(messageId?: string): AgentMessageEventRow[] {
    if (messageId) return this.connection.prepare("SELECT * FROM agent_message_events WHERE message_id=? ORDER BY created_at DESC, id DESC").all(messageId) as unknown as AgentMessageEventRow[];
    return this.connection.prepare("SELECT * FROM agent_message_events ORDER BY created_at DESC, id DESC LIMIT 500").all() as unknown as AgentMessageEventRow[];
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
    const now = utcNow();
    const expiring = this.connection.prepare("SELECT id, timeout_behavior, no_response_behavior, escalation_behavior FROM agent_messages WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('unread', 'read')").all(now) as Array<{ id: string; timeout_behavior: string; no_response_behavior: string; escalation_behavior: string }>;
    this.connection.prepare("UPDATE agent_messages SET status='expired' WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('unread', 'read')").run(now);
    for (const row of expiring) {
      this.connection.prepare("INSERT INTO agent_message_events(message_id, event_type, detail, created_at) VALUES(?, 'expired', ?, ?)")
        .run(row.id, JSON.stringify({ timeout_behavior: row.timeout_behavior, no_response_behavior: row.no_response_behavior, escalation_behavior: row.escalation_behavior }), now);
    }
  }

  // --- Decision Records (work item 016, AGH-013) ------------------------------

  // Stable hash over the governed request the operator decided on, so a stored
  // decision can be replayed and checked against the request later. Built from a
  // fixed field order joined by a space separator.
  private requestHash(message: AgentMessageRow): string {
    const canonical = [
      message.id, message.channel_id, message.source, message.kind, message.urgency,
      message.title, message.body, message.intent, message.requested_action,
      message.reason_for_interrupt, message.risk, message.required_authority,
      message.to_human, message.affected_resources, message.timeout_behavior,
      message.deny_behavior, message.decision_options, message.expected_response_time,
      message.no_response_behavior, String(message.can_batch), message.can_wait_until || "",
      message.expires_at || "", message.created_at
    ];
    return createHash("sha256").update(canonical.join("\u0000")).digest("hex");
  }

  // Hash of the evidence pack the operator reviewed. Stored text is hashed as-is so
  // any later edit to the pack changes the hash.
  private evidenceHashOf(message: AgentMessageRow): string {
    return createHash("sha256").update(message.evidence_pack || "{}").digest("hex");
  }

  // Decision hash formula (shipped in v17, AGH-013). Kept as one helper so the
  // write path and the audit-chain verifier compute it identically.
  private decisionHashOf(record: { id: string; approval_request_id: string; request_hash: string; evidence_hash: string; decision: string; selected_options: string; operator_alias: string; device_id: string; authority_grant: string; decided_at: string }): string {
    // NUL separator matches the shipped v17 (AGH-013) decision-hash formula so
    // existing decision records still verify against the chain.
    return createHash("sha256")
      .update([record.id, record.approval_request_id, record.request_hash, record.evidence_hash, record.decision, record.selected_options, record.operator_alias, record.device_id, record.authority_grant, record.decided_at].join("\u0000"))
      .digest("hex");
  }

  recordDecision(input: DecisionRecordInput): DecisionRecordRow {
    const message = this.agentMessage(input.approval_request_id);
    if (!message) throw new Error("Agent message not found.");
    const decision = String(input.decision || "").trim();
    if (!decision) throw new Error("Decision is required.");
    // Resolve the deciding operator against Human Cards (single-operator default).
    const operatorAlias = this.humanCardByAlias(input.operator_alias || "operator:primary")?.alias || "operator:primary";
    const deviceId = String(input.device_id || "").trim();
    const comment = String(input.decision_comment || "").trim();
    const selectedOptions = (input.selected_options && input.selected_options.length ? input.selected_options : [decision]).map((option) => String(option));
    const denied = DENIAL_DECISIONS.has(decision.toLowerCase());
    // Authority is granted only on a non-denial decision, and only the authority
    // the request itself declared — a decision never invents new authority.
    const authorityGrant = !denied && message.required_authority ? message.required_authority : "";
    const requestHash = this.requestHash(message);
    const evidenceHash = this.evidenceHashOf(message);
    const decidedAt = utcNow();
    const id = randomUUID();
    const decisionHash = createHash("sha256")
      .update([id, message.id, requestHash, evidenceHash, decision, JSON.stringify(selectedOptions), operatorAlias, deviceId, authorityGrant, decidedAt].join("\u0000"))
      .digest("hex");
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.prepare(`
        INSERT INTO decision_records(
          id, approval_request_id, operator_alias, device_id, decision, selected_options,
          decision_comment, authority_grant, request_hash, evidence_hash, decision_hash, decided_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, message.id, operatorAlias, deviceId, decision, JSON.stringify(selectedOptions), comment, authorityGrant, requestHash, evidenceHash, decisionHash, decidedAt);
      this.connection.prepare("INSERT INTO agent_message_events(message_id, event_type, detail, created_at) VALUES(?, 'decision', ?, ?)")
        .run(message.id, JSON.stringify({ decision, operator_alias: operatorAlias, decision_record_id: id, authority_grant: authorityGrant }), decidedAt);
      // Commit the decision to the tamper-evident audit chain (AGH-016).
      this.appendAuditChainEntry("decision", id, message.id, decisionHash, decidedAt);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return this.decisionRecord(id)!;
  }

  decisionRecord(id: string): DecisionRecordRow | undefined {
    return this.connection.prepare("SELECT * FROM decision_records WHERE id=?").get(id) as unknown as DecisionRecordRow | undefined;
  }

  decisionRecords(requestId?: string): DecisionRecordRow[] {
    if (requestId) return this.connection.prepare("SELECT * FROM decision_records WHERE approval_request_id=? ORDER BY decided_at DESC, id DESC").all(requestId) as unknown as DecisionRecordRow[];
    return this.connection.prepare("SELECT * FROM decision_records ORDER BY decided_at DESC, id DESC LIMIT 500").all() as unknown as DecisionRecordRow[];
  }

  // Latest decision for a request, used to replay what the operator decided.
  decisionForRequest(requestId: string): DecisionRecordRow | undefined {
    return this.connection.prepare("SELECT * FROM decision_records WHERE approval_request_id=? ORDER BY decided_at DESC, id DESC LIMIT 1").get(requestId) as unknown as DecisionRecordRow | undefined;
  }

  // --- Tamper-evident audit chain (work item 016, AGH-016) --------------------

  // Hash committing to one chain entry and the previous entry's hash, so editing
  // any earlier entry invalidates every entry after it.
  private auditEntryHash(entryType: string, refId: string, approvalRequestId: string, payloadHash: string, prevHash: string, createdAt: string): string {
    return createHash("sha256").update([entryType, refId, approvalRequestId, payloadHash, prevHash, createdAt].join(" ")).digest("hex");
  }

  // Append-only: link a new governance record into the chain. Callers run inside a
  // transaction; the previous entry's hash is read under that lock.
  private appendAuditChainEntry(entryType: string, refId: string, approvalRequestId: string, payloadHash: string, at: string): void {
    const prev = (this.connection.prepare("SELECT entry_hash FROM audit_chain ORDER BY seq DESC LIMIT 1").get() as { entry_hash: string } | undefined)?.entry_hash || "";
    const entryHash = this.auditEntryHash(entryType, refId, approvalRequestId, payloadHash, prev, at);
    this.connection.prepare("INSERT INTO audit_chain(entry_type, ref_id, approval_request_id, payload_hash, prev_hash, entry_hash, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .run(entryType, refId, approvalRequestId, payloadHash, prev, entryHash, at);
  }

  auditChain(approvalRequestId?: string): AuditChainRow[] {
    if (approvalRequestId) return this.connection.prepare("SELECT * FROM audit_chain WHERE approval_request_id=? ORDER BY seq ASC").all(approvalRequestId) as unknown as AuditChainRow[];
    return this.connection.prepare("SELECT * FROM audit_chain ORDER BY seq ASC").all() as unknown as AuditChainRow[];
  }

  // Recompute the payload hash from the live source record so a later edit to that
  // record (not just the chain entry) is detected. Returns null when the source
  // record is gone (for example after retention deleted the agent message), which
  // is not treated as tampering.
  private livePayloadHash(entry: AuditChainRow): string | null {
    if (entry.entry_type === "approval_request" || entry.entry_type === "evidence_pack") {
      const message = this.connection.prepare("SELECT * FROM agent_messages WHERE id=?").get(entry.ref_id) as unknown as AgentMessageRow | undefined;
      if (!message) return null;
      return entry.entry_type === "approval_request" ? this.requestHash(message) : this.evidenceHashOf(message);
    }
    if (entry.entry_type === "decision") {
      const record = this.decisionRecord(entry.ref_id);
      if (!record) return null;
      return this.decisionHashOf(record);
    }
    if (entry.entry_type === "outcome") {
      const outcome = this.connection.prepare("SELECT * FROM approval_outcomes WHERE id=?").get(entry.ref_id) as unknown as ApprovalOutcomeRow | undefined;
      if (!outcome) return null;
      return this.outcomeHashOf(outcome);
    }
    return null;
  }

  // Hash over the reported outcome, used as its audit-chain payload so a later edit
  // to a reported outcome is detected.
  private outcomeHashOf(outcome: ApprovalOutcomeRow): string {
    return createHash("sha256")
      .update([outcome.id, outcome.approval_request_id, outcome.source, outcome.outcome_state, String(outcome.scope_match), outcome.reported_resources, outcome.outcome_summary, outcome.reported_at].join(" "))
      .digest("hex");
  }

  // Walk the chain in order and confirm each entry links to the previous, each
  // entry hash still matches its fields, and each payload still matches its live
  // record. Returns the first break, if any.
  verifyAuditChain(): AuditChainVerification {
    const entries = this.auditChain();
    let prev = "";
    for (const entry of entries) {
      if (entry.prev_hash !== prev) return { ok: false, length: entries.length, broken_at: entry.seq, reason: "broken_link" };
      if (this.auditEntryHash(entry.entry_type, entry.ref_id, entry.approval_request_id, entry.payload_hash, entry.prev_hash, entry.created_at) !== entry.entry_hash) {
        return { ok: false, length: entries.length, broken_at: entry.seq, reason: "tampered_entry" };
      }
      const live = this.livePayloadHash(entry);
      if (live !== null && live !== entry.payload_hash) return { ok: false, length: entries.length, broken_at: entry.seq, reason: "tampered_payload" };
      prev = entry.entry_hash;
    }
    return { ok: true, length: entries.length, broken_at: null, reason: "" };
  }

  // --- Approval outcomes (work item 016, AGH-015) -----------------------------

  recordOutcome(input: ApprovalOutcomeInput): ApprovalOutcomeRow {
    const message = this.agentMessage(input.approval_request_id);
    if (!message) throw new Error("Agent message not found.");
    const state = String(input.outcome_state || "").trim();
    if (!OUTCOME_STATES.has(state)) throw new Error("Unsupported outcome state.");
    const reportedResources = (input.reported_resources || []).map((resource) => String(resource));
    const approvedResources = JSON.parse(message.affected_resources || "[]") as string[];
    // Scope match fails when the agent declares modified scope, or when a reported
    // resource was not part of what the operator approved.
    const withinApproved = reportedResources.every((resource) => approvedResources.includes(resource));
    const scopeMatch = state === "used_modified_scope" || !withinApproved ? 0 : 1;
    const id = randomUUID();
    const reportedAt = utcNow();
    const source = String(input.source || message.source || "").trim();
    const summary = String(input.outcome_summary || "").slice(0, 2000);
    const reportedResourcesJson = JSON.stringify(reportedResources);
    const outcomeHash = this.outcomeHashOf({ id, approval_request_id: message.id, source, outcome_state: state, outcome_summary: summary, scope_match: scopeMatch, reported_resources: reportedResourcesJson, reported_at: reportedAt });
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.prepare("INSERT INTO approval_outcomes(id, approval_request_id, source, outcome_state, outcome_summary, scope_match, reported_resources, reported_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, message.id, source, state, summary, scopeMatch, reportedResourcesJson, reportedAt);
      this.connection.prepare("INSERT INTO agent_message_events(message_id, event_type, detail, created_at) VALUES(?, 'outcome', ?, ?)")
        .run(message.id, JSON.stringify({ outcome_state: state, scope_match: scopeMatch, outcome_id: id }), reportedAt);
      // Commit the outcome to the tamper-evident audit chain (AGH-016).
      this.appendAuditChainEntry("outcome", id, message.id, outcomeHash, reportedAt);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return this.connection.prepare("SELECT * FROM approval_outcomes WHERE id=?").get(id) as unknown as ApprovalOutcomeRow;
  }

  approvalOutcomes(requestId?: string): ApprovalOutcomeRow[] {
    if (requestId) return this.connection.prepare("SELECT * FROM approval_outcomes WHERE approval_request_id=? ORDER BY reported_at DESC, id DESC").all(requestId) as unknown as ApprovalOutcomeRow[];
    return this.connection.prepare("SELECT * FROM approval_outcomes ORDER BY reported_at DESC, id DESC LIMIT 500").all() as unknown as ApprovalOutcomeRow[];
  }

  // Approvals that were granted authority but have not reported a terminal outcome,
  // so the operator can see actions that may have stalled or gone unreported.
  danglingApprovals(): AgentMessageRow[] {
    const placeholders = TERMINAL_OUTCOME_STATES.map(() => "?").join(", ");
    return this.connection.prepare(`
      SELECT DISTINCT m.* FROM agent_messages m
      JOIN decision_records d ON d.approval_request_id = m.id AND d.authority_grant != ''
      WHERE NOT EXISTS (
        SELECT 1 FROM approval_outcomes o
        WHERE o.approval_request_id = m.id AND o.outcome_state IN (${placeholders})
      )
      ORDER BY m.created_at DESC, m.id DESC
    `).all(...TERMINAL_OUTCOME_STATES) as unknown as AgentMessageRow[];
  }

  // Outcomes where the agent acted outside the approved scope; surfaced as audit
  // issues for the operator.
  scopeMismatchOutcomes(): ApprovalOutcomeRow[] {
    return this.connection.prepare("SELECT * FROM approval_outcomes WHERE scope_match=0 ORDER BY reported_at DESC, id DESC LIMIT 500").all() as unknown as ApprovalOutcomeRow[];
  }

  // --- Approval replay (work item 016, AGH-017) -------------------------------

  // Assemble the lifecycle of one approval into ordered steps. Risk classification
  // is read from the values persisted at submission (AGH-010/011/012), so the
  // replay reflects what the operator was actually shown rather than a recomputed
  // guess. When `redactionProfile` is omitted, the primary operator card's profile
  // is used; passing a non-`desktop_full` profile previews a redacted surface.
  approvalReplay(requestId: string, redactionProfile?: string): ApprovalReplay | undefined {
    const message = this.agentMessage(requestId);
    if (!message) return undefined;
    const profile = (redactionProfile && redactionProfile.trim())
      || this.humanCardByAlias("operator:primary")?.redaction_profile
      || FULL_REDACTION_PROFILE;
    const full = profile === FULL_REDACTION_PROFILE;
    const parseArray = (value: string): string[] => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
    const steps: ReplayStep[] = [];

    // 1. Request received.
    steps.push({
      step: "request_received",
      at: message.created_at,
      summary: `${message.kind.replace(/_/g, " ")} from ${message.source}`,
      detail: {
        id: message.id,
        channel_id: message.channel_id,
        source: message.source,
        kind: message.kind,
        urgency: message.urgency,
        title: message.title,
        intent: message.intent,
        requested_action: message.requested_action,
        required_authority: message.required_authority,
        to_human: message.to_human,
        affected_resources: parseArray(message.affected_resources),
        ...(full ? { body: message.body, reason_for_interrupt: message.reason_for_interrupt } : {})
      }
    });

    // 2. Risk classified (persisted at submission).
    steps.push({
      step: "risk_classified",
      at: message.created_at,
      summary: message.interruption_policy ? `${message.risk || "unclassified"} -> ${message.interruption_policy}` : (message.risk || "unclassified"),
      detail: {
        risk: message.risk,
        interruption_policy: message.interruption_policy,
        escalation_behavior: message.escalation_behavior,
        expected_response_time: message.expected_response_time,
        no_response_behavior: message.no_response_behavior,
        timeout_behavior: message.timeout_behavior,
        deny_behavior: message.deny_behavior
      }
    });

    // 3. Evidence shown (if any). Bind the step to the same hashes the audit chain
    // committed to so a tampered evidence pack is visible against the replay.
    if (message.evidence_pack && message.evidence_pack !== "{}") {
      let evidence: Record<string, unknown> = {};
      try { evidence = JSON.parse(message.evidence_pack) as Record<string, unknown>; } catch { evidence = {}; }
      steps.push({
        step: "evidence_shown",
        at: message.created_at,
        summary: full ? String(evidence.summary || "Evidence pack provided") : "Evidence pack provided (redacted)",
        detail: full
          ? { evidence_pack: evidence, request_hash: this.requestHash(message), evidence_hash: this.evidenceHashOf(message) }
          : { redacted: true, evidence_redaction_profile: String(evidence.redaction_profile || ""), request_hash: this.requestHash(message), evidence_hash: this.evidenceHashOf(message) }
      });
    }

    // 4. Decision made (latest decision for the request).
    const decision = this.decisionForRequest(message.id);
    if (decision) {
      steps.push({
        step: "decision_made",
        at: decision.decided_at,
        summary: `${decision.decision} by ${decision.operator_alias}`,
        detail: {
          decision: decision.decision,
          operator_alias: decision.operator_alias,
          selected_options: parseArray(decision.selected_options),
          authority_grant: decision.authority_grant,
          decision_hash: decision.decision_hash,
          ...(full ? { decision_comment: decision.decision_comment, device_id: decision.device_id } : {})
        }
      });
    }

    // 5. Action/outcome reports, in forward (ascending) order.
    const outcomes = [...this.approvalOutcomes(message.id)].reverse();
    for (const outcome of outcomes) {
      steps.push({
        step: "action_reported",
        at: outcome.reported_at,
        summary: `${outcome.outcome_state}${outcome.scope_match === 0 ? " (scope mismatch)" : ""}`,
        detail: {
          outcome_state: outcome.outcome_state,
          scope_match: outcome.scope_match,
          reported_resources: parseArray(outcome.reported_resources),
          source: outcome.source,
          ...(full ? { outcome_summary: outcome.outcome_summary } : {})
        }
      });
    }

    // 6. Final state: the latest reported outcome, else the operator's decision,
    // else the message's current status.
    const latestOutcome = outcomes.length ? outcomes[outcomes.length - 1] : undefined;
    const denied = decision ? DENIAL_DECISIONS.has(decision.decision.toLowerCase()) : false;
    const finalState = latestOutcome ? latestOutcome.outcome_state : decision ? (denied ? "denied" : "approved") : message.status;
    const finalAt = latestOutcome ? latestOutcome.reported_at : decision ? decision.decided_at : message.created_at;
    steps.push({
      step: "final_state",
      at: finalAt,
      summary: finalState,
      detail: { final_state: finalState, message_status: message.status, decided: Boolean(decision), authority_granted: Boolean(decision && decision.authority_grant) }
    });

    return {
      approval_request_id: message.id,
      redaction_profile: profile,
      redacted: !full,
      decided: Boolean(decision),
      final_state: finalState,
      steps,
      audit: this.auditChain(message.id),
      audit_verification: this.verifyAuditChain()
    };
  }

  // --- Governance export (work item 016, AGH-018) -----------------------------

  // Portable export of approval/audit history for offline review. Redacted by
  // default: credentials are never included, and private message bodies, evidence
  // packs, decision comments, and outcome summaries are excluded. A full export
  // (private detail included) requires `includePrivate`, gated at the route by
  // explicit operator confirmation. The audit chain (hashes only) and its
  // verification are always included so a reviewer can confirm integrity.
  governanceExport(includePrivate = false): Record<string, unknown> {
    const parse = (value: string): unknown => { try { return JSON.parse(value || "[]"); } catch { return []; } };
    const approvals = (this.connection.prepare("SELECT * FROM agent_messages WHERE kind='approval_request' ORDER BY created_at, id").all() as unknown as AgentMessageRow[]).map((row) => ({
      id: row.id,
      channel_id: row.channel_id,
      source: row.source,
      kind: row.kind,
      urgency: row.urgency,
      title: row.title,
      risk: row.risk,
      required_authority: row.required_authority,
      to_human: row.to_human,
      template_id: row.template_id,
      status: row.status,
      interruption_policy: row.interruption_policy,
      escalation_behavior: row.escalation_behavior,
      created_at: row.created_at,
      expires_at: row.expires_at || null,
      ...(includePrivate ? {
        body: row.body,
        intent: row.intent,
        requested_action: row.requested_action,
        reason_for_interrupt: row.reason_for_interrupt,
        affected_resources: parse(row.affected_resources),
        evidence_pack: parse(row.evidence_pack)
      } : {})
    }));
    const decisions = (this.connection.prepare("SELECT * FROM decision_records ORDER BY decided_at, id").all() as unknown as DecisionRecordRow[]).map((row) => ({
      id: row.id,
      approval_request_id: row.approval_request_id,
      operator_alias: row.operator_alias,
      decision: row.decision,
      selected_options: parse(row.selected_options),
      authority_grant: row.authority_grant,
      request_hash: row.request_hash,
      evidence_hash: row.evidence_hash,
      decision_hash: row.decision_hash,
      decided_at: row.decided_at,
      ...(includePrivate ? { decision_comment: row.decision_comment, device_id: row.device_id } : {})
    }));
    const outcomes = (this.connection.prepare("SELECT * FROM approval_outcomes ORDER BY reported_at, id").all() as unknown as ApprovalOutcomeRow[]).map((row) => ({
      id: row.id,
      approval_request_id: row.approval_request_id,
      source: row.source,
      outcome_state: row.outcome_state,
      scope_match: row.scope_match,
      reported_resources: parse(row.reported_resources),
      reported_at: row.reported_at,
      ...(includePrivate ? { outcome_summary: row.outcome_summary } : {})
    }));
    const memoryRules = (this.connection.prepare("SELECT * FROM decision_memory_rules ORDER BY updated_at, id").all() as unknown as DecisionMemoryRuleRow[]).map((row) => ({
      source: row.source,
      template_id: row.template_id,
      required_authority: row.required_authority,
      suggested_decision: row.suggested_decision,
      occurrences: row.occurrences,
      status: row.status,
      updated_at: row.updated_at,
      ...(includePrivate ? { note: row.note } : {})
    }));
    return {
      format: "forgelink-governance-export-v1",
      exported_at: utcNow(),
      schema_version: this.state.schemaVersion,
      mode: includePrivate ? "full" : "redacted",
      excludes: includePrivate ? [] : ["message_bodies", "evidence_packs", "decision_comments", "outcome_summaries", "credentials"],
      approval_requests: approvals,
      decision_records: decisions,
      approval_outcomes: outcomes,
      audit_chain: this.auditChain(),
      audit_verification: this.verifyAuditChain(),
      decision_memory_rules: memoryRules
    };
  }

  // --- Communication firewall (work item 016, AGH-019) ------------------------

  communicationFirewallRules(): CommunicationFirewallRuleRow[] {
    return this.connection.prepare("SELECT * FROM communication_firewall_rules ORDER BY updated_at DESC, id").all() as unknown as CommunicationFirewallRuleRow[];
  }

  upsertCommunicationFirewallRule(input: CommunicationFirewallRuleInput): CommunicationFirewallRuleRow {
    const ruleKind = String(input.rule_kind || "").trim();
    if (!isFirewallRuleKind(ruleKind)) throw new Error("rule_kind must be block, draft_only, require_approval, or allow.");
    const agentId = String(input.agent_id || "").trim().slice(0, 80);
    const channelKind = String(input.channel_kind || "").trim().slice(0, 40);
    if (channelKind && !(OUTBOUND_CHANNEL_KINDS as readonly string[]).includes(channelKind)) throw new Error("channel_kind is invalid.");
    const contactId = input.contact_id === undefined || input.contact_id === null ? null : Number(input.contact_id);
    if (contactId !== null && !Number.isInteger(contactId)) throw new Error("contact_id must be an integer.");
    const policyJson = JSON.stringify(input.policy && typeof input.policy === "object" ? input.policy : {});
    const now = utcNow();
    const id = String(input.id || "").trim() || randomUUID();
    const enabled = input.enabled === undefined ? 1 : (input.enabled ? 1 : 0);
    const existing = this.connection.prepare("SELECT created_at FROM communication_firewall_rules WHERE id=?").get(id) as { created_at: string } | undefined;
    this.connection.prepare(`
      INSERT INTO communication_firewall_rules(id, agent_id, contact_id, channel_kind, rule_kind, policy_json, enabled, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id=excluded.agent_id,
        contact_id=excluded.contact_id,
        channel_kind=excluded.channel_kind,
        rule_kind=excluded.rule_kind,
        policy_json=excluded.policy_json,
        enabled=excluded.enabled,
        updated_at=excluded.updated_at
    `).run(id, agentId, contactId, channelKind, ruleKind, policyJson, enabled, existing?.created_at || now, now);
    return this.connection.prepare("SELECT * FROM communication_firewall_rules WHERE id=?").get(id) as unknown as CommunicationFirewallRuleRow;
  }

  deleteCommunicationFirewallRule(id: string): boolean {
    return this.connection.prepare("DELETE FROM communication_firewall_rules WHERE id=?").run(String(id || "").trim()).changes === 1;
  }

  // Decide how an external agent message must be handled before dispatch. The most
  // specific enabled matching rule wins; ties break toward the more restrictive
  // decision, then the most recently updated rule. With no matching rule the
  // default posture is draft-don't-send (AGH-020).
  evaluateCommunicationFirewall(agentId: string, channelKind: string, contactId: number | null): FirewallEvaluation {
    const kind = String(channelKind || "sms").trim() || "sms";
    const sendable = SENDABLE_CHANNEL_KINDS.has(kind);
    const matches = this.communicationFirewallRules().filter((rule) =>
      Boolean(rule.enabled)
      && (rule.agent_id === "" || rule.agent_id === agentId)
      && (rule.contact_id === null || rule.contact_id === contactId)
      && (rule.channel_kind === "" || rule.channel_kind === kind));
    if (!matches.length) return { decision: DEFAULT_FIREWALL_DECISION, matched_rule_id: null, reason: "default_draft_dont_send", sendable };
    const restrictiveness: Record<string, number> = { block: 3, require_approval: 2, draft_only: 1, allow: 0 };
    const specificity = (rule: CommunicationFirewallRuleRow): number => (rule.agent_id ? 1 : 0) + (rule.contact_id !== null ? 1 : 0) + (rule.channel_kind ? 1 : 0);
    matches.sort((left, right) => specificity(right) - specificity(left) || restrictiveness[right.rule_kind] - restrictiveness[left.rule_kind] || right.updated_at.localeCompare(left.updated_at));
    const top = matches[0];
    return { decision: top.rule_kind as FirewallRuleKind, matched_rule_id: top.id, reason: `rule:${top.rule_kind}`, sendable };
  }

  // --- Draft-don't-send for external channels (work item 016, AGH-020) --------

  private recordDraftEvent(draftId: string, eventType: string, detail: Record<string, unknown>, at: string): void {
    this.connection.prepare("INSERT INTO outbound_draft_events(draft_id, event_type, detail, created_at) VALUES(?, ?, ?, ?)")
      .run(draftId, eventType, JSON.stringify(detail || {}), at);
  }

  outboundDraft(id: string): OutboundDraftRow | undefined {
    return this.connection.prepare("SELECT * FROM agent_outbound_drafts WHERE id=?").get(String(id || "").trim()) as unknown as OutboundDraftRow | undefined;
  }

  outboundDrafts(status?: string): OutboundDraftRow[] {
    if (status) return this.connection.prepare("SELECT * FROM agent_outbound_drafts WHERE status=? ORDER BY created_at DESC, id DESC LIMIT 500").all(status) as unknown as OutboundDraftRow[];
    return this.connection.prepare("SELECT * FROM agent_outbound_drafts ORDER BY created_at DESC, id DESC LIMIT 500").all() as unknown as OutboundDraftRow[];
  }

  outboundDraftEvents(draftId: string): OutboundDraftEventRow[] {
    return this.connection.prepare("SELECT * FROM outbound_draft_events WHERE draft_id=? ORDER BY created_at DESC, id DESC").all(String(draftId || "").trim()) as unknown as OutboundDraftEventRow[];
  }

  // An agent submits an external message. The firewall is consulted first: a
  // `block` decision throws FirewallBlockedError (no draft is created); every other
  // decision parks a pending draft. This method never sends — the operator (or an
  // explicit `allow` rule, handled by the caller) authorizes the send separately.
  createOutboundDraft(input: OutboundDraftInput): { draft: OutboundDraftRow; evaluation: FirewallEvaluation } {
    const agentId = String(input.agent_id || "").trim();
    const channelKind = String(input.channel_kind || "sms").trim() || "sms";
    if (!DRAFTABLE_CHANNEL_KINDS.has(channelKind)) throw new Error("Only sms and mms external drafts are supported.");
    const to = normalizeNumber(input.to);
    const body = String(input.body || "");
    const media = (input.media_urls || []).map((value) => String(value));
    if (!body && !media.length) throw new Error("An outbound draft needs a body or media.");
    const contactId = this.resolveContactIdByValue(to);
    const evaluation = this.evaluateCommunicationFirewall(agentId, channelKind, contactId);
    if (evaluation.decision === "block") throw new FirewallBlockedError("The communication firewall blocked this external message.");
    const now = utcNow();
    const id = `draft-${randomUUID()}`;
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.prepare(`
        INSERT INTO agent_outbound_drafts(id, agent_id, channel_id, channel_kind, to_number, contact_id, body, media_urls, status, firewall_decision, reason, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `).run(id, agentId, String(input.channel_id || ""), channelKind, to, contactId, body, media.join(","), evaluation.decision, evaluation.reason, now, now);
      this.recordDraftEvent(id, "draft_created", { agent_id: agentId, channel_kind: channelKind, firewall_decision: evaluation.decision, reason: evaluation.reason }, now);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return { draft: this.outboundDraft(id)!, evaluation };
  }

  // Operator edits a pending draft before sending (review/edit; AGH-020).
  editOutboundDraft(id: string, body: string, media: string[] = []): OutboundDraftRow {
    const draft = this.outboundDraft(id);
    if (!draft) throw new Error("Outbound draft not found.");
    if (draft.status !== "draft") throw new Error("Only pending drafts can be edited.");
    const next = String(body ?? "");
    const nextMedia = (media || []).map((value) => String(value));
    if (!next && !nextMedia.length) throw new Error("An outbound draft needs a body or media.");
    const now = utcNow();
    this.connection.prepare("UPDATE agent_outbound_drafts SET body=?, media_urls=?, updated_at=? WHERE id=?").run(next, nextMedia.join(","), now, id);
    this.recordDraftEvent(id, "draft_edited", {}, now);
    return this.outboundDraft(id)!;
  }

  // Records the operator's (or an allow rule's) explicit authorization just before
  // the send is attempted, so direct-send authority is always audited (AGH-020).
  approveOutboundDraft(id: string, operatorAlias = "operator:primary", viaAllowRule = false): OutboundDraftRow {
    const draft = this.outboundDraft(id);
    if (!draft) throw new Error("Outbound draft not found.");
    if (draft.status !== "draft") throw new Error("Only pending drafts can be approved.");
    this.recordDraftEvent(id, "draft_approved", { operator_alias: operatorAlias, via_allow_rule: viaAllowRule }, utcNow());
    return draft;
  }

  denyOutboundDraft(id: string, reason = "denied"): OutboundDraftRow {
    const draft = this.outboundDraft(id);
    if (!draft) throw new Error("Outbound draft not found.");
    if (draft.status !== "draft") throw new Error("Only pending drafts can be denied.");
    const now = utcNow();
    this.connection.prepare("UPDATE agent_outbound_drafts SET status='denied', reason=?, decided_at=?, updated_at=? WHERE id=?").run(String(reason || "denied").slice(0, 500), now, now, id);
    this.recordDraftEvent(id, "draft_denied", { reason: String(reason || "") }, now);
    return this.outboundDraft(id)!;
  }

  markOutboundDraftSent(id: string, providerMessageId: string, viaAllowRule = false): OutboundDraftRow {
    const now = utcNow();
    if (this.connection.prepare("UPDATE agent_outbound_drafts SET status='sent', provider_message_id=?, last_error='', decided_at=COALESCE(decided_at, ?), updated_at=? WHERE id=?").run(String(providerMessageId || ""), now, now, id).changes !== 1) throw new Error("Outbound draft not found.");
    this.recordDraftEvent(id, "draft_sent", { provider_message_id: String(providerMessageId || ""), via_allow_rule: viaAllowRule }, now);
    return this.outboundDraft(id)!;
  }

  markOutboundDraftFailed(id: string, error: string): OutboundDraftRow {
    const now = utcNow();
    if (this.connection.prepare("UPDATE agent_outbound_drafts SET status='failed', last_error=?, updated_at=? WHERE id=?").run(String(error || "").slice(0, 500), now, id).changes !== 1) throw new Error("Outbound draft not found.");
    this.recordDraftEvent(id, "draft_failed", { error: String(error || "").slice(0, 200) }, now);
    return this.outboundDraft(id)!;
  }

  // --- Decision memory (work item 016, AGH-014) -------------------------------

  // Detect repeated decision patterns: the same agent source + template + required
  // authority decided the same way at least DECISION_MEMORY_MIN_OCCURRENCES times.
  // Patterns the operator already confirmed or dismissed are not re-suggested.
  // These are suggestions only; confirming one never auto-decides future requests.
  decisionMemorySuggestions(minOccurrences = DECISION_MEMORY_MIN_OCCURRENCES): DecisionMemorySuggestion[] {
    const rows = this.connection.prepare(`
      SELECT m.source AS source, m.template_id AS template_id, m.required_authority AS required_authority,
             CASE WHEN d.authority_grant != '' THEN 'approve' ELSE 'deny' END AS suggested_decision,
             COUNT(*) AS occurrences, MAX(d.decided_at) AS last_decided_at
      FROM decision_records d
      JOIN agent_messages m ON m.id = d.approval_request_id
      GROUP BY m.source, m.template_id, m.required_authority, suggested_decision
      HAVING occurrences >= ?
        AND NOT EXISTS (
          SELECT 1 FROM decision_memory_rules r
          WHERE r.source = m.source AND r.template_id = m.template_id
            AND r.required_authority = m.required_authority
            AND r.suggested_decision = (CASE WHEN d.authority_grant != '' THEN 'approve' ELSE 'deny' END)
        )
      ORDER BY occurrences DESC, last_decided_at DESC
    `).all(minOccurrences) as Array<Omit<DecisionMemorySuggestion, "requires_confirmation">>;
    return rows.map((row) => ({ ...row, occurrences: Number(row.occurrences), requires_confirmation: true }));
  }

  decisionMemoryRules(): DecisionMemoryRuleRow[] {
    return this.connection.prepare("SELECT * FROM decision_memory_rules ORDER BY updated_at DESC, id DESC").all() as unknown as DecisionMemoryRuleRow[];
  }

  // Explicit operator confirmation (or dismissal) of a suggested pattern. Recording
  // a rule is an operator decision and is advisory only — it does not change how the
  // approval path handles future requests and never expands agent authority.
  private upsertDecisionMemoryRule(input: DecisionMemoryRuleInput, status: "confirmed" | "dismissed"): DecisionMemoryRuleRow {
    const decision = String(input.suggested_decision || "").trim().toLowerCase();
    if (!MEMORY_DECISIONS.has(decision)) throw new Error("suggested_decision must be approve or deny.");
    const source = String(input.source || "").trim();
    const templateId = String(input.template_id || "").trim();
    const requiredAuthority = String(input.required_authority || "").trim();
    const note = String(input.note || "").slice(0, 2000);
    const occurrences = Number.isInteger(input.occurrences) ? Number(input.occurrences) : 0;
    const now = utcNow();
    const existing = this.connection.prepare("SELECT id, created_at FROM decision_memory_rules WHERE source=? AND template_id=? AND required_authority=? AND suggested_decision=?")
      .get(source, templateId, requiredAuthority, decision) as { id: string; created_at: string } | undefined;
    const id = existing?.id || randomUUID();
    this.connection.prepare(`
      INSERT INTO decision_memory_rules(id, source, template_id, required_authority, suggested_decision, occurrences, status, note, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, template_id, required_authority, suggested_decision)
      DO UPDATE SET occurrences=excluded.occurrences, status=excluded.status, note=excluded.note, updated_at=excluded.updated_at
    `).run(id, source, templateId, requiredAuthority, decision, occurrences, status, note, existing?.created_at || now, now);
    return this.connection.prepare("SELECT * FROM decision_memory_rules WHERE id=?").get(id) as unknown as DecisionMemoryRuleRow;
  }

  confirmDecisionMemory(input: DecisionMemoryRuleInput): DecisionMemoryRuleRow {
    return this.upsertDecisionMemoryRule(input, "confirmed");
  }

  dismissDecisionMemory(input: DecisionMemoryRuleInput): DecisionMemoryRuleRow {
    return this.upsertDecisionMemoryRule(input, "dismissed");
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
