import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { PhoneDatabase } from "./database";
import { utcNow } from "./phone";
import { loadTwilioConfig, sendTwilioMessage, validateTwilioSignature } from "./twilio";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOADS = new Set([".gif", ".jpeg", ".jpg", ".pdf", ".png", ".txt", ".webp"]);
const MIME_TYPES: Record<string, string> = { ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".png": "image/png", ".txt": "text/plain", ".webp": "image/webp" };
const BACKUP_FORMAT = "forgelink-backup-v1";
const LEGACY_BACKUP_FORMAT = "twilio-phone-backup-v1";

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
  return JSON.parse((await readBody(request)).toString("utf8") || "{}");
}

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const params = new URLSearchParams((await readBody(request)).toString("utf8"));
  return Object.fromEntries(params.entries());
}

export interface BackendOptions { host: string; port: number; dataDir: string; apiToken: string; sendMessage?: typeof sendTwilioMessage; }

function isPrivateRoute(pathname: string): boolean {
  return pathname === "/health" || pathname === "/upload" || pathname.startsWith("/api/");
}

function hasValidApiToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = String(request.headers.authorization || "");
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expected = createHash("sha256").update(expectedToken).digest();
  const supplied = createHash("sha256").update(suppliedToken).digest();
  return Boolean(suppliedToken) && timingSafeEqual(expected, supplied);
}

export function createBackend(options: BackendOptions): { server: Server; database: PhoneDatabase } {
  const uploadsDir = join(options.dataDir, "uploads");
  const backupsDir = join(options.dataDir, "backups");
  const exportsDir = join(options.dataDir, "exports");
  const database = new PhoneDatabase(join(options.dataDir, "phone.sqlite3"));
  const sendMessage = options.sendMessage || sendTwilioMessage;

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
        response.writeHead(204, { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
        return response.end();
      }
      if (isPrivateRoute(url.pathname) && !hasValidApiToken(request, options.apiToken)) return sendJson(response, { error: "Unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, { ok: true, runtime: "node" });
      if (request.method === "GET" && url.pathname === "/api/threads") return sendJson(response, database.threads());
      if (request.method === "GET" && url.pathname === "/api/messages") return sendJson(response, database.messages(Number(url.searchParams.get("thread_id") || 0), url.searchParams.get("before") || undefined));
      if (request.method === "GET" && url.pathname === "/api/draft") return sendJson(response, { body: database.draft(Number(url.searchParams.get("thread_id") || 0)) });
      if (request.method === "GET" && url.pathname === "/api/contacts") return sendJson(response, database.contacts(url.searchParams.get("q") || ""));
      if (request.method === "GET" && url.pathname === "/api/config-status") {
        const config = loadTwilioConfig();
        return sendJson(response, { account_sid: !!config.accountSid, auth_token: !!config.authToken, phone_number: !!config.phoneNumber, public_base_url: !!config.publicBaseUrl });
      }
      if (request.method === "GET" && url.pathname === "/api/data/status") return sendJson(response, await dataStatus());
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
          const result = await sendMessage(pending.number, pending.body, media);
          database.markMessageSent(localId, String(result.sid || ""), String(result.status || "queued"));
          database.saveDraft(pending.thread_id, "");
          return sendJson(response, { ok: true, local_id: localId, sid: result.sid, status: result.status || "queued" });
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
          const result = await sendMessage(pending.number, pending.body, media);
          database.markMessageSent(pending.id, String(result.sid || ""), String(result.status || "queued"));
          return sendJson(response, { ok: true, local_id: pending.id, sid: result.sid, status: result.status || "queued" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Message delivery failed.";
          database.markMessageFailed(pending.id, message);
          return sendJson(response, { error: message, local_id: pending.id }, 502);
        }
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
      if (request.method === "POST" && url.pathname === "/api/link-thread") {
        const payload = await readJson(request);
        database.linkThread(Number(payload.thread_id), Number(payload.contact_id));
        return sendJson(response, { ok: true });
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
        const media = Object.keys(fields).filter((key) => key.startsWith("MediaUrl")).sort().map((key) => fields[key]);
        database.addMessage({ id: fields.MessageSid || randomBytes(16).toString("hex"), number: fields.From || "", direction: "inbound", body: fields.Body || "", media_urls: media, status: "received", ts: utcNow() });
        const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Response/>');
        response.writeHead(200, { "Content-Type": "application/xml", "Content-Length": xml.length });
        return response.end(xml);
      }
      if (request.method === "POST" && url.pathname === "/webhooks/status") {
        const fields = await readForm(request);
        if (!validateTwilioSignature(url.pathname, fields, String(request.headers["x-twilio-signature"] || ""))) return sendJson(response, { error: "Invalid Twilio signature" }, 403);
        database.updateDeliveryStatus(fields.MessageSid || "", fields.MessageStatus || "");
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
