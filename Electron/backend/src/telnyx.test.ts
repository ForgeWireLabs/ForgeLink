import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createTelnyxAdapter, validateTelnyxSignature, parseTelnyxInbound, parseTelnyxStatus } from "./telnyx";

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, rawB64: der.subarray(der.length - 32).toString("base64") };
}

test("Telnyx send maps to SendResult and propagates rejection", async () => {
  const adapter = createTelnyxAdapter(async () => ({ id: "tx-1", to: [{ status: "queued" }] }));
  const result = await adapter.send({ to: "+15551234567", body: "hi", mediaUrls: ["https://m/1.jpg"] });
  assert.equal(result.providerMessageId, "tx-1");
  assert.equal(result.status, "queued");
  const failing = createTelnyxAdapter(async () => { throw new Error("Telnyx rejected the message (400)."); });
  await assert.rejects(() => failing.send({ to: "+15551234567", body: "x" }), /Telnyx rejected/);
});

test("Telnyx advertises capabilities and reports missing credentials", async () => {
  const adapter = createTelnyxAdapter(async () => ({}));
  assert.equal(adapter.capabilities().provider, "telnyx");
  assert.equal(adapter.capabilities().kind, "sms_mms_edge");
  assert.ok(adapter.supports("sms_send") && adapter.supports("mms_send") && adapter.supports("media"));
  assert.ok(!adapter.supports("voice_call"));
  const prev = { key: process.env.TELNYX_API_KEY, number: process.env.TELNYX_PHONE_NUMBER };
  delete process.env.TELNYX_API_KEY; delete process.env.TELNYX_PHONE_NUMBER;
  try {
    assert.equal((await adapter.validateCredentials()).ok, false);
  } finally {
    if (prev.key === undefined) delete process.env.TELNYX_API_KEY; else process.env.TELNYX_API_KEY = prev.key;
    if (prev.number === undefined) delete process.env.TELNYX_PHONE_NUMBER; else process.env.TELNYX_PHONE_NUMBER = prev.number;
  }
});

test("Telnyx normalizes inbound SMS, inbound MMS metadata, and status", () => {
  const sms = parseTelnyxInbound({ data: { event_type: "message.received", payload: { id: "tx-in", from: { phone_number: "+15550001111" }, to: [{ phone_number: "+15550002222" }], text: "hey", media: [] } } });
  assert.deepEqual(sms, { from: "+15550001111", to: "+15550002222", body: "hey", mediaUrls: [], providerMessageId: "tx-in" });
  const mms = parseTelnyxInbound({ data: { event_type: "message.received", payload: { id: "tx-mms", from: { phone_number: "+1" }, to: [{ phone_number: "+2" }], text: "pic", media: [{ url: "https://m/a.jpg", content_type: "image/jpeg" }] } } });
  assert.deepEqual(mms.mediaUrls, ["https://m/a.jpg"]);
  assert.equal(mms.providerMessageId, "tx-mms");
  assert.deepEqual(parseTelnyxStatus({ data: { event_type: "message.finalized", payload: { id: "tx-1", to: [{ phone_number: "+1", status: "delivered" }] } } }), { providerMessageId: "tx-1", status: "delivered" });
});

test("Telnyx Ed25519 webhook signature validates and rejects tampering", () => {
  const { privateKey, rawB64 } = ed25519();
  const body = JSON.stringify({ data: { event_type: "message.received", payload: { id: "tx-in" } } });
  const ts = "1718000000";
  const signatureB64 = sign(null, Buffer.from(`${ts}|${body}`, "utf8"), privateKey).toString("base64");
  assert.equal(validateTelnyxSignature(body, ts, signatureB64, rawB64), true);
  assert.equal(validateTelnyxSignature(`${body} `, ts, signatureB64, rawB64), false); // tampered body
  assert.equal(validateTelnyxSignature(body, "1718000001", signatureB64, rawB64), false); // wrong timestamp
  assert.equal(validateTelnyxSignature(body, ts, signatureB64, ""), false); // missing key
});
