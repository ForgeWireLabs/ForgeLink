// Inbound fax document acquisition worker (work item 041, Phase 4:
// FAX-007). Owns the actual network download -- deliberately separate
// from fax-inbound.ts (DB-only identity/observation application) and from
// server.ts's ordinary webhook drains, so consuming `deferred_inbound`
// ingress rows never triggers a network fetch by itself. Claims are
// durable (fax_inbound_acquisitions), so this worker can be invoked
// repeatedly/concurrently-in-appearance and always makes safe forward
// progress: at most one claim succeeds per (provider, provider_fax_id).
//
// Source selection per attempt:
//   1. the already-authenticated Phase 3/3.1 transient webhook media_url,
//      only if its recorded expiry has not passed;
//   2. otherwise Telnyx's authenticated GET /v2/faxes/{id}
//      (getTelnyxInboundFaxMediaReference), validated against the expected
//      provider fax id / inbound direction / configured connection_id
//      before any media URL from it is trusted;
//   3. if neither yields a usable, validated media URL, the attempt is a
//      truthful retryable failure (or terminal `unavailable` once bounded
//      attempts are exhausted) -- never fabricated success.
//
// The Telnyx API request and the media-download request are separate
// trust/credential boundaries: the Telnyx Bearer token is attached only to
// the `GET /v2/faxes/{id}` call (via telnyx-fax.ts's authHeaders) and is
// NEVER sent to the signed media URL.
//
// Media URL / SSRF boundary: every media URL -- whether from the webhook
// or from GET -- is treated as untrusted network input. See
// validateMediaUrl below for the exact bounds enforced. Redirects (if any)
// are followed manually, re-validated at every hop, and bounded; the
// Telnyx Authorization header is never attached to any hop of the media
// download regardless of redirect target.
//
// Streaming: the response body is streamed to a managed-store staging
// file with a hard byte cap enforced during the read loop (never
// `response.arrayBuffer()` on unbounded input); Content-Length is checked
// when present but never trusted exclusively. FAX_INBOUND_MAX_BYTES is a
// ForgeLink-defined conservative safety limit -- Telnyx does not publish
// an inbound-specific size limit as of this phase's verification date
// (see the Phase 4 contract).
//
// Validation: only a body that starts with the PDF magic bytes ("%PDF-")
// is ever committed as a managed document. Anything else -- oversized,
// zero-byte, wrong magic bytes, content-type contradiction -- is
// quarantined (or, for the oversized case, discarded outright with no
// useful bytes to retain), never committed, never associated with
// fax_documents, and never treated as a transport failure of the
// underlying fax transmission.

import { createWriteStream } from "node:fs";
import { PhoneDatabase, FaxInboundAcquisitionRow } from "./database";
import { TelnyxFaxConfig, getTelnyxInboundFaxMediaReference } from "./telnyx-fax";
import { ManagedDocumentStore, StagedDocument } from "./managed-document-store";

// ForgeLink's own conservative inbound fax document safety limit -- not a
// claimed Telnyx protocol limit. Matches the existing outbound multipart
// limit (TELNYX_MULTIPART_MAX_BYTES in telnyx-fax.ts) for consistency,
// since Telnyx's documented inbound fax PDFs are generated from the same
// class of fax transmission.
export const FAX_INBOUND_MAX_BYTES = 20 * 1024 * 1024;

const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2048;
const MAX_ACQUISITION_ATTEMPTS = 6;
const BASE_RETRY_BACKOFF_MS = 30_000;
const MAX_RETRY_BACKOFF_MS = 60 * 60_000;
const STALE_CLAIM_THRESHOLD_MS = 5 * 60_000;

export type InboundFaxAcquisitionDatabase = Pick<
  PhoneDatabase,
  | "claimNextInboundFaxAcquisition"
  | "completeInboundFaxAcquisition"
  | "createFaxDocument"
  | "clearTelnyxFaxWebhookEventTransientMedia"
  | "recoverStaleInboundFaxAcquisitions"
  | "faxByLocalId"
>;

// --- Media URL / SSRF boundary ----------------------------------------------

function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // "this network"
    return false;
  }
  if (host === "::1" || host === "::") return true; // loopback / unspecified
  if (host.startsWith("fe80:")) return true; // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local
  return false;
}

export type MediaUrlValidation = { ok: true; url: URL } | { ok: false; reason: string };

// Known residual limitation (documented, not silently ignored): this is a
// point-in-time DNS/IP check against the hostname's literal form. A
// hostname that resolves to a private/loopback address only at connection
// time (DNS rebinding) is not caught here -- Node's fetch does not expose
// a pre-connect IP hook this module can hang a check off of. HTTPS-only
// plus the literal-IP/host checks above are the strongest practical
// validation available without a custom low-level socket/DNS layer, which
// this phase does not introduce.
export function validateMediaUrl(rawUrl: string): MediaUrlValidation {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) return { ok: false, reason: "url_bounds" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "url_malformed" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "url_scheme" };
  if (url.username || url.password) return { ok: false, reason: "url_credentials" };
  if (isForbiddenHost(url.hostname)) return { ok: false, reason: "url_forbidden_host" };
  return { ok: true, url };
}

// --- Bounded streaming download ---------------------------------------------

type DownloadOutcome =
  | { ok: true; staged: StagedDocument; contentType: string }
  | { ok: false; classification: "retryable" | "quarantine"; reason: string };

async function downloadToStaging(startUrl: string, store: ManagedDocumentStore, fetchImpl: typeof fetch): Promise<DownloadOutcome> {
  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validated = validateMediaUrl(currentUrl);
    if (!validated.ok) return { ok: false, classification: "retryable", reason: validated.reason };

    let response: Response;
    try {
      // Never forward the Telnyx API Authorization header here -- the
      // media URL is a separate, signed trust boundary. `redirect:
      // "manual"` so every hop is re-validated by this same function
      // rather than followed implicitly by the fetch implementation.
      response = await fetchImpl(validated.url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30_000) });
    } catch {
      return { ok: false, classification: "retryable", reason: "network_error" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, classification: "retryable", reason: "redirect_no_location" };
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, classification: "retryable", reason: "redirect_malformed" };
      }
      continue;
    }
    if (!response.ok) {
      // Every HTTP-level failure (401/403/404/410/429/5xx/etc.) is a
      // recoverable/retryable classification, never quarantine --
      // quarantine is reserved for suspicious *content*, not transport
      // problems. An already-expired signed URL typically surfaces here
      // (403/404), which correctly triggers provider GET recovery on the
      // next attempt rather than retrying the same dead URL.
      return { ok: false, classification: "retryable", reason: `http_${response.status}` };
    }

    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > FAX_INBOUND_MAX_BYTES) {
      return { ok: false, classification: "quarantine", reason: "document_too_large" };
    }
    const contentTypeHeader = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

    if (!response.body) {
      return { ok: false, classification: "quarantine", reason: "empty_body" };
    }

    const staged = await store.beginStaging();
    const writeStream = createWriteStream(staged.stagingPath, { flags: "w" });
    let total = 0;
    let firstChunk: Buffer | null = null;
    let oversized = false;
    try {
      const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        total += value.byteLength;
        if (total > FAX_INBOUND_MAX_BYTES) {
          oversized = true;
          try { await reader.cancel(); } catch { /* best-effort */ }
          break;
        }
        const chunk = Buffer.from(value);
        if (!firstChunk) firstChunk = chunk;
        await new Promise<void>((res, rej) => writeStream.write(chunk, (err) => (err ? rej(err) : res())));
      }
    } catch {
      writeStream.destroy();
      await store.discardStaged(staged);
      return { ok: false, classification: "retryable", reason: "stream_error" };
    }
    await new Promise<void>((res) => writeStream.end(res));

    if (oversized) {
      // No useful bytes to retain -- discard rather than quarantine a
      // deliberately truncated, incomplete stream.
      await store.discardStaged(staged);
      return { ok: false, classification: "quarantine", reason: "document_too_large" };
    }
    if (total === 0) {
      await store.discardStaged(staged);
      return { ok: false, classification: "quarantine", reason: "empty_body" };
    }

    const isPdf = firstChunk !== null && firstChunk.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!isPdf) {
      await store.quarantineStaged(staged);
      const reason = contentTypeHeader && !contentTypeHeader.includes("pdf") ? "content_type_mismatch" : "not_pdf";
      return { ok: false, classification: "quarantine", reason };
    }

    return { ok: true, staged, contentType: "application/pdf" };
  }
  return { ok: false, classification: "retryable", reason: "too_many_redirects" };
}

// --- Source selection --------------------------------------------------------

interface ResolvedSource {
  url: string;
  sourceKind: "webhook_media_url" | "provider_get";
}

async function resolveDownloadSource(
  acquisition: FaxInboundAcquisitionRow,
  config: TelnyxFaxConfig,
  fetchImpl: typeof fetch,
  now: string
): Promise<ResolvedSource | { ok: false; reason: string }> {
  if (acquisition.source_reference && acquisition.source_reference_expiry && acquisition.source_reference_expiry > now) {
    return { url: acquisition.source_reference, sourceKind: "webhook_media_url" };
  }
  const reference = await getTelnyxInboundFaxMediaReference(config, acquisition.provider_fax_id, fetchImpl);
  if (!reference) return { ok: false, reason: "provider_get_unavailable" };
  // Never silently accept a GET response for a different fax, direction,
  // or Fax Application -- these are the exact identity checks the mission
  // requires before trusting any media URL derived from GET.
  if (reference.providerFaxId !== acquisition.provider_fax_id) return { ok: false, reason: "provider_get_id_mismatch" };
  if (reference.direction !== "inbound") return { ok: false, reason: "provider_get_direction_mismatch" };
  if (!config.connectionId || reference.connectionId !== config.connectionId) return { ok: false, reason: "provider_get_connection_mismatch" };
  if (!reference.mediaUrl) return { ok: false, reason: "provider_get_no_media" };
  return { url: reference.mediaUrl, sourceKind: "provider_get" };
}

function backoffMs(attemptCount: number): number {
  const scaled = BASE_RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, attemptCount - 1));
  return Math.min(scaled, MAX_RETRY_BACKOFF_MS);
}

// --- Orchestration -----------------------------------------------------------

export interface InboundFaxAcquisitionDeps {
  database: InboundFaxAcquisitionDatabase;
  store: ManagedDocumentStore;
  config: TelnyxFaxConfig;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

// Processes exactly one claimed acquisition to completion (one attempt).
// Never resends a fax, never performs unbounded retry, never downloads for
// an acquisition that is not currently claimed 'acquiring' by this call.
async function runClaimedAcquisition(acquisition: FaxInboundAcquisitionRow, deps: InboundFaxAcquisitionDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = (deps.now || (() => new Date().toISOString()))();

  const source = await resolveDownloadSource(acquisition, deps.config, fetchImpl, now);
  if ("ok" in source && source.ok === false) {
    failOrRetry(deps.database, acquisition, source.reason);
    return;
  }
  const resolved = source as ResolvedSource;
  const outcome = await downloadToStaging(resolved.url, deps.store, fetchImpl);

  if (!outcome.ok) {
    if (outcome.classification === "quarantine") {
      deps.database.completeInboundFaxAcquisition({
        provider: acquisition.provider,
        providerFaxId: acquisition.provider_fax_id,
        state: "quarantined",
        lastSafeError: outcome.reason,
        sourceKind: resolved.sourceKind
      });
      return;
    }
    failOrRetry(deps.database, acquisition, outcome.reason, resolved.sourceKind);
    return;
  }

  const ref = await deps.store.commit(outcome.staged, outcome.contentType, resolved.sourceKind);
  const fax = deps.database.faxByLocalId(acquisition.local_fax_id);
  deps.database.createFaxDocument({
    fax_id: acquisition.local_fax_id,
    role: "primary",
    local_ref: ref.localRef,
    content_type: ref.contentType,
    content_sha256: ref.contentSha256,
    byte_size: ref.byteSize,
    // The provider's own page_count (already recorded on the fax via the
    // fax.received event's normalized observation) is the authoritative
    // source -- this acquisition worker never derives or overwrites a
    // competing local page count.
    page_count: fax?.page_count ?? null
  });
  deps.database.completeInboundFaxAcquisition({
    provider: acquisition.provider,
    providerFaxId: acquisition.provider_fax_id,
    state: "available",
    managedDocumentId: ref.id,
    contentSha256: ref.contentSha256,
    byteSize: ref.byteSize,
    contentType: ref.contentType,
    sourceKind: resolved.sourceKind
  });
  // The transient provider URL is no longer needed once the local managed
  // artifact is durable -- clear it now rather than waiting for the
  // Phase 3.1 bulk expiry sweep.
  if (acquisition.source_event_id) deps.database.clearTelnyxFaxWebhookEventTransientMedia(acquisition.source_event_id);
}

function failOrRetry(database: InboundFaxAcquisitionDatabase, acquisition: FaxInboundAcquisitionRow, reason: string, sourceKind?: string): void {
  const nextAttempt = acquisition.attempt_count + 1;
  if (nextAttempt >= MAX_ACQUISITION_ATTEMPTS) {
    database.completeInboundFaxAcquisition({
      provider: acquisition.provider,
      providerFaxId: acquisition.provider_fax_id,
      state: "unavailable",
      lastSafeError: reason,
      incrementAttempt: true,
      sourceKind
    });
    return;
  }
  const nextRetryAt = new Date(Date.now() + backoffMs(nextAttempt)).toISOString();
  database.completeInboundFaxAcquisition({
    provider: acquisition.provider,
    providerFaxId: acquisition.provider_fax_id,
    state: "retryable",
    lastSafeError: reason,
    nextRetryAt,
    incrementAttempt: true,
    sourceKind
  });
}

// Claims and processes up to `maxClaims` due acquisitions in one bounded
// pass -- never an unbounded loop. Intended to be invoked periodically by
// server.ts's own scheduler (a separate trigger from the ordinary webhook
// drains, per the mission's explicit requirement that consuming
// deferred_inbound rows must never itself perform a network download).
export async function runInboundFaxAcquisitionBatch(deps: InboundFaxAcquisitionDeps, maxClaims = 5): Promise<number> {
  const now = (deps.now || (() => new Date().toISOString()))();
  let processed = 0;
  for (let i = 0; i < maxClaims; i++) {
    const claimed = deps.database.claimNextInboundFaxAcquisition(now);
    if (!claimed) break;
    await runClaimedAcquisition(claimed, deps);
    processed++;
  }
  return processed;
}

// Restart recovery: reclaims stale 'acquiring' rows (a worker crashed
// mid-download) and sweeps any abandoned staging file. Safe to call
// unconditionally at startup -- see database.ts's
// recoverStaleInboundFaxAcquisitions and ManagedDocumentStore's
// sweepAbandonedStaging for why each is provably safe.
export async function recoverInboundFaxAcquisitions(database: InboundFaxAcquisitionDatabase, store: ManagedDocumentStore): Promise<{ reclaimed: number; sweptStagingFiles: number }> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_THRESHOLD_MS).toISOString();
  const reclaimed = database.recoverStaleInboundFaxAcquisitions(staleBefore);
  const sweptStagingFiles = await store.sweepAbandonedStaging();
  return { reclaimed, sweptStagingFiles };
}
