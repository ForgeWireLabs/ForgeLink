import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOCAL_INTEGRATION_MAX_BODY_BYTES = 64 * 1024;
export const LOCAL_INTEGRATION_RATE_LIMIT_PER_MINUTE = 30;
export const LOCAL_INTEGRATION_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export type LocalIntegrationAuthMode = "token" | "hmac-sha256";
export interface LocalInboundEventContract { schema_version: 1; event_id: string; event_type: string; occurred_at: string; payload: Record<string, unknown>; }
export interface LocalOutboundDeliveryContract { schema_version: 1; delivery_id: string; integration_id: string; callback_url: string; expires_at: string; payload: Record<string, unknown>; }
export interface LocalIntegrationConfig { enabled: boolean; allowLan: boolean; integrationId: string; secret: string; rateLimitPerMinute?: number; now?: () => number; }
export interface LocalIntegrationRequest { integrationId: string; remoteAddress: string; host: string; origin: string; contentType: string; authorization: string; channelToken: string; signature: string; timestamp: string; nonce: string; body: Buffer; }
export interface LocalIntegrationDecision { ok: boolean; status: number; code: string; authMode?: LocalIntegrationAuthMode; }
export const LOCAL_INTEGRATION_SCOPES = ["agent_message", "actions"] as const;
export type LocalIntegrationScope = typeof LOCAL_INTEGRATION_SCOPES[number];
export interface LocalIntegrationRecord { id: string; label: string; scopes: LocalIntegrationScope[]; enabled: boolean; credential_hash: string; created_at: string; rotated_at: string; revoked_at: string | null; last_used_at: string | null; last_rejected_at: string | null; accepted_count: number; rejected_count: number; }
interface LocalPendingAction { id: string; integration_id: string; action: string; expires_at: number; nonce: string; status: "pending" | "completed" | "expired"; outcome: string; created_at: string; completed_at: string | null; }
interface LocalIntegrationState { version: 1; integrations: LocalIntegrationRecord[]; event_ids: string[]; pending_actions: LocalPendingAction[]; }

function utcNow(): string { return new Date().toISOString(); }
function credentialHash(secret: string): string { return createHash("sha256").update(secret).digest("hex"); }
function publicRecord(record: LocalIntegrationRecord): Omit<LocalIntegrationRecord, "credential_hash"> & { credential_configured: boolean } { const { credential_hash, ...safe } = record; return { ...safe, credential_configured: Boolean(credential_hash) }; }

export class LocalIntegrationRegistry {
  private state: LocalIntegrationState;
  private readonly path: string;
  constructor(dataDir: string) {
    this.path = join(dataDir, "local-integrations.json");
    try { this.state = JSON.parse(readFileSync(this.path, "utf8")) as LocalIntegrationState; }
    catch { this.state = { version: 1, integrations: [], event_ids: [], pending_actions: [] }; }
  }
  private save(): void { mkdirSync(dirname(this.path), { recursive: true }); const temporary = `${this.path}.tmp`; writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 }); renameSync(temporary, this.path); }
  list(): Array<ReturnType<typeof publicRecord>> { return this.state.integrations.map(publicRecord); }
  record(id: string): LocalIntegrationRecord | undefined { return this.state.integrations.find((item) => item.id === id); }
  create(id: string, label: string, scopes: LocalIntegrationScope[], secret: string): ReturnType<typeof publicRecord> {
    if (this.record(id)) throw new Error("Local integration already exists.");
    const now = utcNow(); const record: LocalIntegrationRecord = { id, label, scopes, enabled: true, credential_hash: credentialHash(secret), created_at: now, rotated_at: now, revoked_at: null, last_used_at: null, last_rejected_at: null, accepted_count: 0, rejected_count: 0 };
    this.state.integrations.push(record); this.save(); return publicRecord(record);
  }
  rotate(id: string, secret: string): ReturnType<typeof publicRecord> { const record = this.required(id); record.credential_hash = credentialHash(secret); record.rotated_at = utcNow(); record.revoked_at = null; record.enabled = true; this.save(); return publicRecord(record); }
  revoke(id: string): ReturnType<typeof publicRecord> { const record = this.required(id); record.credential_hash = ""; record.revoked_at = utcNow(); record.enabled = false; this.save(); return publicRecord(record); }
  setEnabled(id: string, enabled: boolean): ReturnType<typeof publicRecord> { const record = this.required(id); if (enabled && (!record.credential_hash || record.revoked_at)) throw new Error("Rotate the revoked credential before enabling this integration."); record.enabled = enabled; this.save(); return publicRecord(record); }
  update(id: string, label: string, scopes: LocalIntegrationScope[]): ReturnType<typeof publicRecord> { const record = this.required(id); record.label = label; record.scopes = scopes; this.save(); return publicRecord(record); }
  private required(id: string): LocalIntegrationRecord { const record = this.record(id); if (!record) throw new Error("Local integration not found."); return record; }
  verifyToken(id: string, token: string): boolean { const record = this.record(id); return Boolean(record?.enabled && !record.revoked_at && record.credential_hash && equalSecret(credentialHash(token), record.credential_hash)); }
  signingKey(id: string): string { return this.required(id).credential_hash; }
  hasScope(id: string, scope: LocalIntegrationScope): boolean { return Boolean(this.record(id)?.scopes.includes(scope)); }
  mark(id: string, accepted: boolean): void { const record = this.record(id); if (!record) return; if (accepted) { record.accepted_count += 1; record.last_used_at = utcNow(); } else { record.rejected_count += 1; record.last_rejected_at = utcNow(); } this.save(); }
  consumeEvent(id: string, eventId: string): boolean { const key = `${id}:${eventId}`; if (this.state.event_ids.includes(key)) return false; this.state.event_ids.push(key); if (this.state.event_ids.length > 5000) this.state.event_ids.splice(0, this.state.event_ids.length - 5000); this.save(); return true; }
  createPendingAction(id: string, action: string, ttlSeconds: number): { pending: LocalPendingAction; token: string } {
    if (!this.hasScope(id, "actions")) throw new Error("Integration lacks the actions scope.");
    const expiresAt = Date.now() + Math.max(30, Math.min(ttlSeconds, 3600)) * 1000; const nonce = randomBytes(16).toString("hex"); const actionId = `local-action-${nonce}`;
    const pending: LocalPendingAction = { id: actionId, integration_id: id, action, expires_at: expiresAt, nonce, status: "pending", outcome: "", created_at: utcNow(), completed_at: null };
    this.state.pending_actions.push(pending); this.save(); const payload = Buffer.from(JSON.stringify({ id: actionId, integration_id: id, action, exp: expiresAt, nonce })).toString("base64url"); const signature = createHmac("sha256", this.signingKey(id)).update(payload).digest("base64url"); return { pending, token: `${payload}.${signature}` };
  }
  completePendingAction(id: string, token: string, outcome: string, now = Date.now()): { ok: boolean; code: string; pending?: LocalPendingAction } {
    const parts = token.split("."); if (parts.length !== 2) return { ok: false, code: "invalid_action_token" };
    let payload: { id: string; integration_id: string; action: string; exp: number; nonce: string };
    try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false, code: "invalid_action_token" }; }
    if (payload.integration_id !== id || !this.record(id)?.credential_hash) return { ok: false, code: "invalid_action_token" };
    const expected = createHmac("sha256", this.signingKey(id)).update(parts[0]).digest("base64url"); if (!equalSecret(parts[1], expected)) return { ok: false, code: "invalid_action_token" };
    const pending = this.state.pending_actions.find((item) => item.id === payload.id && item.nonce === payload.nonce); if (!pending) return { ok: false, code: "pending_action_not_found" }; if (pending.status === "completed") return { ok: false, code: "action_replay_rejected" }; if (pending.expires_at <= now || payload.exp <= now) { pending.status = "expired"; this.save(); return { ok: false, code: "action_expired" }; }
    pending.status = "completed"; pending.outcome = outcome; pending.completed_at = utcNow(); this.save(); return { ok: true, code: "completed", pending };
  }
  pendingActions(id?: string): LocalPendingAction[] { return this.state.pending_actions.filter((item) => !id || item.integration_id === id).map((item) => ({ ...item, nonce: "[redacted]" })); }
}

function normalizedAddress(value: string): string { return value.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "").toLowerCase(); }
export function isLoopbackAddress(value: string): boolean { const address = normalizedAddress(value); return address === "::1" || address === "localhost" || address === "127.0.0.1" || address.startsWith("127."); }
export function isLanAddress(value: string): boolean {
  const address = normalizedAddress(value);
  if (isLoopbackAddress(address) || /^10\./.test(address) || /^192\.168\./.test(address)) return true;
  const match = address.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31) || address.startsWith("fc") || address.startsWith("fd");
}
function hostName(value: string): string { const text = value.trim().toLowerCase(); if (!text) return ""; if (text.startsWith("[")) return text.slice(1, text.indexOf("]")); return text.split(":")[0]; }
function permittedHost(value: string, allowLan: boolean): boolean {
  const host = hostName(value);
  if (!host) return false;
  if (isLoopbackAddress(host)) return true;
  return allowLan && (isLanAddress(host) || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa"));
}
function equalSecret(supplied: string, expected: string): boolean {
  if (!supplied || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}
export function loadLocalIntegrationConfig(): LocalIntegrationConfig {
  return { enabled: process.env.FORGELINK_LOCAL_INTEGRATIONS_ENABLED === "true", allowLan: process.env.FORGELINK_LOCAL_INTEGRATIONS_ALLOW_LAN === "true", integrationId: (process.env.FORGELINK_LOCAL_INTEGRATION_ID || "default").trim(), secret: process.env.FORGELINK_LOCAL_INTEGRATION_SECRET || "" };
}

export class LocalIntegrationBoundary {
  private readonly hits = new Map<string, number[]>();
  private readonly nonces = new Map<string, number>();
  constructor(private readonly config: LocalIntegrationConfig, private readonly registry?: LocalIntegrationRegistry) {}
  capabilities(): Record<string, unknown> {
    const managed = this.registry?.list() ?? []; const configured = this.registry ? managed.length > 0 : Boolean(this.config.secret && this.config.integrationId); const enabled = this.registry ? managed.some((item) => item.enabled && !item.revoked_at) : this.config.enabled && configured;
    return { schema_version: 1, enabled, state: enabled ? "ready" : "disabled", exposure: this.config.allowLan ? "operator_opt_in_lan" : "loopback_only", auth_modes: ["token", "hmac-sha256"], inbound: { route: "/local-integrations/:integration_id/events", max_body_bytes: LOCAL_INTEGRATION_MAX_BODY_BYTES, normalized_types: ["agent_message"] }, outbound: { state: "pending_actions_available", route: "/local-integrations/:integration_id/actions/:signed_token" }, replay_window_seconds: LOCAL_INTEGRATION_SIGNATURE_WINDOW_MS / 1000, rate_limit_per_minute: this.config.rateLimitPerMinute ?? LOCAL_INTEGRATION_RATE_LIMIT_PER_MINUTE, diagnostics: { healthy: enabled, integration_count: this.registry ? managed.length : configured ? 1 : 0, credentials_configured: configured, credential_values_redacted: true } };
  }
  inspect(request: LocalIntegrationRequest): LocalIntegrationDecision {
    const now = (this.config.now ?? Date.now)();
    const managed = this.registry?.record(request.integrationId);
    if (this.registry && !managed) return { ok: false, status: 404, code: "integration_not_found" };
    if (this.registry ? (!managed?.enabled || Boolean(managed.revoked_at)) : (!this.config.enabled || !this.config.secret)) return { ok: false, status: 503, code: "local_integration_disabled" };
    if (!this.registry && request.integrationId !== this.config.integrationId) return { ok: false, status: 404, code: "integration_not_found" };
    if (!(this.config.allowLan ? isLanAddress(request.remoteAddress) : isLoopbackAddress(request.remoteAddress))) return { ok: false, status: 403, code: "network_scope_rejected" };
    if (!permittedHost(request.host, this.config.allowLan)) return { ok: false, status: 400, code: "host_rejected" };
    if (request.origin && request.origin !== "null") {
      try { const origin = new URL(request.origin); if (!permittedHost(origin.host, this.config.allowLan) || hostName(origin.host) !== hostName(request.host)) return { ok: false, status: 403, code: "origin_rejected" }; }
      catch { return { ok: false, status: 400, code: "origin_rejected" }; }
    }
    if (!request.contentType.toLowerCase().startsWith("application/json")) return { ok: false, status: 415, code: "json_required" };
    if (!request.body.length || request.body.length > LOCAL_INTEGRATION_MAX_BODY_BYTES) return { ok: false, status: 413, code: "payload_out_of_bounds" };
    const key = `${request.integrationId}:${normalizedAddress(request.remoteAddress)}`;
    const hits = (this.hits.get(key) ?? []).filter((value) => value > now - 60_000);
    if (hits.length >= (this.config.rateLimitPerMinute ?? LOCAL_INTEGRATION_RATE_LIMIT_PER_MINUTE)) return { ok: false, status: 429, code: "rate_limited" };
    hits.push(now); this.hits.set(key, hits);
    const bearer = request.authorization.startsWith("Bearer ") ? request.authorization.slice(7) : "";
    const tokenValid = this.registry ? this.registry.verifyToken(request.integrationId, request.channelToken || bearer) : equalSecret(request.channelToken || bearer, this.config.secret);
    if (tokenValid) return { ok: true, status: 200, code: "authenticated", authMode: "token" };
    const timestampMs = Number(request.timestamp) * 1000;
    if (!request.signature || !request.nonce || !Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > LOCAL_INTEGRATION_SIGNATURE_WINDOW_MS) return { ok: false, status: 401, code: "authentication_required" };
    for (const [nonce, expires] of this.nonces) if (expires <= now) this.nonces.delete(nonce);
    const nonceKey = `${request.integrationId}:${request.nonce}`;
    if (this.nonces.has(nonceKey)) return { ok: false, status: 409, code: "replay_rejected" };
    const signingKey = this.registry ? this.registry.signingKey(request.integrationId) : this.config.secret;
    const expected = createHmac("sha256", signingKey).update(`${request.timestamp}.${request.nonce}.`).update(request.body).digest("hex");
    if (!equalSecret(request.signature, expected)) return { ok: false, status: 401, code: "authentication_required" };
    this.nonces.set(nonceKey, now + LOCAL_INTEGRATION_SIGNATURE_WINDOW_MS);
    return { ok: true, status: 200, code: "authenticated", authMode: "hmac-sha256" };
  }
}
