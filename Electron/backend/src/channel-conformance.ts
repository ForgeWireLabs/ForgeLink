// Shared provider conformance test kit (work item 015, CLV-021).
//
// One reusable suite that every SMS/MMS and voice edge adapter must pass, so new
// telecom providers meet a single bar instead of ad hoc per-provider tests. The
// suite exercises the provider-neutral channel contracts plus the durable
// behaviours the rest of ForgeLink relies on:
//
//   - capability advertisement
//   - send success mapped to SendResult
//   - send rejection surfaced as a redacted error (no provider body leakage)
//   - inbound message normalization
//   - inbound MMS / media normalization
//   - delivery status normalization
//   - duplicate inbound webhook is idempotent (driven through PhoneDatabase)
//   - backward / duplicate delivery status transition is rejected
//   - invalid webhook signature rejected, valid signature accepted
//   - missing credentials reported cleanly
//
// Adapter-level cases assert the normalization contract; the idempotency and
// backward-transition cases run each adapter's *normalized* output through a real
// temporary PhoneDatabase, proving the end-to-end webhook path dedupes exactly as
// the live server does. Each adapter's own test file imports the runner and
// supplies provider-specific fixtures and a credential-clearing helper; no live
// provider calls are made.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CallStatus,
  ChannelAdapter,
  DeliveryStatusUpdate,
  InboundCallEvent,
  InboundMessage,
  OutboundCallRequest
} from "./channels";
import { PhoneDatabase } from "./database";

export type ProviderSender = (to: string, body: string, mediaUrls: string[]) => Promise<Record<string, unknown>>;
export type CallStarter = (request: OutboundCallRequest) => Promise<Record<string, unknown>>;
export type CallEnder = (providerCallId: string) => Promise<Record<string, unknown>>;

function withTempDatabase<T>(fn: (database: PhoneDatabase) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-conformance-"));
  const database = new PhoneDatabase(join(directory, "conformance.sqlite3"));
  try {
    return fn(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

export interface SmsEdgeConformanceSpec {
  provider: string;
  // Builds the adapter wired to a controllable sender so send paths stay deterministic.
  makeAdapter(sender: ProviderSender): ChannelAdapter;
  send: {
    successSender: ProviderSender;
    expected: { providerMessageId: string | null; status: string };
    // Mimics the real adapter's rejection: throws a redacted, body-free error.
    rejectingSender: ProviderSender;
    rejectionPattern: RegExp;
  };
  inbound: {
    sms: { payload: unknown; expected: InboundMessage };
    mms: { payload: unknown; expectedMediaUrls: string[]; providerMessageId: string };
  };
  // A forward/terminal delivery status (e.g. "delivered") so the backward-transition
  // case is meaningful against the database status ranking.
  status: { payload: unknown; expected: DeliveryStatusUpdate };
  signature: { valid(): boolean; invalid(): boolean };
  // Runs the assertion with provider credentials removed and restored afterwards.
  withoutCredentials(run: () => void | Promise<void>): Promise<void>;
}

export function runSmsEdgeConformance(spec: SmsEdgeConformanceSpec): void {
  const label = `${spec.provider} sms edge conformance`;

  test(`${label}: advertises required SMS/MMS capabilities`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    const caps = adapter.capabilities();
    assert.equal(caps.kind, "sms_mms_edge");
    assert.equal(caps.provider, spec.provider);
    for (const capability of ["sms_send", "mms_send", "inbound_sms", "delivery_status", "media"] as const) {
      assert.ok(adapter.supports(capability), `expected ${spec.provider} to support ${capability}`);
    }
    assert.ok(!adapter.supports("voice_call"));
    assert.equal(typeof adapter.parseInbound, "function");
    assert.equal(typeof adapter.parseStatus, "function");
  });

  test(`${label}: send success maps to SendResult`, async () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    const result = await adapter.send({ to: "+15551234567", body: "hi", mediaUrls: ["https://m/1.jpg"] });
    assert.equal(result.providerMessageId, spec.send.expected.providerMessageId);
    assert.equal(result.status, spec.send.expected.status);
  });

  test(`${label}: send rejection surfaces a redacted error`, async () => {
    const adapter = spec.makeAdapter(spec.send.rejectingSender);
    await assert.rejects(() => adapter.send({ to: "+15551234567", body: "x" }), spec.send.rejectionPattern);
  });

  test(`${label}: normalizes inbound message`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    assert.deepEqual(adapter.parseInbound!(spec.inbound.sms.payload), spec.inbound.sms.expected);
  });

  test(`${label}: normalizes inbound MMS media`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    const mms = adapter.parseInbound!(spec.inbound.mms.payload);
    assert.deepEqual(mms.mediaUrls, spec.inbound.mms.expectedMediaUrls);
    assert.equal(mms.providerMessageId, spec.inbound.mms.providerMessageId);
  });

  test(`${label}: normalizes delivery status update`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    assert.deepEqual(adapter.parseStatus!(spec.status.payload), spec.status.expected);
  });

  test(`${label}: duplicate inbound webhook is idempotent`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    const inbound = adapter.parseInbound!(spec.inbound.sms.payload);
    withTempDatabase((database) => {
      const insert = () => database.addMessage({
        id: inbound.providerMessageId || "fallback-id",
        number: inbound.from,
        direction: "inbound",
        body: inbound.body,
        media_urls: inbound.mediaUrls,
        status: "received"
      });
      assert.equal(insert(), true, "first inbound webhook should persist");
      assert.equal(insert(), false, "duplicate inbound webhook must be ignored");
      const threads = database.threads();
      assert.equal(threads.length, 1);
      assert.equal(database.messages(threads[0].id).length, 1, "duplicate must not create a second row");
    });
  });

  test(`${label}: rejects backward and duplicate delivery status transitions`, () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    const update = adapter.parseStatus!(spec.status.payload);
    withTempDatabase((database) => {
      database.createPendingMessage("local-1", "+15551234567", "hello", []);
      database.markMessageSent("local-1", update.providerMessageId, "sent");
      assert.equal(database.updateDeliveryStatus(update.providerMessageId, update.status), true, "forward transition should apply");
      assert.equal(database.updateDeliveryStatus(update.providerMessageId, update.status), false, "duplicate status must be ignored");
      assert.equal(database.updateDeliveryStatus(update.providerMessageId, "queued"), false, "backward status must be ignored");
    });
  });

  test(`${label}: rejects invalid signature and accepts valid signature`, () => {
    assert.equal(spec.signature.valid(), true, "correctly signed webhook should validate");
    assert.equal(spec.signature.invalid(), false, "tampered webhook must be rejected");
  });

  test(`${label}: reports missing credentials`, async () => {
    const adapter = spec.makeAdapter(spec.send.successSender);
    await spec.withoutCredentials(async () => {
      assert.equal((await adapter.validateCredentials()).ok, false);
    });
  });
}

export interface VoiceEdgeConformanceSpec {
  provider: string;
  makeAdapter(starter: CallStarter, ender: CallEnder): ChannelAdapter;
  start: { starter: CallStarter; expected: { providerCallId: string | null; status: CallStatus } };
  end: { ender: CallEnder; expected: { providerCallId: string; status: CallStatus } };
  inboundCall: { payload: unknown; expected: Pick<InboundCallEvent, "providerCallId" | "direction" | "status"> };
  // A forward call status (e.g. "in_progress" or "completed") for the backward-transition case.
  callStatus: { payload: unknown; expectedStatus: CallStatus };
  signature: { valid(): boolean; invalid(): boolean };
  withoutCredentials(run: () => void | Promise<void>): Promise<void>;
}

export function runVoiceEdgeConformance(spec: VoiceEdgeConformanceSpec): void {
  const label = `${spec.provider} voice edge conformance`;

  test(`${label}: advertises required voice capabilities`, () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const caps = adapter.capabilities();
    assert.equal(caps.kind, "voice_edge");
    assert.equal(caps.provider, spec.provider);
    for (const capability of ["voice_start", "voice_end", "voice_status", "inbound_call"] as const) {
      assert.ok(adapter.supports(capability), `expected ${spec.provider} to support ${capability}`);
    }
    assert.ok(!adapter.supports("sms_send"));
    assert.equal(typeof adapter.startCall, "function");
    assert.equal(typeof adapter.endCall, "function");
    assert.equal(typeof adapter.parseInboundCall, "function");
    assert.equal(typeof adapter.parseCallStatus, "function");
  });

  test(`${label}: start call maps to StartCallResult`, async () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const started = await adapter.startCall!({ localCallId: "call-1", to: "+15551234567", from: "+15550000000" });
    assert.equal(started.providerCallId, spec.start.expected.providerCallId);
    assert.equal(started.status, spec.start.expected.status);
  });

  test(`${label}: end call maps to EndCallResult`, async () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const ended = await adapter.endCall!(spec.end.expected.providerCallId);
    assert.equal(ended.providerCallId, spec.end.expected.providerCallId);
    assert.equal(ended.status, spec.end.expected.status);
  });

  test(`${label}: normalizes inbound call event`, () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const inbound = adapter.parseInboundCall!(spec.inboundCall.payload);
    assert.equal(inbound.providerCallId, spec.inboundCall.expected.providerCallId);
    assert.equal(inbound.direction, spec.inboundCall.expected.direction);
    assert.equal(inbound.status, spec.inboundCall.expected.status);
  });

  test(`${label}: normalizes call status update`, () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const update = adapter.parseCallStatus!(spec.callStatus.payload);
    assert.equal(update.status, spec.callStatus.expectedStatus);
    assert.ok(update.providerCallId, "call status update must carry a provider call id for reconciliation");
  });

  test(`${label}: rejects backward and duplicate call status transitions`, () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    const update = adapter.parseCallStatus!(spec.callStatus.payload);
    withTempDatabase((database) => {
      database.createCall({
        localCallId: `${spec.provider}-conformance`,
        providerKind: "voice_edge",
        providerName: spec.provider,
        providerCallId: update.providerCallId,
        direction: "outbound",
        to: "+15551234567",
        status: "queued"
      });
      assert.equal(database.applyCallStatus(update), true, "forward call status should apply");
      assert.equal(database.applyCallStatus(update), false, "duplicate call status must be ignored");
      assert.equal(database.applyCallStatus({ providerCallId: update.providerCallId, status: "queued" }), false, "backward call status must be ignored");
    });
  });

  test(`${label}: rejects invalid signature and accepts valid signature`, () => {
    assert.equal(spec.signature.valid(), true, "correctly signed voice webhook should validate");
    assert.equal(spec.signature.invalid(), false, "tampered voice webhook must be rejected");
  });

  test(`${label}: reports voice unavailable without credentials`, async () => {
    const adapter = spec.makeAdapter(spec.start.starter, spec.end.ender);
    await spec.withoutCredentials(async () => {
      assert.equal((await adapter.validateCredentials()).ok, false);
      if (adapter.voiceAvailability) {
        assert.equal((await adapter.voiceAvailability()).available, false);
      }
    });
  });
}
