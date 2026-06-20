import assert from "node:assert/strict";
import test from "node:test";
import { createChannelRegistry, UnsupportedCapabilityError, hasCapability, ChannelAdapter, Capability, ChannelKind } from "./channels";

function fakeAdapter(provider: string, kind: ChannelKind, caps: Capability[]): ChannelAdapter {
  return {
    capabilities: () => ({ kind, provider, displayName: provider, capabilities: caps }),
    supports: (capability) => caps.includes(capability),
    validateCredentials: async () => ({ ok: true, phoneNumber: "+15550000000" }),
    send: async () => ({ providerMessageId: `${provider}-1`, status: "queued", raw: {} })
  };
}

function fakeVoiceAdapter(): ChannelAdapter {
  const caps: Capability[] = ["voice_call", "voice_start", "voice_end", "voice_status", "inbound_call"];
  return {
    capabilities: () => ({ kind: "voice_edge", provider: "twilio", displayName: "Twilio Voice", capabilities: caps }),
    supports: (capability) => caps.includes(capability),
    validateCredentials: async () => ({ ok: true, phoneNumber: "+15550000000" }),
    send: async () => { throw new Error("voice adapter does not send messages"); },
    voiceAvailability: async () => ({ available: true, provider: "twilio" }),
    startCall: async (request) => ({
      providerCallId: `call-${request.localCallId}`,
      status: "queued",
      raw: { edge: "fixture" }
    }),
    endCall: async (providerCallId) => ({ providerCallId, status: "completed" }),
    parseInboundCall: (payload) => {
      const call = payload as { providerCallId: string; from: string; to: string; status: "ringing"; occurredAt: string };
      return {
        providerCallId: call.providerCallId,
        direction: "inbound",
        from: call.from,
        to: call.to,
        status: call.status,
        occurredAt: call.occurredAt
      };
    },
    parseCallStatus: (payload) => {
      const status = payload as { providerCallId: string; status: "in_progress"; answeredAt: string };
      return {
        providerCallId: status.providerCallId,
        status: status.status,
        answeredAt: status.answeredAt
      };
    }
  };
}

test("registry discovers capabilities and lists registered providers", () => {
  const registry = createChannelRegistry();
  registry.register(fakeAdapter("local", "native", ["local_delivery"]));
  registry.register(fakeAdapter("twilio", "sms_mms_edge", ["sms_send", "mms_send", "inbound_sms", "delivery_status", "media"]));
  const list = registry.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((c) => c.provider === "twilio" && hasCapability(c, "sms_send")));
  assert.ok(list.some((c) => c.provider === "local" && c.kind === "native"));
});

test("select returns a provider that supports the capability", () => {
  const registry = createChannelRegistry();
  registry.register(fakeAdapter("local", "native", ["local_delivery"]));
  registry.register(fakeAdapter("twilio", "sms_mms_edge", ["sms_send", "inbound_sms"]));
  assert.equal(registry.select("sms_send").capabilities().provider, "twilio");
  assert.equal(registry.select("local_delivery").capabilities().provider, "local");
});

test("select rejects unsupported capabilities cleanly", () => {
  const registry = createChannelRegistry();
  registry.register(fakeAdapter("twilio", "sms_mms_edge", ["sms_send"]));
  assert.throws(() => registry.select("voice_call"), UnsupportedCapabilityError);
  assert.throws(() => registry.select("sms_send", "local"), UnsupportedCapabilityError); // provider lacks it
  assert.throws(() => registry.select("sms_send", "unknown"), UnsupportedCapabilityError); // no such provider
});

test("send conforms to the SendResult contract", async () => {
  const registry = createChannelRegistry();
  registry.register(fakeAdapter("twilio", "sms_mms_edge", ["sms_send"]));
  const result = await registry.select("sms_send").send({ to: "+15551234567", body: "hi" });
  assert.equal(typeof result.status, "string");
  assert.equal(result.providerMessageId, "twilio-1");
});

test("voice edge adapters expose provider-neutral call control and status normalization", async () => {
  const registry = createChannelRegistry();
  registry.register(fakeVoiceAdapter());

  const adapter = registry.select("voice_start");
  assert.equal(adapter.capabilities().kind, "voice_edge");
  assert.ok(adapter.startCall);
  assert.ok(adapter.endCall);
  assert.ok(adapter.parseInboundCall);
  assert.ok(adapter.parseCallStatus);

  const availability = await adapter.voiceAvailability?.();
  assert.deepEqual(availability, { available: true, provider: "twilio" });

  const start = await adapter.startCall({
    localCallId: "local-1",
    to: "+15551234567",
    from: "+15550000000",
    contactId: 42,
    contactPointId: 99
  });
  assert.deepEqual(start, { providerCallId: "call-local-1", status: "queued", raw: { edge: "fixture" } });

  const inbound = adapter.parseInboundCall({
    providerCallId: "call-inbound-1",
    from: "+15557654321",
    to: "+15550000000",
    status: "ringing",
    occurredAt: "2026-06-20T20:30:00Z"
  });
  assert.equal(inbound.direction, "inbound");
  assert.equal(inbound.status, "ringing");

  const status = adapter.parseCallStatus({
    providerCallId: "call-local-1",
    status: "in_progress",
    answeredAt: "2026-06-20T20:31:00Z"
  });
  assert.equal(status.providerCallId, "call-local-1");
  assert.equal(status.status, "in_progress");

  const ended = await adapter.endCall("call-local-1");
  assert.deepEqual(ended, { providerCallId: "call-local-1", status: "completed" });
});
