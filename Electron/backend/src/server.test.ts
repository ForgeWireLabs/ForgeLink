import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AddressInfo } from "node:net";
import { createBackend } from "./server";

const apiToken = "local-api-test-token";
const authorized = (headers: HeadersInit = {}): HeadersInit => ({ ...headers, Authorization: `Bearer ${apiToken}` });

function signature(baseUrl: string, pathname: string, fields: Record<string, string>, token: string): string {
  const value = `${baseUrl}${pathname}${Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("")}`;
  return createHmac("sha1", token).update(value).digest("base64");
}

test("serves health and contact HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-http-"));
  const { server } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: "Bearer wrong-token" } })).status, 401);

    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: authorized() });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, runtime: "node" });

    const saved = await fetch(`http://127.0.0.1:${port}/api/contacts`, {
      method: "POST",
      headers: authorized({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Ada", number: "+15551234567" })
    });
    assert.equal(saved.status, 200);
    const contacts = await fetch(`http://127.0.0.1:${port}/api/contacts`, { headers: authorized() }).then((response) => response.json()) as Array<Record<string, unknown>>;
    assert.equal(contacts[0].name, "Ada");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserves webhook, status, upload, and media HTTP contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-parity-"));
  const previous = {
    authToken: process.env.TWILIO_AUTH_TOKEN,
    publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL
  };
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  const publicUrl = "https://phone.example.com";
  process.env.TWILIO_PUBLIC_BASE_URL = publicUrl;
  try {
    const inbound = { From: "+15551234567", Body: "Inbound hello", MessageSid: "SM-IN", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media/photo.jpg" };
    const rejected = await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" }, body: new URLSearchParams(inbound) });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, "/webhooks/sms", inbound, "test-token") }, body: new URLSearchParams(inbound) });
    assert.equal(accepted.status, 200);
    const thread = database.threads()[0];
    const stored = database.messages(thread.id)[0];
    assert.equal(stored.body, "Inbound hello");
    assert.equal(stored.media_urls, "https://api.twilio.com/media/photo.jpg");

    const statusFields = { MessageSid: "SM-IN", MessageStatus: "delivered" };
    const statusResponse = await fetch(`${localUrl}/webhooks/status`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, "/webhooks/status", statusFields, "test-token") }, body: new URLSearchParams(statusFields) });
    assert.equal(statusResponse.status, 200);
    assert.equal(database.messages(thread.id)[0].status, "delivered");

    const form = new FormData();
    form.append("file", new File(["image-data"], "photo.png", { type: "image/png" }));
    const uploaded = await fetch(`${localUrl}/upload`, { method: "POST", headers: authorized(), body: form });
    assert.equal(uploaded.status, 200);
    const uploadedPayload = await uploaded.json() as { url: string };
    assert.match(uploadedPayload.url, /^https:\/\/phone\.example\.com\/media\/[A-Za-z0-9_-]+\.png$/);
    const mediaPath = new URL(uploadedPayload.url).pathname;
    const media = await fetch(`${localUrl}${mediaPath}`);
    assert.equal(media.status, 200);
    assert.equal(await media.text(), "image-data");

    const invalidForm = new FormData();
    invalidForm.append("file", new File(["bad"], "script.exe"));
    assert.equal((await fetch(`${localUrl}/upload`, { method: "POST", headers: authorized(), body: invalidForm })).status, 400);
    assert.equal((await fetch(`${localUrl}/media/../phone.sqlite3`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous.authToken;
    if (previous.publicBaseUrl === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previous.publicBaseUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backs up, exports, restores, and reports managed data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-data-api-"));
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    database.upsertContact("Before backup", "+15551234567");
    mkdirSync(join(directory, "uploads"), { recursive: true });
    writeFileSync(join(directory, "uploads", "proof.txt"), "before backup");
    const backedUp = await fetch(`${localUrl}/api/data/backup`, { method: "POST", headers: authorized() });
    assert.equal(backedUp.status, 200);
    database.upsertContact("After backup", "+15557654321");
    writeFileSync(join(directory, "uploads", "proof.txt"), "after backup");

    const exported = await fetch(`${localUrl}/api/data/export`, { method: "POST", headers: authorized() });
    assert.equal(exported.status, 200);
    const exportName = ((await exported.json()) as { name: string }).name;
    assert.match(exportName, /^export-.*\.json$/);

    const restored = await fetch(`${localUrl}/api/data/restore-latest`, { method: "POST", headers: authorized() });
    assert.equal(restored.status, 200);
    assert.deepEqual(database.contacts().map((contact) => contact.name), ["Before backup"]);
    assert.equal(readFileSync(join(directory, "uploads", "proof.txt"), "utf8"), "before backup");

    const status = await fetch(`${localUrl}/api/data/status`, { headers: authorized() }).then((response) => response.json()) as { schema_version: number; backup_count: number; latest_backup: string };
    assert.equal(status.schema_version, 3);
    assert.equal(status.backup_count, 1);
    assert.match(status.latest_backup, /^backup-/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists failed sends, retries them, and ignores duplicate inbound delivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "twilio-phone-send-retry-"));
  const previous = { authToken: process.env.TWILIO_AUTH_TOKEN, publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL };
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example.com";
  let attempt = 0;
  const sendMessage = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("Twilio request timed out.");
    return { sid: "SM-RETRY", status: "queued" };
  };
  const { server, database } = createBackend({ host: "127.0.0.1", port: 0, dataDir: directory, apiToken, sendMessage });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const localUrl = `http://127.0.0.1:${port}`;
  try {
    const failed = await fetch(`${localUrl}/api/send`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ local_id: "local-retry", to: "+15551234567", body: "Persist me", media_urls: [] }) });
    assert.equal(failed.status, 502);
    const thread = database.threads()[0];
    assert.equal(database.messages(thread.id)[0].status, "failed");
    const duplicate = await fetch(`${localUrl}/api/send`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ local_id: "local-retry", to: "+15551234567", body: "Persist me", media_urls: [] }) });
    assert.equal(duplicate.status, 202);
    assert.equal(attempt, 1);
    const retried = await fetch(`${localUrl}/api/retry`, { method: "POST", headers: authorized({ "Content-Type": "application/json" }), body: JSON.stringify({ id: "local-retry" }) });
    assert.equal(retried.status, 200);
    assert.equal(database.messages(thread.id)[0].attempt_count, 2);

    const inbound = { From: "+15557654321", Body: "Once", MessageSid: "SM-DUP" };
    const inboundHeaders = { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature("https://phone.example.com", "/webhooks/sms", inbound, "test-token") };
    assert.equal((await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: inboundHeaders, body: new URLSearchParams(inbound) })).status, 200);
    assert.equal((await fetch(`${localUrl}/webhooks/sms`, { method: "POST", headers: inboundHeaders, body: new URLSearchParams(inbound) })).status, 200);
    const inboundThread = database.threads().find((item) => item.canonical_number === "+15557654321")!;
    assert.equal(inboundThread.unread_count, 1);
    assert.equal(database.messages(inboundThread.id).length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous.authToken;
    if (previous.publicBaseUrl === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previous.publicBaseUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
