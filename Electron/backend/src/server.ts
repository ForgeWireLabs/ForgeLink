import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { PhoneDatabase } from "./database";
import { utcNow } from "./phone";
import { loadTwilioConfig, sendTwilioMessage, validateTwilioSignature } from "./twilio";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPLOADS = new Set([".gif", ".jpeg", ".jpg", ".pdf", ".png", ".txt", ".webp"]);
const MIME_TYPES: Record<string, string> = { ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".png": "image/png", ".txt": "text/plain", ".webp": "image/webp" };

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

export interface BackendOptions { host: string; port: number; dataDir: string; }

export function createBackend(options: BackendOptions): { server: Server; database: PhoneDatabase } {
  const uploadsDir = join(options.dataDir, "uploads");
  const database = new PhoneDatabase(join(options.dataDir, "phone.sqlite3"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${options.host}:${options.port}`);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, { ok: true, runtime: "node" });
      if (request.method === "GET" && url.pathname === "/api/threads") return sendJson(response, database.threads());
      if (request.method === "GET" && url.pathname === "/api/messages") return sendJson(response, database.messages(Number(url.searchParams.get("thread_id") || 0), url.searchParams.get("before") || undefined));
      if (request.method === "GET" && url.pathname === "/api/contacts") return sendJson(response, database.contacts(url.searchParams.get("q") || ""));
      if (request.method === "GET" && url.pathname === "/api/config-status") {
        const config = loadTwilioConfig();
        return sendJson(response, { account_sid: !!config.accountSid, auth_token: !!config.authToken, phone_number: !!config.phoneNumber, public_base_url: !!config.publicBaseUrl });
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
        const result = await sendTwilioMessage(String(payload.to || ""), String(payload.body || ""), media);
        database.addMessage({ id: String(result.sid), number: String(result.to), direction: "outbound", body: String(result.body || ""), media_urls: media, status: String(result.status || "queued"), ts: utcNow() });
        return sendJson(response, { ok: true, sid: result.sid });
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
        database.updateMessageStatus(fields.MessageSid || "", fields.MessageStatus || "");
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
