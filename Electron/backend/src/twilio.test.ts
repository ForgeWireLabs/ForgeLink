import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createTwilioAdapter, createTwilioVoiceAdapter, endTwilioCall, parseTwilioCallStatus, parseTwilioInboundCall, sendTwilioMessage, startTwilioCall, validateTwilioSignature } from "./twilio";

test("validates Twilio webhook signatures", () => {
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const previousBase = process.env.TWILIO_PUBLIC_BASE_URL;
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example";
  try {
    const fields = { Body: "hello", From: "+15551234567", MessageSid: "SM1" };
    const value = `https://phone.example/webhooks/sms${Object.keys(fields).sort().map((key) => `${key}${fields[key as keyof typeof fields]}`).join("")}`;
    const signature = createHmac("sha1", "test-token").update(value).digest("base64");
    assert.equal(validateTwilioSignature("/webhooks/sms", fields, signature), true);
    assert.equal(validateTwilioSignature("/webhooks/sms", fields, "wrong"), false);
  } finally {
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.TWILIO_PUBLIC_BASE_URL; else process.env.TWILIO_PUBLIC_BASE_URL = previousBase;
  }
});

test("sends status callbacks without exposing provider error bodies", async () => {
  const previous = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, number: process.env.TWILIO_PHONE_NUMBER, base: process.env.TWILIO_PUBLIC_BASE_URL };
  process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PHONE_NUMBER = "+15550001111";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example.com";
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (_input, init) => {
      const fields = new URLSearchParams(String(init?.body));
      assert.equal(fields.get("StatusCallback"), "https://phone.example.com/webhooks/status");
      return { ok: true, status: 201, json: async () => ({ sid: "SM1", status: "queued", to: "+15551234567" }) } as Response;
    }) as typeof fetch;
    assert.equal((await sendTwilioMessage("+15551234567", "hello", [])).sid, "SM1");
    global.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ message: "sensitive provider detail" }) } as Response)) as typeof fetch;
    await assert.rejects(() => sendTwilioMessage("+15551234567", "hello", []), (error: Error) => error.message === "Twilio rejected the message (400).");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ TWILIO_ACCOUNT_SID: previous.sid, TWILIO_AUTH_TOKEN: previous.token, TWILIO_PHONE_NUMBER: previous.number, TWILIO_PUBLIC_BASE_URL: previous.base })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Twilio adapter conforms to the channel contract (CLV-003)", async () => {
  const adapter = createTwilioAdapter(async (to, body, media) => ({ sid: "SM-ADAPT", status: "queued", to, body, mediaCount: media.length }));
  const caps = adapter.capabilities();
  assert.equal(caps.provider, "twilio");
  assert.equal(caps.kind, "sms_mms_edge");
  assert.ok(adapter.supports("sms_send") && adapter.supports("mms_send") && adapter.supports("inbound_sms"));
  assert.ok(!adapter.supports("voice_call"));

  const result = await adapter.send({ to: "+15551234567", body: "hi", mediaUrls: ["https://x/y.jpg"] });
  assert.equal(result.providerMessageId, "SM-ADAPT");
  assert.equal(result.status, "queued");

  const inbound = adapter.parseInbound!({ From: "+15550001111", To: "+15550002222", Body: "yo", MessageSid: "SM-IN", NumMedia: "1", MediaUrl0: "https://m/1.jpg" });
  assert.equal(inbound.from, "+15550001111");
  assert.equal(inbound.body, "yo");
  assert.deepEqual(inbound.mediaUrls, ["https://m/1.jpg"]);
  assert.equal(inbound.providerMessageId, "SM-IN");

  assert.deepEqual(adapter.parseStatus!({ MessageSid: "SM-IN", MessageStatus: "delivered" }), { providerMessageId: "SM-IN", status: "delivered" });
});

test("Twilio Voice adapter conforms to the voice edge contract (CLV-013)", async () => {
  const adapter = createTwilioVoiceAdapter(
    async (request) => ({ sid: "CA-START", status: "queued", to: request.to, from: request.from }),
    async (providerCallId) => ({ sid: providerCallId, status: "completed" })
  );
  const caps = adapter.capabilities();
  assert.equal(caps.provider, "twilio");
  assert.equal(caps.kind, "voice_edge");
  assert.ok(adapter.supports("voice_start") && adapter.supports("voice_end") && adapter.supports("voice_status"));
  assert.ok(!adapter.supports("sms_send"));

  const started = await adapter.startCall!({ localCallId: "call-1", to: "+15551234567", from: "+15550000000" });
  assert.equal(started.providerCallId, "CA-START");
  assert.equal(started.status, "queued");
  const ended = await adapter.endCall!("CA-START");
  assert.deepEqual(ended, { providerCallId: "CA-START", status: "completed", raw: { sid: "CA-START", status: "completed" } });

  const inbound = parseTwilioInboundCall({ CallSid: "CA-IN", From: "+15551234567", To: "+15550000000", CallStatus: "ringing", Timestamp: "2026-06-20T21:00:00Z" });
  assert.equal(inbound.direction, "inbound");
  assert.equal(inbound.status, "ringing");
  const status = parseTwilioCallStatus({ CallSid: "CA-IN", CallStatus: "in-progress", Timestamp: "2026-06-20T21:01:00Z" });
  assert.equal(status.providerCallId, "CA-IN");
  assert.equal(status.status, "in_progress");
});

test("Twilio Voice API calls use redacted errors and configured callbacks", async () => {
  const previous = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, number: process.env.TWILIO_PHONE_NUMBER, base: process.env.TWILIO_PUBLIC_BASE_URL };
  process.env.TWILIO_ACCOUNT_SID = `AC${"b".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PHONE_NUMBER = "+15550001111";
  process.env.TWILIO_PUBLIC_BASE_URL = "https://phone.example.com";
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (input, init) => {
      assert.match(String(input), /\/Calls\.json$/);
      const fields = new URLSearchParams(String(init?.body));
      assert.equal(fields.get("To"), "+15551234567");
      assert.equal(fields.get("From"), "+15550001111");
      assert.equal(fields.get("Url"), "https://phone.example.com/webhooks/voice/twiml");
      assert.equal(fields.get("StatusCallback"), "https://phone.example.com/webhooks/voice/status");
      return { ok: true, status: 201, json: async () => ({ sid: "CA1", status: "queued" }) } as Response;
    }) as typeof fetch;
    assert.equal((await startTwilioCall({ localCallId: "local", to: "+15551234567" })).sid, "CA1");

    global.fetch = (async (input, init) => {
      assert.match(String(input), /\/Calls\/CA1\.json$/);
      assert.equal(new URLSearchParams(String(init?.body)).get("Status"), "completed");
      return { ok: true, status: 200, json: async () => ({ sid: "CA1", status: "completed" }) } as Response;
    }) as typeof fetch;
    assert.equal((await endTwilioCall("CA1")).status, "completed");

    global.fetch = (async () => ({ ok: false, status: 500, json: async () => ({ message: "sensitive voice detail" }) } as Response)) as typeof fetch;
    await assert.rejects(() => startTwilioCall({ localCallId: "local", to: "+15551234567" }), (error: Error) => error.message === "Twilio rejected the call (500).");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ TWILIO_ACCOUNT_SID: previous.sid, TWILIO_AUTH_TOKEN: previous.token, TWILIO_PHONE_NUMBER: previous.number, TWILIO_PUBLIC_BASE_URL: previous.base })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
