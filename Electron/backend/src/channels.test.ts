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
