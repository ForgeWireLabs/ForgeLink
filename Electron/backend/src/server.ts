import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { AgentAction, AgentChannelRecord, AgentUrgency, PhoneDatabase } from "./database";
import { utcNow } from "./phone";
import { fetchTrustedSignalFeed } from "./signals";
import { createTwilioAdapter, createTwilioVoiceAdapter, endTwilioCall, loadTwilioConfig, sendTwilioMessage, startTwilioCall, validateTwilioSignature } from "./twilio";
import { createChannelRegistry, PLANNED_PROVIDERS } from "./channels";
import { createTelnyxAdapter, validateTelnyxSignature } from "./telnyx";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOADS = new Set([".gif", ".jpeg", ".jpg", ".pdf", ".png", ".txt", ".webp"]);
const MIME_TYPES: Record<string, string> = { ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".png": "image/png", ".txt": "text/plain", ".webp": "image/webp" };
const BACKUP_FORMAT = "forgelink-backup-v1";
const LEGACY_BACKUP_FORMAT = "twilio-phone-backup-v1";
const AGENT_URGENCIES = new Set(["low", "normal", "high", "urgent"]);
const CHANNEL_LIMITS: Record<string, number> = { low: 60, normal: 30, high: 10, urgent: 3 };

function sendJson(response: ServerResponse, payload: unknown, status = 200): void {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "null" });
  response.end(data);
}

async function readBody(request: IncomingMessage, limit = MAX_UPLOAD_BYTES): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > limit) throw new Error("Request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return JSON.parse((await readBody(request, 64 * 1024)).toString("utf8") || "{}");
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const params = new URLSearchParams((await readBody(request)).toString("utf8"));
  return Object.fromEntries(params.entries());
}

export interface BackendOptions { host: string; port: number; dataDir: string; apiToken: string; sendMessage?: typeof sendTwilioMessage; startCall?: typeof startTwilioCall; endCall?: typeof endTwilioCall; }

function isPrivateRoute(pathname: string): boolean {
  return pathname === "/health" || pathname === "/upload" || pathname.startsWith("/api/");
}

type AuthKind = "none" | "launch" | "mcp" | "channel";

function bearerToken(request: IncomingMessage): string {
  const authorization = String(request.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasValidApiToken(token: string, expectedToken: string): boolean {
  const expected = createHash("sha256").update(expectedToken).digest();
  const supplied = createHash("sha256").update(token).digest();
  return Boolean(token) && timingSafeEqual(expected, supplied);
}

function hasValidMcpToken(token: string, expectedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const supplied = Buffer.from(sha256(token), "hex");
  return timingSafeEqual(expected, supplied);
}

function isMcpSafeRoute(method: string | undefined, pathname: string): boolean {
  if (method === "GET" && pathname === "/health") return true;
  if (method === "GET" && pathname === "/api/mcp/status") return true;
  if (method === "POST" && pathname === "/api/mcp/test-message") return true;
  if (method === "GET" && pathname === "/api/agent-messages") return true;
  if (method === "POST" && /^\/api\/agent-messages\/[^/]+\/(read|dismiss)$/.test(pathname)) return true;
  if (method === "POST" && /^\/api\/agent-messages\/[^/]+\/actions\/[^/]+$/.test(pathname)) return true;
  return false;
}

function channelToken(request: IncomingMessage): string {
  return String(request.headers["x-forgelink-channel-token"] || "");
}

function agentChannelPath(pathname: string): string | undefined {
  return pathname.match(/^\/api\/agent-channels\/([A-Za-z0-9_.:-]{1,80})\/messages$/)?.[1];
}

function hasValidAgentChannelCredential(token: string, record: AgentChannelRecord): boolean {
  if (!record.enabled || record.revoked_at || !record.credential_hash || !/^[a-f0-9]{64}$/.test(record.credential_hash)) return false;
  if (!token) return false;
  return timingSafeEqual(Buffer.from(record.credential_hash, "hex"), Buffer.from(sha256(token), "hex"));
}

function rateWindowStart(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function boundedText(value: unknown, label: string, maxLength: number, pattern = /^[\s\S]+$/): string {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || !pattern.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function optionalIso(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) throw new Error("expires_at must be an ISO timestamp.");
  return new Date(time).toISOString();
}

function agentActions(value: unknown): AgentAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("actions must be an array of up to 8 items.");
  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      id: boundedText(record.id, "action id", 40, /^[A-Za-z0-9_.:-]+$/),
      label: boundedText(record.label, "action label", 80)
    };
  });
}

function boundedOptionalNumber(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}

function actionExists(actionsJson: string, actionId: string): boolean {
  try {
    const actions = JSON.parse(actionsJson) as AgentAction[];
    return actions.some((action) => action.id === actionId);
  } catch {
    return false;
  }
}

export function createBackend(options: BackendOptions): { server: Server; database: PhoneDatabase } {
  const uploadsDir = join(options.dataDir, "uploads");
  const backupsDir = join(options.dataDir, "backups");
  const exportsDir = join(options.dataDir, "exports");
  const database = new PhoneDatabase(join(options.dataDir, "phone.sqlite3"));
  const sendMessage = options.sendMessage || sendTwilioMessage;
  const startCall = options.startCall || startTwilioCall;
  const endCall = options.endCall || endTwilioCall;
  // Provider-neutral channel registry (work item 015). Twilio is the first
  // SMS/MMS edge adapter; its send delegates to the injectable sendMessage seam.
  const channels = createChannelRegistry();
  const twilioAdapter = createTwilioAdapter(sendMessage);
  channels.register(twilioAdapter);
  const twilioVoiceAdapter = createTwilioVoiceAdapter(startCall, endCall);
  channels.register(twilioVoiceAdapter);
  // Native local channel (CLV-004): delivers into the local inbox with no provider,
  // so the human loop works when no telecom provider is configured.
  channels.register({
    capabilities: () => ({ kind: "native", provider: "local", displayName: "Local", capabilities: ["local_delivery"] }),
    supports: (capability) => capability === "local_delivery",
    validateCredentials: async () => ({ ok: true }),
    send: async (message) => {
      const id = `local-${randomUUID()}`;
      database.addMessage({ id, number: message.to || "local", direction: "inbound", body: message.body, media_urls: message.mediaUrls || [], status: "received", ts: utcNow() });
      return { providerMessageId: id, status: "delivered" };
    }
  });
  // Telnyx SMS/MMS edge (CLV-007): the second provider, registered when configured.
  // The adapter's pure normalization is used by the webhook regardless of registration.
  const telnyxAdapter = createTelnyxAdapter();
  if (process.env.TELNYX_API_KEY && process.env.TELNYX_PHONE_NUMBER) channels.register(telnyxAdapter);
  // Mobile companion (CLV-006): planned, authenticated, disabled unless explicitly
  // enabled, and never any public relay.
  const companionEnabled = process.env.FORGELINK_COMPANION_ENABLED === "1";

  const datedName = (prefix: string, suffix = "") => `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}${suffix}`;
  const backupNames = async () => (await readdir(backupsDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^backup-[A-Za-z0-9-]+$/.test(entry.name)).map((entry) => entry.name).sort().reverse();
  const dataStatus = async () => {
    const backups = await backupNames();
    return { schema_version: database.state.schemaVersion, latest_backup: backups[0] || null, backup_count: backups.length, recovered_from: database.state.recoveredFrom ? database.state.recoveredFrom.split(/[\\/]/).pop() : null, migration_backup: database.state.migrationBackup ? database.state.migrationBackup.split(/[\\/]/).pop() : null };
  };
  const createBackup = async () => {
    const name = datedName("backup");
    const directory = join(backupsDir, name);
    await mkdir(directory, { recursive: true });
    try {
      await database.backupTo(join(directory, "phone.sqlite3"));
      if (await stat(uploadsDir).then((value) => value.isDirectory()).catch(() => false)) await cp(uploadsDir, join(directory, "uploads"), { recursive: true });
      await writeFile(join(directory, "manifest.json"), JSON.stringify({ format: BACKUP_FORMAT, created_at: utcNow(), schema_version: database.state.schemaVersion }, null, 2), { mode: 0o600 });
      return { name };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  };
  const restoreLatest = async () => {
    const latest = (await backupNames())[0];
    if (!latest) throw new Error("No managed backup is available.");
    const directory = join(backupsDir, latest);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as { format?: string };
    if (![BACKUP_FORMAT, LEGACY_BACKUP_FORMAT].includes(manifest.format || "")) throw new Error("The latest backup manifest is invalid.");
    const uploadsRollback = `${uploadsDir}.before-restore`;
    await rm(uploadsRollback, { recursive: true, force: true });
    if (await stat(uploadsDir).then((value) => value.isDirectory()).catch(() => false)) await rename(uploadsDir, uploadsRollback);
    try {
      database.restoreFrom(join(directory, "phone.sqlite3"));
      if (await stat(join(directory, "uploads")).then((value) => value.isDirectory()).catch(() => false)) await cp(join(directory, "uploads"), uploadsDir, { recursive: true });
      await rm(uploadsRollback, { recursive: true, force: true });
      return { name: latest };
    } catch (error) {
      await rm(uploadsDir, { recursive: true, force: true });
      if (await stat(uploadsRollback).then((value) => value.isDirectory()).catch(() => false)) await rename(uploadsRollback, uploadsDir);
      throw error;
    }
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${options.host}:${options.port}`);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-ForgeLink-Channel-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
        return response.end();
      }
      let auth: AuthKind = "none";
      if (isPrivateRoute(url.pathname)) {
        const token = bearerToken(request);
        const channelId = request.method === "POST" ? agentChannelPath(url.pathname) : undefined;
        if (channelId) {
          const record = database.agentChannelRecord(channelId);
          if (record && hasValidAgentChannelCredential(channelToken(request), record)) auth = "channel";
          else {
            database.markAgentChannelRejected(channelId, "unknown", record?.revoked_at ? "revoked" : record && !record.enabled ? "disabled" : "invalid_credential");
            return sendJson(response, { error: "Unauthorized agent channel credential" }, 401);
          }
        } else if (hasValidApiToken(token, options.apiToken)) auth = "launch";
        else {
          const record = database.mcpTokenRecord();
          if (record && !record.revoked_at && hasValidMcpToken(token, record.token_hash) && isMcpSafeRoute(request.method, url.pathname)) {
            auth = "mcp";
            database.markMcpTokenUsed();
          }
        }
        if (auth === "none") return sendJson(response, { error: "Unauthorized" }, 401);
      }
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, { ok: true, runtime: "node" });
      if (request.method === "GET" && url.pathname === "/api/diagnostics") return sendJson(response, {
        ok: true,
        runtime: "node",
        app_version: process.env.FORGELINK_APP_VERSION || "unknown",
        node_version: process.version,
        platform: process.platform,
        schema_version: database.state.schemaVersion,
        uptime_seconds: Math.round(process.uptime()),
        // Redacted by design (PR-015): booleans only, never credential/message/contact/media values.
        credentials_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
        public_base_url_configured: Boolean(process.env.TWILIO_PUBLIC_BASE_URL),
        local_only: !Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
        channels: channels.list(),
        planned_channels: PLANNED_PROVIDERS,
        companion: companionEnabled ? "enabled" : "planned"
      });
      if (url.pathname === "/api/companion/pair" || url.pathname === "/api/companion/status") {
        // CLV-006 planning gate: disabled by default, authenticated (under /api/),
        // LAN-only by design, never a public relay.
        if (!companionEnabled) return sendJson(response, { enabled: false, status: "planned", message: "Mobile companion pairing is not enabled in this build." }, 503);
        return sendJson(response, { enabled: true, status: "available", transport: "lan", relay: "none" });
      }
      if (request.method === "GET" && url.pathname === "/api/threads") return sendJson(response, database.threads());
      if (request.method === "GET" && url.pathname === "/api/messages") return sendJson(response, database.messages(Number(url.searchParams.get("thread_id") || 0), url.searchParams.get("before") || undefined));
      if (request.method === "GET" && url.pathname === "/api/draft") return sendJson(response, { body: database.draft(Number(url.searchParams.get("thread_id") || 0)) });
      if (request.method === "GET" && url.pathname === "/api/contacts") return sendJson(response, database.contacts(url.searchParams.get("q") || ""));
      if (request.method === "GET" && url.pathname === "/api/contacts/timeline") {
        return sendJson(response, database.contactTimeline(Number(url.searchParams.get("contact_id") || 0), url.searchParams.get("include_agent_details") === "1", Number(url.searchParams.get("limit") || 100)));
      }
      if (request.method === "GET" && url.pathname === "/api/config-status") {
        const config = loadTwilioConfig();
        return sendJson(response, { account_sid: !!config.accountSid, auth_token: !!config.authToken, phone_number: !!config.phoneNumber, public_base_url: !!config.publicBaseUrl });
      }
      if (request.method === "GET" && url.pathname === "/api/data/status") return sendJson(response, await dataStatus());
      if (request.method === "GET" && url.pathname === "/api/mcp/status") return sendJson(response, { ...database.mcpTokenStatus(), token_hash_present: Boolean(database.mcpTokenRecord()?.token_hash) });
      if (request.method === "GET" && url.pathname === "/api/agent-channels") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, database.agentChannels());
      }
      if (request.method === "POST" && url.pathname === "/api/agent-channels") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const payload = await readJson(request);
        const channelId = boundedText(payload.channel_id, "channel id", 80, /^[A-Za-z0-9_.:-]+$/);
        const label = boundedText(payload.label || channelId, "channel label", 120);
        const token = `flchan_${randomBytes(32).toString("base64url")}`;
        return sendJson(response, { ok: true, token, channel: database.setAgentChannelCredential(channelId, label, sha256(token)) }, 201);
      }
      const channelTokenMatch = url.pathname.match(/^\/api\/agent-channels\/([A-Za-z0-9_.:-]{1,80})\/token$/);
      if (request.method === "POST" && channelTokenMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const existing = database.agentChannelRecord(channelTokenMatch[1]);
        const token = `flchan_${randomBytes(32).toString("base64url")}`;
        return sendJson(response, { ok: true, token, channel: database.setAgentChannelCredential(channelTokenMatch[1], existing?.label || channelTokenMatch[1], sha256(token)) });
      }
      const channelRevokeMatch = url.pathname.match(/^\/api\/agent-channels\/([A-Za-z0-9_.:-]{1,80})\/revoke$/);
      if (request.method === "POST" && channelRevokeMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, { ok: true, channel: database.revokeAgentChannel(channelRevokeMatch[1]) });
      }
      const channelEnabledMatch = url.pathname.match(/^\/api\/agent-channels\/([A-Za-z0-9_.:-]{1,80})\/(enable|disable)$/);
      if (request.method === "POST" && channelEnabledMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, { ok: true, channel: database.setAgentChannelEnabled(channelEnabledMatch[1], channelEnabledMatch[2] === "enable") });
      }
      if (request.method === "POST" && url.pathname === "/api/mcp/token") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const token = `flmcp_${randomBytes(32).toString("base64url")}`;
        const status = database.setMcpTokenHash(sha256(token));
        return sendJson(response, { ok: true, token, status });
      }
      if (request.method === "POST" && url.pathname === "/api/mcp/token/revoke") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, { ok: true, status: database.revokeMcpToken() });
      }
      if (request.method === "POST" && url.pathname === "/api/mcp/test-message") {
        const payload = auth === "launch" ? await readJson(request).catch((): Record<string, unknown> => ({})) : {};
        const message = database.addAgentMessage({
          id: `mcp-test-${randomUUID()}`,
          channel_id: String(payload.channel_id || "forgewire"),
          source: "forgelink-mcp-test",
          kind: "mcp_bridge_test",
          urgency: "low",
          title: "ForgeLink MCP bridge test",
          body: "This local test confirms an MCP token can reach ForgeLink.",
          actions: [{ id: "ack", label: "Acknowledge" }]
        });
        return sendJson(response, { ok: true, message, status: database.markMcpTest("passed") });
      }
      if (request.method === "GET" && url.pathname === "/api/agent-messages") return sendJson(response, database.agentMessages());
      if (request.method === "GET" && url.pathname === "/api/signals/subscriptions") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, database.signalSubscriptions());
      }
      if (request.method === "POST" && url.pathname === "/api/signals/subscriptions") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const payload = await readJson(request);
        const subscription = database.upsertSignalSubscription({
          url: boundedText(payload.url, "feed URL", 1000),
          title: payload.title ? boundedText(payload.title, "feed title", 160) : undefined,
          fetch_interval_minutes: boundedOptionalNumber(payload.fetch_interval_minutes, 60, 15, 10080, "fetch interval"),
          retention_days: boundedOptionalNumber(payload.retention_days, 30, 7, 3650, "signal retention")
        });
        return sendJson(response, { ok: true, subscription }, 201);
      }
      const signalStateMatch = url.pathname.match(/^\/api\/signals\/subscriptions\/([^/]+)\/(enable|disable|mute|unmute)$/);
      if (request.method === "POST" && signalStateMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const action = signalStateMatch[2];
        const subscription = database.setSignalSubscriptionState(decodeURIComponent(signalStateMatch[1]), action === "enable" ? { enabled: true } : action === "disable" ? { enabled: false } : action === "mute" ? { muted: true } : { muted: false });
        return sendJson(response, { ok: true, subscription });
      }
      const signalRefreshMatch = url.pathname.match(/^\/api\/signals\/subscriptions\/([^/]+)\/refresh$/);
      if (request.method === "POST" && signalRefreshMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        const subscription = database.signalSubscription(decodeURIComponent(signalRefreshMatch[1]));
        if (!subscription) throw new Error("Signal subscription not found.");
        if (!subscription.enabled) throw new Error("Signal subscription is paused.");
        try {
          const parsed = await fetchTrustedSignalFeed(subscription.url);
          database.updateSignalSubscriptionTitle(subscription.id, parsed.title);
          let added = 0;
          for (const item of parsed.items) {
            if (database.addSignalItem({ ...item, subscription_id: subscription.id })) added += 1;
          }
          const deleted = database.applySignalRetention(subscription.id);
          database.markSignalFetch(subscription.id, "ok");
          return sendJson(response, { ok: true, added, deleted, subscription: database.signalSubscription(subscription.id), items: database.signalItems() });
        } catch (error) {
          database.markSignalFetch(subscription.id, "failed", error instanceof Error ? error.message : String(error));
          throw error;
        }
      }
      if (request.method === "GET" && url.pathname === "/api/signals/items") {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, database.signalItems(Number(url.searchParams.get("limit") || 50)));
      }
      const signalArchiveMatch = url.pathname.match(/^\/api\/signals\/items\/([^/]+)\/archive$/);
      if (request.method === "POST" && signalArchiveMatch) {
        if (auth !== "launch") return sendJson(response, { error: "Unauthorized" }, 401);
        return sendJson(response, { ok: true, item: database.archiveSignalItem(decodeURIComponent(signalArchiveMatch[1])) });
      }
      const agentMessageMatch = url.pathname.match(/^\/api\/agent-channels\/([A-Za-z0-9_.:-]{1,80})\/messages$/);
      if (request.method === "POST" && agentMessageMatch) {
        const payload = await readJson(request);
        const urgency = String(payload.urgency || "normal");
        if (!AGENT_URGENCIES.has(urgency)) throw new Error("urgency is invalid.");
        const channelId = agentMessageMatch[1];
        const source = boundedText(payload.source, "source", 80, /^[A-Za-z0-9_.:-]+$/);
        const kind = boundedText(payload.kind, "kind", 80, /^[A-Za-z0-9_.:-]+$/);
        const policyDecision = database.agentContactPolicyDecision(source, kind, urgency);
        if (!policyDecision.allowed) {
          database.markAgentChannelRejected(channelId, urgency, policyDecision.reason);
          return sendJson(response, { error: "Contact policy rejected this agent message.", reason: policyDecision.reason, contact_id: policyDecision.contact_id }, 403);
        }
        const limit = CHANNEL_LIMITS[urgency] ?? CHANNEL_LIMITS.normal;
        const count = database.agentChannelAcceptedCount(channelId, urgency, rateWindowStart());
        if (count >= limit) {
          database.markAgentChannelRejected(channelId, urgency, "rate_limited");
          return sendJson(response, { error: "Rate limit exceeded", channel_id: channelId, urgency, limit, retry_after_seconds: 60 }, 429);
        }
        const message = database.addAgentMessage({
          id: String(payload.id || `agent-${randomUUID()}`).slice(0, 120),
          channel_id: channelId,
          source,
          kind,
          urgency: urgency as AgentUrgency,
          title: boundedText(payload.title, "title", 160),
          body: boundedText(payload.body, "body", 4000),
          actions: agentActions(payload.actions),
          expires_at: optionalIso(payload.expires_at)
        });
        database.markAgentChannelUsed(channelId, urgency);
        return sendJson(response, { ok: true, message }, 201);
      }
      const agentStatusMatch = url.pathname.match(/^\/api\/agent-messages\/([^/]+)\/(read|dismiss)$/);
      if (request.method === "POST" && agentStatusMatch) {
        const message = database.updateAgentMessageStatus(decodeURIComponent(agentStatusMatch[1]), agentStatusMatch[2] === "read" ? "read" : "dismissed");
        return sendJson(response, { ok: true, message });
      }
      const agentActionMatch = url.pathname.match(/^\/api\/agent-messages\/([^/]+)\/actions\/([^/]+)$/);
      if (request.method === "POST" && agentActionMatch) {
        const id = decodeURIComponent(agentActionMatch[1]);
        const actionId = decodeURIComponent(agentActionMatch[2]);
        const current = database.agentMessage(id);
        if (!current) throw new Error("Agent message not found.");
        if (!actionExists(current.actions, actionId)) throw new Error("Agent action not found.");
        const message = database.updateAgentMessageStatus(id, "acted", actionId);
        return sendJson(response, { ok: true, message });
      }
      if (request.method === "POST" && url.pathname === "/api/data/backup") return sendJson(response, { ok: true, ...(await createBackup()) });
      if (request.method === "POST" && url.pathname === "/api/data/restore-latest") return sendJson(response, { ok: true, ...(await restoreLatest()) });
      if (request.method === "POST" && url.pathname === "/api/data/export") {
        await mkdir(exportsDir, { recursive: true });
        const name = datedName("export", ".json");
        await writeFile(join(exportsDir, name), JSON.stringify(database.exportData(), null, 2), { mode: 0o600 });
        return sendJson(response, { ok: true, name });
      }
      if (request.method === "POST" && url.pathname === "/api/data/retention") {
        const payload = await readJson(request);
        const days = Number(payload.days);
        if (!Number.isInteger(days) || days < 30 || days > 3650) throw new Error("Retention must be between 30 and 3650 days.");
        await createBackup();
        const result = database.applyRetention(days);
        const referenced = database.referencedLocalMedia();
        let deletedUploads = 0;
        for (const entry of await readdir(uploadsDir, { withFileTypes: true }).catch(() => [])) {
          if (entry.isFile() && !referenced.has(entry.name)) { await rm(join(uploadsDir, entry.name), { force: true }); deletedUploads += 1; }
        }
        return sendJson(response, { ok: true, ...result, deletedUploads });
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        const name = url.pathname.slice("/media/".length);
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(name)) return sendJson(response, { error: "Not found" }, 404);
        const path = resolve(uploadsDir, name);
        if (!path.startsWith(resolve(uploadsDir))) return sendJson(response, { error: "Not found" }, 404);
        try {
          const data = await readFile(path);
          response.writeHead(200, { "Content-Type": MIME_TYPES[extname(name).toLowerCase()] || "application/octet-stream", "Content-Length": data.length });
          return response.end(data);
        } catch { return sendJson(response, { error: "Not found" }, 404); }
      }
      if (request.method === "POST" && url.pathname === "/api/send") {
        const payload = await readJson(request);
        const media = Array.isArray(payload.media_urls) ? payload.media_urls.map(String) : [];
        const localId = String(payload.local_id || `local-${randomUUID()}`);
        const existing = database.outboundMessage(localId);
        if (existing) return sendJson(response, { ok: true, duplicate: true, local_id: localId, status: existing.status }, 202);
        const pending = database.createPendingMessage(localId, String(payload.to || ""), String(payload.body || ""), media);
        try {
          const result = await channels.select("sms_send").send({ to: pending.number, body: pending.body, mediaUrls: media });
          database.markMessageSent(localId, result.providerMessageId || "", result.status);
          database.saveDraft(pending.thread_id, "");
          return sendJson(response, { ok: true, local_id: localId, sid: result.providerMessageId, status: result.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Message delivery failed.";
          database.markMessageFailed(localId, message);
          return sendJson(response, { error: message, local_id: localId }, 502);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/retry") {
        const payload = await readJson(request);
        const pending = database.beginRetry(String(payload.id || ""));
        try {
          const media = pending.media_urls ? pending.media_urls.split(",") : [];
          const result = await channels.select("sms_send").send({ to: pending.number, body: pending.body, mediaUrls: media });
          database.markMessageSent(pending.id, result.providerMessageId || "", result.status);
          return sendJson(response, { ok: true, local_id: pending.id, sid: result.providerMessageId, status: result.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Message delivery failed.";
          database.markMessageFailed(pending.id, message);
          return sendJson(response, { error: message, local_id: pending.id }, 502);
        }
      }
      if (request.method === "GET" && url.pathname === "/api/calls") {
        return sendJson(response, database.calls(Number(url.searchParams.get("limit") || 100)));
      }
      if (request.method === "POST" && url.pathname === "/api/calls/start") {
        const payload = await readJson(request);
        const localCallId = String(payload.local_call_id || `call-${randomUUID()}`).slice(0, 120);
        const existing = database.callByLocalId(localCallId);
        if (existing) return sendJson(response, { ok: true, duplicate: true, call: existing }, 202);
        const config = loadTwilioConfig();
        const call = database.createCall({
          localCallId,
          providerKind: "voice_edge",
          providerName: "twilio",
          direction: "outbound",
          from: payload.from ? String(payload.from) : config.phoneNumber,
          to: String(payload.to || ""),
          contactId: payload.contact_id === undefined ? undefined : Number(payload.contact_id),
          contactPointId: payload.contact_point_id === undefined ? undefined : Number(payload.contact_point_id),
          status: "queued"
        });
        try {
          const result = await channels.select("voice_start", "twilio").startCall!({
            localCallId,
            from: call.from_number || undefined,
            to: call.to_number,
            contactId: call.contact_id,
            contactPointId: call.contact_point_id
          });
          const updated = database.markCallStarted(localCallId, result.providerCallId, result.status);
          return sendJson(response, { ok: true, call: updated });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Call start failed.";
          return sendJson(response, { error: message, call: database.markCallFailed(localCallId, message) }, 502);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/calls/end") {
        const payload = await readJson(request);
        const providerCallId = String(payload.provider_call_id || database.callByLocalId(String(payload.local_call_id || ""))?.provider_call_id || "");
        if (!providerCallId) throw new Error("provider_call_id or local_call_id is required.");
        const result = await channels.select("voice_end", "twilio").endCall!(providerCallId);
        database.applyCallStatus({ providerCallId: result.providerCallId, status: result.status, endedAt: utcNow() });
        return sendJson(response, { ok: true, call: database.callByProviderCallId(result.providerCallId) || null });
      }
      if (request.method === "POST" && url.pathname === "/api/draft") {
        const payload = await readJson(request);
        database.saveDraft(Number(payload.thread_id), String(payload.body || ""));
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/contacts") {
        const payload = await readJson(request);
        return sendJson(response, { ok: true, id: database.upsertContact(String(payload.name || ""), String(payload.number || "")) });
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/from-thread") {
        const payload = await readJson(request);
        return sendJson(response, { ok: true, id: database.createContactFromThread(Number(payload.thread_id), String(payload.name || "")) });
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/update") {
        const payload = await readJson(request);
        database.updateContact(Number(payload.id), payload);
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/delete") {
        const payload = await readJson(request);
        database.deleteContact(Number(payload.id));
        return sendJson(response, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/api/contacts/points") {
        return sendJson(response, database.contactPoints(Number(url.searchParams.get("contact_id") || 0)));
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/points") {
        const payload = await readJson(request);
        return sendJson(response, { ok: true, id: database.addContactPoint(Number(payload.contact_id), String(payload.kind || "phone"), String(payload.value || ""), String(payload.label || ""), Boolean(payload.is_primary)) });
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/points/block") {
        const payload = await readJson(request);
        database.setContactPointBlocked(Number(payload.point_id), Boolean(payload.blocked));
        return sendJson(response, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/api/contacts/policy") {
        return sendJson(response, database.getContactPolicy(Number(url.searchParams.get("contact_id") || 0)));
      }
      if (request.method === "POST" && url.pathname === "/api/contacts/policy") {
        const payload = await readJson(request);
        return sendJson(response, database.setContactPolicy(Number(payload.contact_id), payload));
      }
      if (request.method === "POST" && url.pathname === "/api/link-thread") {
        const payload = await readJson(request);
        database.linkThread(Number(payload.thread_id), Number(payload.contact_id));
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/unknown-number/ignore") {
        const payload = await readJson(request);
        database.ignoreThread(Number(payload.thread_id));
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/unknown-number/block") {
        const payload = await readJson(request);
        return sendJson(response, { ok: true, id: database.blockThread(Number(payload.thread_id)) });
      }
      if (request.method === "POST" && url.pathname === "/upload") {
        const config = loadTwilioConfig();
        if (!config.publicBaseUrl) throw new Error("Set TWILIO_PUBLIC_BASE_URL before attaching media.");
        const webRequest = new Request(`http://${options.host}:${options.port}${url.pathname}`, { method: "POST", headers: request.headers as HeadersInit, body: Readable.toWeb(request) as ReadableStream, duplex: "half" } as RequestInit & { duplex: string });
        const form = await webRequest.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.name) throw new Error("No file was uploaded.");
        const extension = extname(file.name).toLowerCase();
        if (!ALLOWED_UPLOADS.has(extension)) throw new Error(`Unsupported file type: ${extension || "unknown"}`);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 20 MB upload limit.");
        await mkdir(uploadsDir, { recursive: true });
        const name = `${randomBytes(16).toString("base64url")}${extension}`;
        await writeFile(join(uploadsDir, name), Buffer.from(await file.arrayBuffer()));
        return sendJson(response, { url: `${config.publicBaseUrl}/media/${name}` });
      }
      if (request.method === "POST" && url.pathname === "/webhooks/sms") {
        const fields = await readForm(request);
        if (!validateTwilioSignature(url.pathname, fields, String(request.headers["x-twilio-signature"] || ""))) return sendJson(response, { error: "Invalid Twilio signature" }, 403);
        const inbound = twilioAdapter.parseInbound!(fields);
        database.addMessage({ id: inbound.providerMessageId || randomBytes(16).toString("hex"), number: inbound.from, direction: "inbound", body: inbound.body, media_urls: inbound.mediaUrls, status: "received", ts: utcNow() });
        const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Response/>');
        response.writeHead(200, { "Content-Type": "application/xml", "Content-Length": xml.length });
        return response.end(xml);
      }
      if (request.method === "POST" && url.pathname === "/webhooks/status") {
        const fields = await readForm(request);
        if (!validateTwilioSignature(url.pathname, fields, String(request.headers["x-twilio-signature"] || ""))) return sendJson(response, { error: "Invalid Twilio signature" }, 403);
        const update = twilioAdapter.parseStatus!(fields);
        database.updateDeliveryStatus(update.providerMessageId, update.status);
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/webhooks/voice/twiml") {
        const fields = await readForm(request);
        if (!validateTwilioSignature(url.pathname, fields, String(request.headers["x-twilio-signature"] || ""))) return sendJson(response, { error: "Invalid Twilio signature" }, 403);
        const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="60"/></Response>');
        response.writeHead(200, { "Content-Type": "application/xml", "Content-Length": xml.length });
        return response.end(xml);
      }
      if (request.method === "POST" && url.pathname === "/webhooks/voice/status") {
        const fields = await readForm(request);
        if (!validateTwilioSignature(url.pathname, fields, String(request.headers["x-twilio-signature"] || ""))) return sendJson(response, { error: "Invalid Twilio signature" }, 403);
        if (fields.CallSid && !database.callByProviderCallId(fields.CallSid) && String(fields.Direction || "").startsWith("inbound")) {
          const inbound = twilioVoiceAdapter.parseInboundCall!(fields);
          database.createCall({
            localCallId: `twilio-${inbound.providerCallId}`,
            providerKind: "voice_edge",
            providerName: "twilio",
            providerCallId: inbound.providerCallId,
            direction: "inbound",
            from: inbound.from,
            to: inbound.to,
            status: inbound.status,
            startedAt: inbound.occurredAt || null
          });
        }
        const update = twilioVoiceAdapter.parseCallStatus!(fields);
        if (update.providerCallId) database.applyCallStatus(update);
        return sendJson(response, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/webhooks/telnyx") {
        // Telnyx posts JSON events signed with Ed25519 over `${timestamp}|${rawBody}`.
        const raw = (await readBody(request)).toString("utf8");
        const timestamp = String(request.headers["telnyx-timestamp"] || "");
        const signature = String(request.headers["telnyx-signature-ed25519"] || "");
        if (!validateTelnyxSignature(raw, timestamp, signature, process.env.TELNYX_PUBLIC_KEY || "")) return sendJson(response, { error: "Invalid Telnyx signature" }, 403);
        let event: unknown;
        try { event = JSON.parse(raw); } catch { return sendJson(response, { error: "Invalid payload" }, 400); }
        const eventType = ((event as { data?: { event_type?: string } })?.data?.event_type) || "";
        if (eventType === "message.received") {
          const inbound = telnyxAdapter.parseInbound!(event);
          database.addMessage({ id: inbound.providerMessageId || randomBytes(16).toString("hex"), number: inbound.from, direction: "inbound", body: inbound.body, media_urls: inbound.mediaUrls, status: "received", ts: utcNow() });
        } else {
          const update = telnyxAdapter.parseStatus!(event);
          if (update.providerMessageId) database.updateDeliveryStatus(update.providerMessageId, update.status);
        }
        return sendJson(response, { ok: true });
      }
      return sendJson(response, { error: "Not found" }, 404);
    } catch (error) {
      return sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  server.on("close", () => database.close());
  return { server, database };
}
