import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, PhoneDatabase, REDACTION_PROFILES, redactEvidencePack, redactNotification } from "./database";
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
    // v12 (016 AGH-003) adds the agent identity registry.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_identities'").get() as { name: string } | undefined)?.name, "agent_identities");
    // v13 (016 AGH-004) adds the trust transition audit log.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_trust_events'").get() as { name: string } | undefined)?.name, "agent_trust_events");
    // v14 (016 AGH-006) adds durable structured approval request fields.
    const agentMessageColumns = new Set((database.connection.prepare("PRAGMA table_info(agent_messages)").all() as Array<{ name: string }>).map((column) => column.name));
    assert.equal(agentMessageColumns.has("requested_action"), true);
    assert.equal(agentMessageColumns.has("decision_options"), true);
    // v15 (016 AGH-007) adds durable evidence pack fields.
    assert.equal(agentMessageColumns.has("template_id"), true);
    assert.equal(agentMessageColumns.has("evidence_pack"), true);
    // v16 (016 AGH-010/011/012) adds routing/etiquette fields and message events.
    assert.equal(agentMessageColumns.has("interruption_policy"), true);
    assert.equal(agentMessageColumns.has("no_response_behavior"), true);
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_message_events'").get() as { name: string } | undefined)?.name, "agent_message_events");
    // v17 (016 AGH-013) adds durable operator decision records.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_records'").get() as { name: string } | undefined)?.name, "decision_records");
    // v18 (016 AGH-016) adds the tamper-evident audit chain.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_chain'").get() as { name: string } | undefined)?.name, "audit_chain");
    // v19 (016 AGH-015) adds approval outcome callbacks.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approval_outcomes'").get() as { name: string } | undefined)?.name, "approval_outcomes");
    // v20 (016 AGH-014) adds decision memory rules.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_memory_rules'").get() as { name: string } | undefined)?.name, "decision_memory_rules");
    // v21 (016 AGH-019/020) adds the communication firewall and outbound drafts.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='communication_firewall_rules'").get() as { name: string } | undefined)?.name, "communication_firewall_rules");
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_outbound_drafts'").get() as { name: string } | undefined)?.name, "agent_outbound_drafts");
    // v22 (016 AGH-021) adds the external-contact consent ledger.
    assert.equal((database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consent_ledger'").get() as { name: string } | undefined)?.name, "consent_ledger");
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

// Authority scopes (work item 016, AGH-002).
test("checks authority scopes and offers escalation targets (AGH-002)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-authority-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // The seeded primary operator holds every scope, so single-operator stays simple.
    assert.equal(database.checkAuthority("operator:primary", "security_approval").granted, true);
    assert.deepEqual(database.humanCardsWithAuthority("emergency").map((card) => card.alias), ["operator:primary"]);

    // A limited operator lacks scopes it was not granted; escalation points to a holder.
    database.upsertHumanCard({ alias: "operator:release_approval", role: "operator", authority_scopes: ["release_approval"] });
    assert.equal(database.checkAuthority("operator:release_approval", "release_approval").granted, true);
    const denied = database.checkAuthority("operator:release_approval", "security_approval");
    assert.equal(denied.granted, false);
    assert.equal(denied.resolved_via, "operator:release_approval");
    assert.ok(denied.escalate_to.includes("operator:primary"));

    // An unresolved, non-operator alias grants nothing but still offers escalation.
    const unresolved = database.checkAuthority("agent:rogue", "release_approval");
    assert.equal(unresolved.granted, false);
    assert.equal(unresolved.resolved_via, null);
    assert.ok(unresolved.escalate_to.includes("operator:primary"));
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Agent Identity Registry (work item 016, AGH-003).
test("registers agent identities with restricted defaults and operator management (AGH-003)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-agent-identity-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // An unknown agent is auto-registered on first sight with restricted defaults.
    const first = database.recordAgentIdentitySeen("codex", "mcp");
    assert.equal(first.trust_state, "unknown");
    assert.equal(first.allowed_channels, "[]");
    assert.equal(first.allowed_tools, "[]");
    assert.ok(first.last_seen_at);
    assert.equal(database.agentIdentities().length, 1);

    // Seeing it again updates last-seen without creating a duplicate.
    const second = database.recordAgentIdentitySeen("codex", "mcp");
    assert.equal(database.agentIdentities().length, 1);
    assert.ok((second.last_seen_at as string) >= (first.last_seen_at as string));

    // Operators promote/configure identities; trust state is validated.
    const trusted = database.upsertAgentIdentity({ id: "codex", display_name: "Codex", owner: "platform", trust_state: "trusted", allowed_tools: ["git_commit"], escalation_alias: "operator:primary" });
    assert.equal(trusted.trust_state, "trusted");
    assert.equal(trusted.owner, "platform");
    assert.deepEqual(JSON.parse(trusted.allowed_tools), ["git_commit"]);
    // Management does not duplicate or reset last-seen.
    assert.equal(database.agentIdentities().length, 1);
    assert.equal(trusted.last_seen_at, second.last_seen_at);

    assert.throws(() => database.upsertAgentIdentity({ id: "codex", trust_state: "supreme" }), /trust state/);
    assert.throws(() => database.recordAgentIdentitySeen("bad id"), /agent identity id/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Agent trust states and probation (work item 016, AGH-004).
test("audits agent trust transitions (AGH-004)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-agent-trust-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.recordAgentIdentitySeen("codex", "mcp"); // starts 'unknown', no event
    assert.equal(database.agentTrustEvents("codex").length, 0);

    // Explicit transitions are recorded with from/to and reason.
    const probation = database.setAgentTrustState("codex", "probation", "under review");
    assert.equal(probation.trust_state, "probation");
    const promoted = database.setAgentTrustState("codex", "trusted", "background check passed");
    assert.equal(promoted.trust_state, "trusted");
    const events = database.agentTrustEvents("codex");
    assert.equal(events.length, 2);
    assert.equal(events[0].to_state, "trusted");
    assert.equal(events[0].from_state, "probation");
    assert.equal(events[0].reason, "background check passed");
    assert.equal(events[1].from_state, "unknown");

    // No-op transitions and invalid states do not write events.
    assert.equal(database.setAgentTrustState("codex", "trusted").trust_state, "trusted");
    assert.equal(database.agentTrustEvents("codex").length, 2);
    assert.throws(() => database.setAgentTrustState("codex", "supreme"), /trust state/);
    assert.throws(() => database.setAgentTrustState("ghost", "trusted"), /not found/);

    // Trust changes made through operator management are audited too.
    database.upsertAgentIdentity({ id: "codex", trust_state: "blocked" });
    assert.equal(database.agentTrustEvents("codex")[0].to_state, "blocked");
    assert.equal(database.agentTrustEvents("codex").length, 3);
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
      expires_at: "2099-01-01T00:00:00.000Z",
      intent: "Release ForgeLink",
      requested_action: "Publish the release build.",
      reason_for_interrupt: "Publishing requires operator approval.",
      risk: "normal",
      required_authority: "release_approval",
      to_human: "operator:primary",
      affected_resources: ["repo:ForgeLink", "release:2.0.3"],
      timeout_behavior: "deny_on_timeout",
      deny_behavior: "do_not_publish",
      expected_response_time: "15 minutes",
      no_response_behavior: "deny_on_timeout",
      can_batch: true,
      can_wait_until: "2099-01-01T00:00:00.000Z",
      decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
      template_id: "github_release",
      evidence_pack: {
        summary: "Release candidate evidence.",
        affected_resources: ["repo:ForgeLink", "release:2.0.3"],
        diff_summary: "Release metadata only.",
        proposed_operation: "Publish the release build.",
        checks: ["backend tests", "renderer build"],
        rollback_plan: "Delete the draft release and restore the previous tag.",
        links: ["local://evidence/release"],
        limitations: "Synthetic test evidence.",
        redaction_profile: "desktop_full"
      }
    });
    assert.equal(stored.status, "unread");
    assert.equal(stored.requested_action, "Publish the release build.");
    assert.deepEqual(JSON.parse(stored.affected_resources), ["repo:ForgeLink", "release:2.0.3"]);
    assert.deepEqual(JSON.parse(stored.decision_options).map((option: { id: string }) => option.id), ["approve", "deny"]);
    assert.equal(stored.template_id, "github_release");
    assert.equal(JSON.parse(stored.evidence_pack).rollback_plan, "Delete the draft release and restore the previous tag.");
    assert.equal(stored.interruption_policy, "");
    assert.equal(stored.can_batch, 1);
    assert.equal(stored.can_wait_until, "2099-01-01T00:00:00.000Z");
    assert.equal(database.agentMessages()[0].channel_id, "forgewire");
    assert.equal(database.updateAgentMessageStatus("agent-1", "acted", "approve").status, "acted");
    const exported = database.exportData() as { messages: Array<unknown>; agent_messages: Array<{ id: string }> };
    assert.equal(exported.messages.length, 1);
    assert.deepEqual(exported.agent_messages.map((message) => message.id), ["agent-1"]);
    database.addAgentMessage({ id: "expired", channel_id: "forgewire", source: "forgewire", kind: "alert", urgency: "high", title: "Old alert", body: "Expired", expires_at: "2020-01-01T00:00:00.000Z" });
    assert.equal(database.agentMessage("expired")?.status, "expired");
    assert.equal(database.agentMessageEvents("expired")[0].event_type, "expired");
    assert.equal(database.applyRetention(365).deletedAgentMessages, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Decision Records (work item 016, AGH-013): persist what the operator saw and
// decided so a completed decision can be replayed and integrity-checked later.
test("records operator decisions with bound request/evidence hashes and authority grant (AGH-013)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-decisions-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.addAgentMessage({
      id: "agent-decide", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "normal",
      title: "Release approval", body: "Publish the build.", intent: "Release", requested_action: "Publish",
      reason_for_interrupt: "Needs operator authority.", risk: "normal", required_authority: "release_approval",
      to_human: "operator:primary", affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
      evidence_pack: { summary: "Ready", affected_resources: ["repo:ForgeLink"], diff_summary: "metadata", proposed_operation: "publish", checks: ["tests"], rollback_plan: "delete draft", links: [], limitations: "synthetic", redaction_profile: "desktop_full" }
    });

    // An approval decision grants exactly the authority the request declared, with
    // the chosen option and operator recorded and the request/evidence bound by hash.
    const approved = database.recordDecision({ approval_request_id: "agent-decide", decision: "approve", decision_comment: "Looks good", device_id: "desktop-1" });
    assert.equal(approved.decision, "approve");
    assert.equal(approved.operator_alias, "operator:primary");
    assert.equal(approved.device_id, "desktop-1");
    assert.equal(approved.decision_comment, "Looks good");
    assert.equal(approved.authority_grant, "release_approval");
    assert.deepEqual(JSON.parse(approved.selected_options), ["approve"]);
    assert.match(approved.request_hash, /^[a-f0-9]{64}$/);
    assert.match(approved.evidence_hash, /^[a-f0-9]{64}$/);
    assert.match(approved.decision_hash, /^[a-f0-9]{64}$/);

    // The decision is audited as an agent message event and is replayable.
    assert.equal(database.agentMessageEvents("agent-decide")[0].event_type, "decision");
    assert.equal(database.decisionForRequest("agent-decide")?.id, approved.id);
    assert.equal(database.decisionRecords("agent-decide").length, 1);

    // The request hash is stable for the same stored request.
    const replayed = database.recordDecision({ approval_request_id: "agent-decide", decision: "deny" });
    assert.equal(replayed.request_hash, approved.request_hash);
    // A denial grants no authority and becomes the latest decision.
    assert.equal(replayed.authority_grant, "");
    assert.equal(database.decisionForRequest("agent-decide")?.decision, "deny");

    // Decisions are part of the durable export and survive as an audit artifact.
    const exported = database.exportData() as { decision_records: Array<{ approval_request_id: string }> };
    assert.equal(exported.decision_records.length, 2);

    // A decision on a different request produces a different request hash.
    database.addAgentMessage({ id: "agent-other", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "normal", title: "Other", body: "Different", required_authority: "general_approval", decision_options: [{ id: "approve", label: "Approve" }] });
    const other = database.recordDecision({ approval_request_id: "agent-other", decision: "approve" });
    assert.notEqual(other.request_hash, approved.request_hash);
    assert.equal(other.authority_grant, "general_approval");

    assert.throws(() => database.recordDecision({ approval_request_id: "missing", decision: "approve" }), /not found/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Tamper-evident audit chain (work item 016, AGH-016): hash-linked governance
// records that detect mutation of a record or a chain entry after the fact.
test("hash-links governance records into a tamper-evident chain (AGH-016)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-audit-chain-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // A fresh database has an empty but valid chain.
    assert.deepEqual(database.verifyAuditChain(), { ok: true, length: 0, broken_at: null, reason: "" });

    // Creating an approval request appends a request entry and an evidence entry.
    database.addAgentMessage({
      id: "agent-chain", channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "normal",
      title: "Release approval", body: "Publish the build.", intent: "Release", requested_action: "Publish",
      reason_for_interrupt: "Needs operator authority.", risk: "normal", required_authority: "release_approval",
      to_human: "operator:primary", affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
      evidence_pack: { summary: "Ready", affected_resources: ["repo:ForgeLink"], diff_summary: "metadata", proposed_operation: "publish", checks: ["tests"], rollback_plan: "delete draft", links: [], limitations: "synthetic", redaction_profile: "desktop_full" }
    });
    // A plain alert is not a governed record and is not chained.
    database.addAgentMessage({ id: "alert-1", channel_id: "forgewire", source: "fabric", kind: "alert", urgency: "low", title: "FYI", body: "no chain" });
    assert.deepEqual(database.auditChain().map((entry) => entry.entry_type), ["approval_request", "evidence_pack"]);

    // Recording the decision appends a linked decision entry; the chain stays valid.
    const decision = database.recordDecision({ approval_request_id: "agent-chain", decision: "approve" });
    const chain = database.auditChain("agent-chain");
    assert.deepEqual(chain.map((entry) => entry.entry_type), ["approval_request", "evidence_pack", "decision"]);
    assert.equal(chain[0].prev_hash, "");
    assert.equal(chain[1].prev_hash, chain[0].entry_hash);
    assert.equal(chain[2].prev_hash, chain[1].entry_hash);
    assert.equal(chain[2].payload_hash, decision.decision_hash);
    assert.equal(database.verifyAuditChain().ok, true);
    assert.equal(database.verifyAuditChain().length, 3);

    // Mutating the underlying decision record is detected (payload no longer hashes
    // to the frozen chain entry).
    database.connection.prepare("UPDATE decision_records SET decision='deny' WHERE id=?").run(decision.id);
    const tamperedPayload = database.verifyAuditChain();
    assert.equal(tamperedPayload.ok, false);
    assert.equal(tamperedPayload.reason, "tampered_payload");
    assert.equal(tamperedPayload.broken_at, chain[2].seq);

    // Restoring the record makes the chain verify again.
    database.connection.prepare("UPDATE decision_records SET decision='approve' WHERE id=?").run(decision.id);
    assert.equal(database.verifyAuditChain().ok, true);

    // Mutating a chain entry's stored fields breaks its self-hash.
    database.connection.prepare("UPDATE audit_chain SET payload_hash='deadbeef' WHERE seq=?").run(chain[0].seq);
    const tamperedEntry = database.verifyAuditChain();
    assert.equal(tamperedEntry.ok, false);
    assert.equal(tamperedEntry.reason, "tampered_entry");
    assert.equal(tamperedEntry.broken_at, chain[0].seq);

    // The chain is part of the durable export.
    const exported = database.exportData() as { audit_chain: Array<unknown> };
    assert.equal(exported.audit_chain.length, 3);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Approval outcome callbacks (work item 016, AGH-015): agents report what happened
// after approval; dangling approvals are visible and scope mismatches are flagged.
test("records approval outcomes, flags scope mismatch, and surfaces dangling approvals (AGH-015)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-outcomes-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const approval = (id: string) => database.addAgentMessage({
      id, channel_id: "forgewire", source: "fabric", kind: "approval_request", urgency: "normal",
      title: "Release approval", body: "Publish the build.", required_authority: "release_approval",
      affected_resources: ["repo:ForgeLink", "release:2.0.3"], decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
      evidence_pack: { summary: "Ready", affected_resources: ["repo:ForgeLink"], diff_summary: "d", proposed_operation: "p", checks: [], rollback_plan: "r", links: [], limitations: "l", redaction_profile: "desktop_full" }
    });

    // Approve two requests; both become dangling until a terminal outcome arrives.
    approval("appr-1");
    approval("appr-2");
    database.recordDecision({ approval_request_id: "appr-1", decision: "approve" });
    database.recordDecision({ approval_request_id: "appr-2", decision: "approve" });
    assert.deepEqual(database.danglingApprovals().map((m) => m.id).sort(), ["appr-1", "appr-2"]);

    // Only allowed states are accepted; unknown record is rejected.
    assert.throws(() => database.recordOutcome({ approval_request_id: "appr-1", outcome_state: "vibes" }), /outcome state/);
    assert.throws(() => database.recordOutcome({ approval_request_id: "missing", outcome_state: "action_started" }), /not found/);

    // A within-scope success closes appr-1 out and is not a scope mismatch.
    const started = database.recordOutcome({ approval_request_id: "appr-1", outcome_state: "action_started", reported_resources: ["repo:ForgeLink"] });
    assert.equal(started.scope_match, 1);
    const ok = database.recordOutcome({ approval_request_id: "appr-1", outcome_state: "action_succeeded", reported_resources: ["repo:ForgeLink", "release:2.0.3"] });
    assert.equal(ok.scope_match, 1);
    assert.equal(database.approvalOutcomes("appr-1").length, 2);
    // appr-1 is no longer dangling; appr-2 still is.
    assert.deepEqual(database.danglingApprovals().map((m) => m.id), ["appr-2"]);

    // Acting outside the approved resources is flagged as a scope mismatch.
    const drift = database.recordOutcome({ approval_request_id: "appr-2", outcome_state: "action_succeeded", reported_resources: ["repo:OtherRepo"] });
    assert.equal(drift.scope_match, 0);
    // Declaring modified scope is a mismatch even with no extra resources.
    const modified = database.recordOutcome({ approval_request_id: "appr-2", outcome_state: "used_modified_scope" });
    assert.equal(modified.scope_match, 0);
    assert.deepEqual(database.scopeMismatchOutcomes().map((o) => o.outcome_state).sort(), ["action_succeeded", "used_modified_scope"]);

    // Outcomes are audited as message events, committed to the audit chain, and the
    // chain still verifies; outcomes are part of the durable export.
    assert.equal(database.agentMessageEvents("appr-1").some((e) => e.event_type === "outcome"), true);
    assert.equal(database.auditChain("appr-1").some((e) => e.entry_type === "outcome"), true);
    assert.equal(database.verifyAuditChain().ok, true);
    const exported = database.exportData() as { approval_outcomes: Array<unknown> };
    assert.equal(exported.approval_outcomes.length, 4);

    // A tampered outcome is caught by chain verification.
    database.connection.prepare("UPDATE approval_outcomes SET outcome_state='action_failed' WHERE id=?").run(ok.id);
    assert.equal(database.verifyAuditChain().reason, "tampered_payload");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Decision memory (work item 016, AGH-014): repeated patterns become suggestions
// that require explicit operator confirmation and never auto-decide.
test("suggests repeated decision patterns and requires explicit confirmation (AGH-014)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-decision-memory-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    const approveOnce = (n: number) => {
      const id = `mem-${n}`;
      database.addAgentMessage({ id, channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "normal", title: "Release", body: "Publish", template_id: "github_release", required_authority: "release_approval", affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }] });
      database.recordDecision({ approval_request_id: id, decision: "approve" });
    };

    // Two approvals of the same pattern are below the threshold: no suggestion.
    approveOnce(1);
    approveOnce(2);
    assert.deepEqual(database.decisionMemorySuggestions(), []);

    // The third repeat crosses the threshold and surfaces a suggestion.
    approveOnce(3);
    const suggestions = database.decisionMemorySuggestions();
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].source, "codex");
    assert.equal(suggestions[0].template_id, "github_release");
    assert.equal(suggestions[0].required_authority, "release_approval");
    assert.equal(suggestions[0].suggested_decision, "approve");
    assert.equal(suggestions[0].occurrences, 3);
    assert.equal(suggestions[0].requires_confirmation, true);

    // suggested_decision is validated.
    assert.throws(() => database.confirmDecisionMemory({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "maybe" }), /approve or deny/);

    // Confirming the suggestion records an explicit, advisory rule and removes it
    // from future suggestions (idempotent on the pattern).
    const confirmed = database.confirmDecisionMemory({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "approve", note: "Routine release", occurrences: 3 });
    assert.equal(confirmed.status, "confirmed");
    assert.deepEqual(database.decisionMemorySuggestions(), []);
    assert.equal(database.decisionMemoryRules().length, 1);
    database.confirmDecisionMemory({ source: "codex", template_id: "github_release", required_authority: "release_approval", suggested_decision: "approve" });
    assert.equal(database.decisionMemoryRules().length, 1);

    // Crucial invariant: a confirmed rule is advisory only. A new matching request
    // is NOT auto-decided — no decision exists until the operator acts.
    database.addAgentMessage({ id: "mem-new", channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "normal", title: "Release", body: "Publish", template_id: "github_release", required_authority: "release_approval", affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }] });
    assert.equal(database.decisionForRequest("mem-new"), undefined);
    assert.equal(database.agentMessage("mem-new")?.status, "unread");

    // Dismissing a different pattern records it without suggesting it again.
    database.addAgentMessage({ id: "mem-del-1", channel_id: "forgewire", source: "rogue", kind: "approval_request", urgency: "normal", title: "Delete", body: "rm", template_id: "data_delete", required_authority: "general_approval", affected_resources: ["data:cache"], decision_options: [{ id: "deny", label: "Deny" }] });
    database.recordDecision({ approval_request_id: "mem-del-1", decision: "deny" });
    database.dismissDecisionMemory({ source: "rogue", template_id: "data_delete", required_authority: "general_approval", suggested_decision: "deny" });
    assert.equal(database.decisionMemoryRules().find((rule) => rule.source === "rogue")?.status, "dismissed");

    // Rules are part of the durable export.
    const exported = database.exportData() as { decision_memory_rules: Array<unknown> };
    assert.equal(exported.decision_memory_rules.length, 2);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Approval replay (work item 016, AGH-017): the full lifecycle of a completed
// approval is replayable and redacts according to operator policy.
test("replays an approval lifecycle and redacts according to operator policy (AGH-017)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-replay-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // Unknown request has no replay.
    assert.equal(database.approvalReplay("missing"), undefined);

    database.addAgentMessage({
      id: "rp-1", channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "normal",
      title: "Release approval", body: "Private approval body", required_authority: "release_approval",
      affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
      risk: "normal", interruption_policy: "normal_approval", escalation_behavior: "deny_or_defer_on_timeout",
      evidence_pack: { summary: "Build is green", affected_resources: ["repo:ForgeLink"], diff_summary: "d", proposed_operation: "publish", checks: ["tests"], rollback_plan: "revert tag", links: [], limitations: "none", redaction_profile: "desktop_full" }
    });
    database.recordDecision({ approval_request_id: "rp-1", decision: "approve", decision_comment: "Looks good" });
    database.recordOutcome({ approval_request_id: "rp-1", outcome_state: "action_started", reported_resources: ["repo:ForgeLink"] });
    database.recordOutcome({ approval_request_id: "rp-1", outcome_state: "action_succeeded", reported_resources: ["repo:ForgeLink"] });

    // Default replay follows the operator card (desktop_full): full detail, ordered
    // steps, and a verified per-request chain segment.
    const full = database.approvalReplay("rp-1")!;
    assert.equal(full.redacted, false);
    assert.equal(full.redaction_profile, "desktop_full");
    assert.equal(full.decided, true);
    assert.equal(full.final_state, "action_succeeded");
    assert.deepEqual(full.steps.map((s) => s.step), ["request_received", "risk_classified", "evidence_shown", "decision_made", "action_reported", "action_reported", "final_state"]);
    // Outcomes are forward-ordered in the replay.
    const reported = full.steps.filter((s) => s.step === "action_reported");
    assert.deepEqual(reported.map((s) => s.detail.outcome_state), ["action_started", "action_succeeded"]);
    // Full detail includes the private body, evidence pack, and decision comment.
    assert.equal(full.steps[0].detail.body, "Private approval body");
    assert.ok((full.steps.find((s) => s.step === "evidence_shown")!.detail.evidence_pack as Record<string, unknown>).summary);
    assert.equal(full.steps.find((s) => s.step === "decision_made")!.detail.decision_comment, "Looks good");
    assert.equal(full.audit_verification.ok, true);
    assert.equal(full.audit.every((entry) => entry.approval_request_id === "rp-1"), true);

    // A redacted surface withholds private detail but keeps the lifecycle shape and
    // the integrity hashes.
    const redacted = database.approvalReplay("rp-1", "mobile_lock_screen")!;
    assert.equal(redacted.redacted, true);
    assert.equal(redacted.redaction_profile, "mobile_lock_screen");
    assert.equal(redacted.final_state, "action_succeeded");
    assert.equal(redacted.steps[0].detail.body, undefined);
    const redactedEvidence = redacted.steps.find((s) => s.step === "evidence_shown")!;
    // Mobile lock screen shows the evidence summary but not the diff/operation.
    const redactedPack = redactedEvidence.detail.evidence_pack as Record<string, unknown>;
    assert.equal(redactedPack.redacted, true);
    assert.equal(redactedPack.summary, "Build is green");
    assert.equal(redactedPack.diff_summary, undefined);
    assert.equal(redactedPack.proposed_operation, undefined);
    assert.equal(redactedEvidence.detail.redacted, true);
    assert.ok(redactedEvidence.detail.evidence_hash);
    assert.equal(redacted.steps.find((s) => s.step === "decision_made")!.detail.decision_comment, undefined);

    // status_only is the most restrictive surface: no evidence detail at all.
    const statusOnly = database.approvalReplay("rp-1", "status_only")!;
    const statusEvidence = (statusOnly.steps.find((s) => s.step === "evidence_shown")!.detail.evidence_pack) as Record<string, unknown>;
    assert.equal(statusEvidence.summary, undefined);
    assert.equal(statusEvidence.redacted, true);
    // An unknown profile fails closed to the most restrictive surface.
    assert.equal(database.approvalReplay("rp-1", "bogus_profile")!.redaction_profile, "status_only");

    // An undecided request still replays: it ends at its current status.
    database.addAgentMessage({ id: "rp-2", channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "low", title: "Pending", body: "b", risk: "low", interruption_policy: "passive_notification" });
    const pending = database.approvalReplay("rp-2")!;
    assert.equal(pending.decided, false);
    assert.equal(pending.final_state, "unread");
    assert.equal(pending.steps.some((s) => s.step === "decision_made"), false);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Governance export (work item 016, AGH-018): redacted approval/audit history by
// default; a full export including private detail is explicit.
test("exports redacted governance history by default and full detail on request (AGH-018)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-gov-export-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    database.addAgentMessage({
      id: "gx-1", channel_id: "forgewire", source: "codex", kind: "approval_request", urgency: "normal",
      title: "Release approval", body: "Secret build notes", template_id: "github_release", required_authority: "release_approval",
      affected_resources: ["repo:ForgeLink"], decision_options: [{ id: "approve", label: "Approve" }],
      evidence_pack: { summary: "Green", affected_resources: ["repo:ForgeLink"], diff_summary: "d", proposed_operation: "p", checks: [], rollback_plan: "r", links: [], limitations: "l", redaction_profile: "desktop_full" }
    });
    database.recordDecision({ approval_request_id: "gx-1", decision: "approve", decision_comment: "private comment" });
    database.recordOutcome({ approval_request_id: "gx-1", outcome_state: "action_succeeded", outcome_summary: "private outcome detail", reported_resources: ["repo:ForgeLink"] });
    // A non-approval agent message must not appear in the governance export.
    database.addAgentMessage({ id: "gx-alert", channel_id: "forgewire", source: "fabric", kind: "alert", urgency: "low", title: "FYI", body: "noise" });

    const redacted = database.governanceExport() as Record<string, any>;
    assert.equal(redacted.format, "forgelink-governance-export-v1");
    assert.equal(redacted.mode, "redacted");
    assert.ok(redacted.excludes.includes("message_bodies"));
    assert.equal(redacted.approval_requests.length, 1);
    // Redacted: structural/governance fields present, private bodies/evidence absent.
    assert.equal(redacted.approval_requests[0].title, "Release approval");
    assert.equal(redacted.approval_requests[0].risk !== undefined, true);
    assert.equal(redacted.approval_requests[0].body, undefined);
    assert.equal(redacted.approval_requests[0].evidence_pack, undefined);
    assert.equal(redacted.decision_records[0].decision, "approve");
    assert.equal(redacted.decision_records[0].decision_comment, undefined);
    assert.equal(redacted.approval_outcomes[0].outcome_state, "action_succeeded");
    assert.equal(redacted.approval_outcomes[0].outcome_summary, undefined);
    // The audit chain (hashes only) and its verification are always included.
    assert.ok(Array.isArray(redacted.audit_chain));
    assert.equal(redacted.audit_verification.ok, true);
    // No credential material is ever included.
    assert.equal(redacted.mcp_tokens, undefined);
    assert.equal(redacted.agent_channels, undefined);

    const full = database.governanceExport(true) as Record<string, any>;
    assert.equal(full.mode, "full");
    assert.deepEqual(full.excludes, []);
    assert.equal(full.approval_requests[0].body, "Secret build notes");
    assert.ok(full.approval_requests[0].evidence_pack.summary);
    assert.equal(full.decision_records[0].decision_comment, "private comment");
    assert.equal(full.approval_outcomes[0].outcome_summary, "private outcome detail");
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Communication firewall (work item 016, AGH-019): operator policy decides how an
// agent's external message is handled before dispatch; most specific rule wins and
// ties break to the more restrictive decision.
test("evaluates the communication firewall with specificity and restrictiveness (AGH-019)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-firewall-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // Default posture with no rules is draft-don't-send.
    const def = database.evaluateCommunicationFirewall("codex", "sms", null);
    assert.equal(def.decision, "draft_only");
    assert.equal(def.matched_rule_id, null);
    assert.equal(def.sendable, true);
    // Non-messageable kinds are not sendable but can still be evaluated/blocked.
    assert.equal(database.evaluateCommunicationFirewall("codex", "voice", null).sendable, false);

    // rule_kind is validated.
    assert.throws(() => database.upsertCommunicationFirewallRule({ rule_kind: "maybe" }), /rule_kind/);

    // A global allow rule opens direct send; a more specific block for one agent on
    // mms wins over it by specificity.
    database.upsertCommunicationFirewallRule({ rule_kind: "allow" });
    assert.equal(database.evaluateCommunicationFirewall("codex", "sms", null).decision, "allow");
    const block = database.upsertCommunicationFirewallRule({ agent_id: "rogue", channel_kind: "mms", rule_kind: "block" });
    assert.equal(database.evaluateCommunicationFirewall("rogue", "mms", null).decision, "block");
    assert.equal(database.evaluateCommunicationFirewall("rogue", "mms", null).matched_rule_id, block.id);
    // Another agent on sms still gets the global allow.
    assert.equal(database.evaluateCommunicationFirewall("codex", "sms", null).decision, "allow");

    // Disabling a rule removes it from evaluation; deleting works too.
    database.upsertCommunicationFirewallRule({ id: block.id, agent_id: "rogue", channel_kind: "mms", rule_kind: "block", enabled: false });
    assert.equal(database.evaluateCommunicationFirewall("rogue", "mms", null).decision, "allow");
    assert.equal(database.deleteCommunicationFirewallRule(block.id), true);
    assert.equal(database.communicationFirewallRules().length, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Draft-don't-send (work item 016, AGH-020): agents draft external messages; the
// operator reviews, edits, approves, or denies; direct-send authority is audited.
test("parks agent external messages as drafts and gates sending (AGH-020)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-drafts-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // Default posture parks a draft rather than sending.
    const { draft, evaluation } = database.createOutboundDraft({ agent_id: "codex", channel_id: "forgewire", to: "+15551230000", body: "Hi there" });
    assert.equal(evaluation.decision, "draft_only");
    assert.equal(draft.status, "draft");
    assert.equal(draft.firewall_decision, "draft_only");
    assert.equal(database.outboundDrafts("draft").length, 1);
    // Creation is audited.
    assert.equal(database.outboundDraftEvents(draft.id).some((e) => e.event_type === "draft_created"), true);

    // Empty drafts and unsupported channel kinds are rejected.
    assert.throws(() => database.createOutboundDraft({ agent_id: "codex", channel_id: "forgewire", to: "+15551230000", body: "" }), /body or media/);
    assert.throws(() => database.createOutboundDraft({ agent_id: "codex", channel_id: "forgewire", channel_kind: "email", to: "+15551230000", body: "x" }), /sms and mms/);

    // A block rule refuses outright (no draft created).
    database.upsertCommunicationFirewallRule({ agent_id: "rogue", rule_kind: "block" });
    assert.throws(() => database.createOutboundDraft({ agent_id: "rogue", channel_id: "forgewire", to: "+15551230000", body: "blocked" }), /firewall blocked/i);
    assert.equal(database.outboundDrafts().length, 1);

    // The operator can edit a pending draft, and edits are audited.
    const edited = database.editOutboundDraft(draft.id, "Edited body");
    assert.equal(edited.body, "Edited body");
    assert.equal(database.outboundDraftEvents(draft.id).some((e) => e.event_type === "draft_edited"), true);

    // Approval is recorded (explicit, audited) before the send is attempted.
    database.approveOutboundDraft(draft.id, "operator:primary");
    assert.equal(database.outboundDraftEvents(draft.id).some((e) => e.event_type === "draft_approved"), true);
    const sent = database.markOutboundDraftSent(draft.id, "SM-PROVIDER-1");
    assert.equal(sent.status, "sent");
    assert.equal(sent.provider_message_id, "SM-PROVIDER-1");
    assert.equal(database.outboundDraftEvents(draft.id).some((e) => e.event_type === "draft_sent"), true);
    // A sent draft can no longer be edited, denied, or re-approved.
    assert.throws(() => database.editOutboundDraft(draft.id, "late"), /pending/);
    assert.throws(() => database.denyOutboundDraft(draft.id), /pending/);

    // A second draft can be denied; denial is terminal and audited.
    const second = database.createOutboundDraft({ agent_id: "codex", channel_id: "forgewire", to: "+15551230000", body: "Second" }).draft;
    const denied = database.denyOutboundDraft(second.id, "not appropriate");
    assert.equal(denied.status, "denied");
    assert.equal(database.outboundDraftEvents(second.id).some((e) => e.event_type === "draft_denied"), true);

    // Drafts and firewall rules participate in the durable export.
    const exported = database.exportData() as { agent_outbound_drafts: Array<unknown>; communication_firewall_rules: Array<unknown> };
    assert.equal(exported.agent_outbound_drafts.length, 2);
    assert.equal(exported.communication_firewall_rules.length, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// External-contact consent ledger (work item 016, AGH-021): unknown external
// contacts default to no direct agent contact; consent limits topics/channels/hours.
test("gates direct agent contact through the consent ledger (AGH-021)", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-consent-"));
  const database = new PhoneDatabase(join(directory, "phone.sqlite3"));
  try {
    // Unknown contact (no contact_id): no direct agent contact.
    assert.equal(database.evaluateContactConsent(null, "codex", "sms").allowed, false);
    assert.equal(database.evaluateContactConsent(null, "codex", "sms").reason, "no_consent_unknown_contact");

    const contactId = database.upsertContact("Vendor", "+15558887777");
    // Known contact but no consent record: still no direct contact.
    let decision = database.evaluateContactConsent(contactId, "codex", "sms");
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "no_consent_record");

    // A record defaults to requires_review, which withholds direct contact.
    database.upsertContactConsent({ contact_id: contactId, consent_source: "operator" });
    assert.equal(database.evaluateContactConsent(contactId, "codex", "sms").reason, "requires_review");
    assert.throws(() => database.upsertContactConsent({ contact_id: 99999 }), /Contact not found/);
    assert.throws(() => database.upsertContactConsent({ contact_id: contactId, allowed_hours: "9-5" }), /HH:MM/);

    // Granting consent for sms, no review, within hours, permits direct contact.
    database.upsertContactConsent({ contact_id: contactId, allowed_channels: ["sms"], allowed_topics: ["billing"], requires_review: false, consent_source: "operator" });
    decision = database.evaluateContactConsent(contactId, "codex", "sms", "billing");
    assert.equal(decision.allowed, true);
    assert.equal(decision.has_record, true);
    // A channel or topic outside the grant is refused.
    assert.equal(database.evaluateContactConsent(contactId, "codex", "mms", "billing").reason, "channel_not_consented");
    assert.equal(database.evaluateContactConsent(contactId, "codex", "sms", "marketing").reason, "topic_not_consented");

    // Allowed-hours window is enforced (UTC); a wrap-around window works too.
    database.upsertContactConsent({ contact_id: contactId, allowed_channels: ["sms"], allowed_hours: "09:00-17:00", requires_review: false });
    assert.equal(database.evaluateContactConsent(contactId, "codex", "sms", "", "2026-06-24T12:00:00.000Z").allowed, true);
    assert.equal(database.evaluateContactConsent(contactId, "codex", "sms", "", "2026-06-24T20:00:00.000Z").reason, "outside_allowed_hours");

    // An agent-specific record overrides the any-agent wildcard.
    database.upsertContactConsent({ contact_id: contactId, agent_id: "rogue", requires_review: true });
    assert.equal(database.evaluateContactConsent(contactId, "rogue", "sms", "", "2026-06-24T12:00:00.000Z").reason, "requires_review");

    // Review timestamp and deletion, plus durable export.
    const record = database.consentLedger().find((r) => r.agent_id === "")!;
    assert.equal(record.last_reviewed_at, null);
    assert.ok(database.markConsentReviewed(record.id).last_reviewed_at);
    const exported = database.exportData() as { consent_ledger: Array<unknown> };
    assert.equal(exported.consent_ledger.length, 2);
    assert.equal(database.deleteContactConsent(record.id), true);
    assert.equal(database.consentLedger().length, 1);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Redaction profiles (work item 016, AGH-022): per-surface rules redact evidence
// packs and notifications.
test("redacts evidence packs and notifications per profile (AGH-022)", () => {
  const pack = { summary: "Ready to release", affected_resources: ["repo:ForgeLink"], diff_summary: "private diff", proposed_operation: "publish", checks: ["tests"], rollback_plan: "revert", links: ["local://x"], limitations: "none", redaction_profile: "desktop_full" };

  // desktop_full reveals everything.
  const full = redactEvidencePack(pack, "desktop_full");
  assert.equal(full.redacted, false);
  assert.equal(full.diff_summary, "private diff");

  // mobile_lock_screen shows the summary only.
  const mobile = redactEvidencePack(pack, "mobile_lock_screen");
  assert.equal(mobile.redacted, true);
  assert.equal(mobile.summary, "Ready to release");
  assert.equal(mobile.diff_summary, undefined);
  assert.equal(mobile.affected_resources, undefined);

  // email_summary keeps the summary and resources but not the diff or links.
  const email = redactEvidencePack(pack, "email_summary");
  assert.deepEqual(email.affected_resources, ["repo:ForgeLink"]);
  assert.equal(email.links, undefined);

  // sms_fallback and status_only reveal essentially nothing.
  assert.equal(redactEvidencePack(pack, "sms_fallback").summary, undefined);
  assert.equal(redactEvidencePack(pack, "status_only").summary, undefined);
  // Unknown profile fails closed to the most restrictive surface.
  assert.equal(redactEvidencePack(pack, "bogus").redaction_profile, "status_only");

  // Notifications: the title always shows; the body shows only when permitted.
  assert.equal(redactNotification("Approval needed", "Publish v2.0.4", "desktop_full").body, "Publish v2.0.4");
  const lockNote = redactNotification("Approval needed", "Publish v2.0.4", "mobile_lock_screen");
  assert.equal(lockNote.title, "Approval needed");
  assert.equal(lockNote.body, "");
  assert.equal(lockNote.redacted, true);

  // The canonical profile set is stable and ordered most-open to most-restrictive.
  assert.deepEqual(REDACTION_PROFILES.map((p) => p.id), ["desktop_full", "mobile_lock_screen", "email_summary", "sms_fallback", "status_only"]);
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
