import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FaxProviderAmbiguousError, FaxProviderPreflightError, FaxProviderRejectionError } from "./fax";
import {
  createLocalFileFaxDocumentResolver,
  createTelnyxFaxProvider,
  loadTelnyxFaxConfig,
  mapTelnyxFaxStatus,
  TelnyxFaxConfig,
  validateTelnyxFaxConfig
} from "./telnyx-fax";

const CONFIG: TelnyxFaxConfig = { apiKey: "KEY_synthetic", connectionId: "app-1", phoneNumber: "+15557654321", publicKey: "" };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function syntheticResolver(url = "https://example.invalid/synthetic-fax.pdf") {
  return { resolve: async () => ({ kind: "media_url" as const, url }) };
}

test("TFX-004: successful Fax Application validation separates configured/outbound_ready/inbound_webhook_ready", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/fax_applications/")) return jsonResponse({ data: { id: "app-1", application_name: "forgelink-fax", active: true, webhook_event_url: "https://example.invalid/hook", outbound: { outbound_voice_profile_id: "ovp-1" } } });
    return jsonResponse({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-1" }] });
  };
  const result = await validateTelnyxFaxConfig({ ...CONFIG, publicKey: Buffer.alloc(32, 1).toString("base64") }, fetchImpl as typeof fetch);
  assert.equal(result.ok, true);
  assert.equal(result.outboundReady, true);
  assert.equal(result.inboundWebhookReady, true);
});

test("TFX-004: a missing Fax Application is rejected", async () => {
  const fetchImpl = async () => jsonResponse({ errors: [{ detail: "not found" }] }, 404);
  const result = await validateTelnyxFaxConfig(CONFIG, fetchImpl as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error!, /validation failed \(404\)/);
});

test("TFX-004: a phone number not assigned to the configured Fax Application is rejected", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).includes("/fax_applications/")) return jsonResponse({ data: { id: "app-1", active: true, outbound: { outbound_voice_profile_id: "ovp-1" } } });
    return jsonResponse({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-OTHER" }] });
  };
  const result = await validateTelnyxFaxConfig(CONFIG, fetchImpl as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error!, /not assigned/);
});

test("TFX-004: a Fax Application with no Outbound Voice Profile is not outbound_ready", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).includes("/fax_applications/")) return jsonResponse({ data: { id: "app-1", active: true, outbound: {} } });
    return jsonResponse({ data: [{ phone_number: "+15557654321", status: "active", connection_id: "app-1" }] });
  };
  const result = await validateTelnyxFaxConfig(CONFIG, fetchImpl as typeof fetch);
  assert.equal(result.ok, true);
  assert.equal(result.outboundReady, false);
  assert.match(result.error!, /Outbound Voice Profile/);
});

test("TFX-004: an inactive phone number is rejected", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    if (String(url).includes("/fax_applications/")) return jsonResponse({ data: { id: "app-1", active: true, outbound: { outbound_voice_profile_id: "ovp-1" } } });
    return jsonResponse({ data: [{ phone_number: "+15557654321", status: "port-pending", connection_id: "app-1" }] });
  };
  const result = await validateTelnyxFaxConfig(CONFIG, fetchImpl as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error!, /not active/);
});

test("FAX-004: capability advertisement is truthful to Phase 2 -- outbound only, no fax_receive/fax_media", () => {
  const provider = createTelnyxFaxProvider({ config: CONFIG, documentResolver: syntheticResolver() });
  const caps = provider.capabilities();
  assert.equal(caps.kind, "fax_edge");
  assert.deepEqual(caps.capabilities.slice().sort(), ["fax_cancel", "fax_send", "fax_status"]);
  assert.equal(caps.capabilities.includes("fax_receive" as never), false);
});

test("FAX-005: exact outbound request construction in media_url (JSON) mode, including quality normalization and an opaque base64 client_state", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init! };
    return jsonResponse({ data: { id: "fax_provider_1", status: "queued", created_at: "2026-09-10T22:00:00Z" } }, 202);
  };
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  const result = await provider.sendFax({
    localFaxId: "fax-1",
    to: "+15551112222",
    documentRef: { id: "doc-1" },
    quality: "very_high",
    correlation: "opaque-correlation-token-1"
  });
  assert.equal(result.providerFaxId, "fax_provider_1");
  assert.equal(result.normalizedState, "accepted");
  assert.equal(captured!.url, "https://api.telnyx.com/v2/faxes");
  assert.equal(captured!.init.method, "POST");
  const body = JSON.parse(String(captured!.init.body));
  assert.equal(body.connection_id, "app-1");
  assert.equal(body.from, CONFIG.phoneNumber);
  assert.equal(body.to, "+15551112222");
  assert.equal(body.media_url, "https://example.invalid/synthetic-fax.pdf");
  assert.equal(body.quality, "very_high");
  assert.equal(Buffer.from(body.client_state, "base64").toString("utf8"), "opaque-correlation-token-1");
  // Only ForgeLink-owned fields are sent -- no blind mirroring of every Telnyx option.
  assert.deepEqual(Object.keys(body).sort(), ["client_state", "connection_id", "from", "media_url", "quality", "to"]);
});

test("FAX-005: an unrecognized quality value is omitted rather than forwarded to Telnyx", async () => {
  let captured: Record<string, unknown> | null = null;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse(String(init!.body));
    return jsonResponse({ data: { id: "fax_provider_2", status: "queued" } }, 202);
  };
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await provider.sendFax({ localFaxId: "fax-2", to: "+15551112222", documentRef: { id: "doc-1" }, quality: "not-a-real-telnyx-quality" });
  assert.equal(captured!.quality, undefined);
});

test("FAX-005: contents (multipart) mode uploads the resolved local file and cannot carry client_state (frozen contract)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgelink-fax-media-"));
  try {
    writeFileSync(join(directory, "synthetic-fax.pdf"), "synthetic pdf bytes");
    let captured: { init: RequestInit } | null = null;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { init: init! };
      return jsonResponse({ data: { id: "fax_provider_3", status: "queued" } }, 202);
    };
    const database = { faxDocumentById: () => ({ id: "doc-1", fax_id: "fax-3", role: "primary", local_ref: "synthetic-fax.pdf", content_type: "application/pdf", content_sha256: "", display_name: "synthetic-fax.pdf", page_count: 1, byte_size: 20, retention_state: "active", created_at: "", deleted_at: null }) };
    const resolver = createLocalFileFaxDocumentResolver(database, directory);
    const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: resolver });
    const result = await provider.sendFax({ localFaxId: "fax-3", to: "+15551112222", documentRef: { id: "doc-1" }, correlation: "should-not-appear" });
    assert.equal(result.providerFaxId, "fax_provider_3");
    assert.ok(captured!.init.body instanceof FormData);
    const form = captured!.init.body as FormData;
    assert.equal(form.get("connection_id"), "app-1");
    assert.equal(form.get("to"), "+15551112222");
    const uploaded = form.get("contents") as unknown as Blob;
    assert.ok(uploaded);
    assert.equal(await uploaded.text(), "synthetic pdf bytes");
    // The multipart schema has no client_state field -- confirm ForgeLink does not invent one.
    assert.equal(form.get("client_state"), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("FAX-005: a missing local document fails closed before any network call (preflight, not ambiguous)", async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return jsonResponse({}, 202); };
  const database = { faxDocumentById: () => undefined };
  const resolver = createLocalFileFaxDocumentResolver(database, "/nonexistent");
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: resolver });
  await assert.rejects(
    () => provider.sendFax({ localFaxId: "fax-4", to: "+15551112222", documentRef: { id: "doc-missing" } }),
    (error: unknown) => error instanceof FaxProviderPreflightError && error.category === "document_unavailable"
  );
  assert.equal(fetchCalled, false, "the provider must never be called when the document cannot be resolved");
});

test("FAX-005: an explicit provider rejection is a definite failure, never ambiguous", async () => {
  const fetchImpl = async () => jsonResponse({ errors: [{ code: "10002", title: "invalid parameter" }] }, 422);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(
    () => provider.sendFax({ localFaxId: "fax-5", to: "+15551112222", documentRef: { id: "doc-1" } }),
    (error: unknown) => error instanceof FaxProviderRejectionError && error.category === "10002"
  );
});

test("FAX-005: a network/timeout failure is ambiguous, and the provider payload is never exposed", async () => {
  const fetchImpl = async () => { throw new Error("ECONNRESET raw socket detail that must never leak"); };
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  try {
    await provider.sendFax({ localFaxId: "fax-6", to: "+15551112222", documentRef: { id: "doc-1" } });
    assert.fail("expected an ambiguous error");
  } catch (error) {
    assert.ok(error instanceof FaxProviderAmbiguousError);
    assert.equal(error.category, "network_error");
    assert.doesNotMatch(error.message, /ECONNRESET/);
  }
});

test("FAX-005: a 5xx response is ambiguous -- acceptance cannot be excluded", async () => {
  const fetchImpl = async () => jsonResponse({}, 503);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(
    () => provider.sendFax({ localFaxId: "fax-7", to: "+15551112222", documentRef: { id: "doc-1" } }),
    (error: unknown) => error instanceof FaxProviderAmbiguousError && error.category === "server_error"
  );
});

test("FAX-005: a 202 with no usable fax id is ambiguous, never a bare success", async () => {
  const fetchImpl = async () => jsonResponse({ data: {} }, 202);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(
    () => provider.sendFax({ localFaxId: "fax-8", to: "+15551112222", documentRef: { id: "doc-1" } }),
    (error: unknown) => error instanceof FaxProviderAmbiguousError && error.category === "malformed_response"
  );
});

test("FAX-005: an unexpected/unrecognized response status is treated as ambiguous, not guessed", async () => {
  const fetchImpl = async () => jsonResponse({}, 418);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(
    () => provider.sendFax({ localFaxId: "fax-9", to: "+15551112222", documentRef: { id: "doc-1" } }),
    (error: unknown) => error instanceof FaxProviderAmbiguousError && error.category === "unexpected_status"
  );
});

test("FAX-005: sendFax performs exactly one POST attempt -- no automatic retry on ambiguity", async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; throw new Error("network failure"); };
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(() => provider.sendFax({ localFaxId: "fax-10", to: "+15551112222", documentRef: { id: "doc-1" } }));
  assert.equal(attempts, 1);
});

test("FAX-005: Telnyx status normalization is frozen inside the adapter -- the rest of ForgeLink never sees Telnyx status strings", () => {
  assert.equal(mapTelnyxFaxStatus("queued", "outbound"), "accepted");
  assert.equal(mapTelnyxFaxStatus("media.processed", "outbound"), "accepted");
  assert.equal(mapTelnyxFaxStatus("sending", "outbound"), "sending");
  assert.equal(mapTelnyxFaxStatus("delivered", "outbound"), "delivered");
  assert.equal(mapTelnyxFaxStatus("failed", "outbound"), "failed");
  assert.equal(mapTelnyxFaxStatus("receiving", "inbound"), "receiving");
  assert.equal(mapTelnyxFaxStatus("media.processing", "inbound"), "processing");
  assert.equal(mapTelnyxFaxStatus("received", "inbound"), "received");
  // An unknown/future status maps to null -- fail safe, never guessed.
  assert.equal(mapTelnyxFaxStatus("some_future_status", "outbound"), null);
  // A status string valid for the other direction is not accepted here.
  assert.equal(mapTelnyxFaxStatus("receiving", "outbound"), null);
});

test("FAX-005: GET reconciliation maps a known status and rejects an unknown one as ambiguous", async () => {
  const okFetch = async () => jsonResponse({ data: { status: "delivered", direction: "outbound", updated_at: "2026-09-10T22:05:00Z" } });
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: okFetch as typeof fetch, documentResolver: syntheticResolver() });
  const update = await provider.getFax!("fax_provider_1");
  assert.equal(update.normalizedState, "delivered");
  assert.equal(update.providerFaxId, "fax_provider_1");

  const unknownFetch = async () => jsonResponse({ data: { status: "some_new_status", direction: "outbound" } });
  const provider2 = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: unknownFetch as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(() => provider2.getFax!("fax_provider_1"), (error: unknown) => error instanceof FaxProviderAmbiguousError && error.category === "unknown_status");
});

test("FAX-005: GET reconciliation on an unknown fax id is a definite rejection", async () => {
  const fetchImpl = async () => jsonResponse({ errors: [{ detail: "not found" }] }, 404);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(() => provider.getFax!("fax_unknown"), (error: unknown) => error instanceof FaxProviderRejectionError && error.category === "not_found");
});

test("FAX-005: cancel request construction; a 202 acknowledgment yields cancel_pending, never a fabricated cancelled state", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init! };
    return jsonResponse({ data: { result: "ok" } }, 202);
  };
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  const result = await provider.cancelFax!("fax_provider_1");
  assert.equal(captured!.url, "https://api.telnyx.com/v2/faxes/fax_provider_1/actions/cancel");
  assert.equal(captured!.init.method, "POST");
  assert.equal(result.normalizedState, "cancel_pending");
  assert.notEqual((result.normalizedState as string), "cancelled");
});

test("FAX-005: a cancel command Telnyx rejects as ineligible is a definite rejection, not silently accepted", async () => {
  const fetchImpl = async () => jsonResponse({ errors: [{ code: "90000" }] }, 422);
  const provider = createTelnyxFaxProvider({ config: CONFIG, fetchImpl: fetchImpl as typeof fetch, documentResolver: syntheticResolver() });
  await assert.rejects(() => provider.cancelFax!("fax_provider_1"), (error: unknown) => error instanceof FaxProviderRejectionError);
});

test("FAX-005: no live network request is possible in this suite -- every call goes through an injected fetch", () => {
  assert.equal(typeof loadTelnyxFaxConfig, "function");
  // loadTelnyxFaxConfig reads only TELNYX_FAX_* env vars; confirm the
  // process environment used by this test run carries no real credential.
  assert.equal(loadTelnyxFaxConfig().apiKey, "");
});
