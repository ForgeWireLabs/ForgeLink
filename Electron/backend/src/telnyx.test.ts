import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { runSmsEdgeConformance } from "./channel-conformance";
import { createTelnyxAdapter, validateTelnyxCredentials, validateTelnyxSignature, parseTelnyxInbound, parseTelnyxStatus } from "./telnyx";

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, rawB64: der.subarray(der.length - 32).toString("base64") };
}

const TELNYX_ENV_KEYS = ["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER"] as const;

async function withoutTelnyxCredentials(run: () => void | Promise<void>): Promise<void> {
  const saved = Object.fromEntries(TELNYX_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of TELNYX_ENV_KEYS) delete process.env[key];
  try {
    await run();
  } finally {
    for (const key of TELNYX_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
}

// Telnyx signs `${timestamp}|${rawBody}` with Ed25519; `tamper` mutates the body
// so the conformance kit can assert rejection.
function telnyxSignatureCheck(tamper: boolean): boolean {
  const { privateKey, rawB64 } = ed25519();
  const body = JSON.stringify({ data: { event_type: "message.received", payload: { id: "tx-in" } } });
  const ts = "1718000000";
  const signatureB64 = sign(null, Buffer.from(`${ts}|${body}`, "utf8"), privateKey).toString("base64");
  return validateTelnyxSignature(tamper ? `${body} ` : body, ts, signatureB64, rawB64);
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

test("TEL-003: validates the configured Telnyx number and messaging profile through read-only API calls", async () => {
  const { rawB64 } = ed25519();
  const profileId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const calls: Array<{ url: string; method?: string }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    const data = url.includes("messaging_phone_numbers")
      ? { phone_number: "+15551234567", messaging_profile_id: profileId, features: { sms: { domestic_two_way: true } } }
      : { id: profileId, name: "ForgeLink", enabled: true };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await validateTelnyxCredentials({ apiKey: "KEY-test", phoneNumber: "+15551234567", publicKey: rawB64, profileId }, fetchImpl as typeof fetch);
  assert.deepEqual(result, { ok: true, accountName: "ForgeLink", phoneNumber: "+15551234567" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === undefined || call.method === "GET"));
});

test("TEL-003: rejects incomplete or mismatched Telnyx configuration without leaking provider bodies", async () => {
  assert.equal((await validateTelnyxCredentials({ apiKey: "", phoneNumber: "", publicKey: "", profileId: "" })).ok, false);
  const { rawB64 } = ed25519();
  const rejected = async (): Promise<Response> => new Response(JSON.stringify({ errors: [{ detail: "private provider response" }] }), { status: 401 });
  const result = await validateTelnyxCredentials({ apiKey: "KEY-test", phoneNumber: "+15551234567", publicKey: rawB64, profileId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }, rejected as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error || "", /failed \(401\)/);
  assert.doesNotMatch(result.error || "", /private provider response/);
});

// Shared provider conformance kit (CLV-021): Telnyx must pass the same bar as
// every other SMS/MMS edge adapter.
runSmsEdgeConformance({
  provider: "telnyx",
  makeAdapter: (sender) => createTelnyxAdapter(sender),
  send: {
    successSender: async () => ({ id: "tx-conf", to: [{ status: "queued" }] }),
    expected: { providerMessageId: "tx-conf", status: "queued" },
    rejectingSender: async () => { throw new Error("Telnyx rejected the message (400)."); },
    rejectionPattern: /Telnyx rejected/
  },
  inbound: {
    sms: {
      payload: { data: { event_type: "message.received", payload: { id: "tx-in", from: { phone_number: "+15550001111" }, to: [{ phone_number: "+15550002222" }], text: "hey", media: [] } } },
      expected: { from: "+15550001111", to: "+15550002222", body: "hey", mediaUrls: [], providerMessageId: "tx-in" }
    },
    mms: {
      payload: { data: { event_type: "message.received", payload: { id: "tx-mms", from: { phone_number: "+15550001111" }, to: [{ phone_number: "+15550002222" }], text: "pic", media: [{ url: "https://m/a.jpg", content_type: "image/jpeg" }] } } },
      expectedMediaUrls: ["https://m/a.jpg"],
      providerMessageId: "tx-mms"
    }
  },
  status: {
    payload: { data: { event_type: "message.finalized", payload: { id: "tx-conf", to: [{ phone_number: "+15550002222", status: "delivered" }] } } },
    expected: { providerMessageId: "tx-conf", status: "delivered" }
  },
  signature: {
    valid: () => telnyxSignatureCheck(false),
    invalid: () => telnyxSignatureCheck(true)
  },
  withoutCredentials: withoutTelnyxCredentials
});
