// Telnyx Programmable Fax outbound edge (work item 041, Phase 2: FAX-004,
// FAX-005). Kept entirely separate from telnyx.ts (SMS/MMS) and twilio.ts:
// a Fax Application is not a Messaging Profile, and fax lifecycle parsing
// stays fax-specific even though both products share one Telnyx account.
// The frozen contract this file implements (verified 2026-09-10 against the
// authoritative Telnyx OpenAPI spec) is recorded in
// work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase2-telnyx-fax-contract.md;
// re-read it before changing request/response field handling here.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { ChannelCapabilities, CredentialValidation } from "./channels";
import { FaxDirection, FaxDocumentRef, FaxProviderAmbiguousError, FaxProviderPreflightError, FaxProviderRejectionError, FaxProvider, FaxRequest, FaxResult, FaxState, FaxStatusUpdate } from "./fax";
import { FaxDocumentRow, PhoneDatabase } from "./database";

export interface TelnyxFaxConfig {
  apiKey: string;
  connectionId: string;   // Fax Application ID -- a plain string, not a UUID (see the frozen contract).
  phoneNumber: string;
  publicKey: string;      // base64 Ed25519, future webhook verification (Phase 3).
}

export function loadTelnyxFaxConfig(): TelnyxFaxConfig {
  return {
    apiKey: (process.env.TELNYX_FAX_API_KEY || "").trim(),
    connectionId: (process.env.TELNYX_FAX_CONNECTION_ID || "").trim(),
    phoneNumber: (process.env.TELNYX_FAX_PHONE_NUMBER || "").trim(),
    publicKey: (process.env.TELNYX_FAX_PUBLIC_KEY || "").trim()
  };
}

// --- Read-only readiness validation (FAX-004) -------------------------------
// Mirrors Electron/telnyxFaxSettings.js's validateTelnyxFaxSettings (the
// main-process "test connection" copy) for backend-side readiness checks.
// Never mutates a Telnyx resource -- GET only.

export interface TelnyxFaxReadiness {
  ok: boolean;
  configured: boolean;
  outboundReady: boolean;
  inboundWebhookReady: boolean;
  applicationName?: string;
  phoneNumber?: string;
  error?: string;
}

interface TelnyxFaxApplicationBody {
  id?: string;
  application_name?: string;
  active?: boolean;
  webhook_event_url?: string;
  outbound?: { outbound_voice_profile_id?: string };
}

interface TelnyxPhoneNumberBody {
  phone_number?: string;
  status?: string;
  connection_id?: string;
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

export async function validateTelnyxFaxConfig(config: TelnyxFaxConfig = loadTelnyxFaxConfig(), fetchImpl: typeof fetch = fetch): Promise<TelnyxFaxReadiness> {
  if (!config.apiKey || !config.connectionId || !config.phoneNumber) {
    return { ok: false, configured: false, outboundReady: false, inboundWebhookReady: false, error: "Telnyx Fax API key, Fax Application connection ID, and phone number are required." };
  }
  const headers = { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" };
  try {
    const appResponse = await fetchImpl(`https://api.telnyx.com/v2/fax_applications/${encodeURIComponent(config.connectionId)}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!appResponse.ok) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: `Telnyx Fax Application validation failed (${appResponse.status}).` };
    const appJson = await readJsonBody(appResponse);
    const application = (appJson.data || {}) as TelnyxFaxApplicationBody;
    if (String(application.id || "") !== config.connectionId) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "Telnyx did not return the selected Fax Application." };
    if (application.active === false) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "The selected Telnyx Fax Application is disabled." };

    const numberResponse = await fetchImpl(`https://api.telnyx.com/v2/phone_numbers?filter%5Bphone_number%5D=${encodeURIComponent(config.phoneNumber)}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!numberResponse.ok) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: `Telnyx phone number validation failed (${numberResponse.status}).` };
    const numberJson = await readJsonBody(numberResponse);
    const matches = (Array.isArray(numberJson.data) ? numberJson.data : []) as TelnyxPhoneNumberBody[];
    const number = matches.find((candidate) => String(candidate.phone_number || "") === config.phoneNumber);
    if (!number) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "Telnyx did not return the selected phone number." };
    if (String(number.status || "") !== "active") return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "The selected Telnyx phone number is not active." };
    if (String(number.connection_id || "") !== config.connectionId) return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "The selected phone number is not assigned to the selected Fax Application." };

    const outboundReady = Boolean(application.outbound?.outbound_voice_profile_id);
    const inboundWebhookReady = Boolean(config.publicKey) && Boolean(application.webhook_event_url);
    return {
      ok: true,
      configured: true,
      outboundReady,
      inboundWebhookReady,
      applicationName: application.application_name || "Telnyx Fax",
      phoneNumber: config.phoneNumber,
      error: outboundReady ? undefined : "The Fax Application has no Outbound Voice Profile attached; outbound fax is not ready."
    };
  } catch {
    return { ok: false, configured: true, outboundReady: false, inboundWebhookReady: false, error: "Telnyx Fax validation could not be completed." };
  }
}

// --- Media resolution (provider-specific; keeps FaxRequest.documentRef opaque) ---
//
//   FaxRequest.documentRef (opaque, provider-neutral)
//       |
//       v
//   TelnyxFaxDocumentResolver  (injected dependency)
//       |
//       v
//   TelnyxFaxMediaSource  (provider-specific: media_url | media_name | contents)
//
// Per the frozen contract, `media_name` requires media already uploaded to
// Telnyx's Media Storage (not integrated here) and `contents` is the only
// mode that can send a ForgeLink-managed local document without a public
// URL. Both are modeled; production uses the local-file `contents` resolver.
export type TelnyxFaxMediaSource =
  | { kind: "media_url"; url: string }
  | { kind: "media_name"; name: string }
  | { kind: "contents"; buffer: Buffer; filename: string; contentType: string };

export interface TelnyxFaxDocumentResolver {
  resolve(documentRef: FaxDocumentRef): Promise<TelnyxFaxMediaSource>;
}

// Provider-boundary limits/allow-list (frozen contract; Phase 2.1 finding 4).
// 20 MB is the documented multipart `contents` limit. The extension map is
// both the supported-format allow-list and the canonical content-type used
// on the wire -- a database content_type is trusted only when it does not
// materially disagree with the extension (different top-level media type,
// e.g. "image/..." claimed for a ".pdf" file).
export const TELNYX_MULTIPART_MAX_BYTES = 20 * 1024 * 1024;

const TELNYX_SUPPORTED_EXTENSIONS: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf": "application/rtf",
  ".txt": "text/plain"
};

function topLevelMediaType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase().split("/")[0] || "";
}

export interface LocalFileFaxDocumentResolverFs {
  stat: typeof stat;
  realpath: typeof realpath;
  readFile: typeof readFile;
}

const DEFAULT_RESOLVER_FS: LocalFileFaxDocumentResolverFs = { stat, realpath, readFile };

// Production resolver: reads a ForgeLink-managed fax document from the same
// `<dataDir>/uploads/` directory server.ts already uses for MMS media.
// `fax_documents.local_ref` is treated as a filename within that directory,
// never an absolute/external path, and never a public URL. Before a file
// crosses the provider boundary this enforces, in order: basename-only
// reference safety, symlink/reparse-point containment under `uploadsDir`
// (via realpath, portable across platforms -- no Windows-only special
// case), file-size limit checked via `stat` before any full read, a
// supported-format allow-list, content-type/extension agreement, and (when
// `fax_documents.content_sha256` is non-empty) a byte-for-byte hash match
// so a document that changed after preparation is never silently sent as
// though it were the prepared one.
export function createLocalFileFaxDocumentResolver(
  database: Pick<PhoneDatabase, "faxDocumentById">,
  uploadsDir: string,
  fsImpl: LocalFileFaxDocumentResolverFs = DEFAULT_RESOLVER_FS
): TelnyxFaxDocumentResolver {
  return {
    async resolve(documentRef: FaxDocumentRef): Promise<TelnyxFaxMediaSource> {
      const row: FaxDocumentRow | undefined = database.faxDocumentById(documentRef.id);
      if (!row) throw new FaxProviderPreflightError("document_unavailable", "The fax document could not be found.");
      if (row.retention_state !== "active") throw new FaxProviderPreflightError("document_unavailable", "The fax document is no longer available.");
      const safeName = row.local_ref.replace(/[\\/]/g, "");
      if (!safeName || safeName !== row.local_ref || safeName === "." || safeName === "..") {
        throw new FaxProviderPreflightError("document_unavailable", "The fax document reference is invalid.");
      }

      const resolvedUploadsDir = await fsImpl.realpath(uploadsDir).catch(() => null);
      if (!resolvedUploadsDir) throw new FaxProviderPreflightError("document_unavailable", "The fax document store could not be resolved.");
      const resolvedPath = await fsImpl.realpath(join(uploadsDir, safeName)).catch(() => null);
      if (!resolvedPath) throw new FaxProviderPreflightError("document_unavailable", "The fax document could not be found.");
      const relativePath = relative(resolvedUploadsDir, resolvedPath);
      if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
        // A symlink/reparse point resolved outside the managed uploads
        // directory. Never follow it to an arbitrary local file.
        throw new FaxProviderPreflightError("document_unsafe_path", "The fax document reference resolves outside the managed document store.");
      }

      const stats = await fsImpl.stat(resolvedPath).catch(() => null);
      if (!stats || !stats.isFile()) throw new FaxProviderPreflightError("document_unavailable", "The fax document could not be found.");
      if (stats.size === 0) throw new FaxProviderPreflightError("document_unavailable", "The fax document is empty.");
      if (stats.size > TELNYX_MULTIPART_MAX_BYTES) {
        throw new FaxProviderPreflightError("document_too_large", `The fax document exceeds Telnyx's ${TELNYX_MULTIPART_MAX_BYTES / (1024 * 1024)}MB multipart upload limit.`);
      }

      const extension = extname(safeName).toLowerCase();
      const canonicalContentType = TELNYX_SUPPORTED_EXTENSIONS[extension];
      if (!canonicalContentType) throw new FaxProviderPreflightError("unsupported_media_type", "The fax document format is not supported by Telnyx Programmable Fax.");
      const declaredContentType = (row.content_type || "").trim().toLowerCase();
      if (declaredContentType && topLevelMediaType(declaredContentType) !== topLevelMediaType(canonicalContentType)) {
        // The stored content_type and the file extension materially
        // disagree (different top-level media type) -- fail closed rather
        // than guess which one is honest.
        throw new FaxProviderPreflightError("media_type_mismatch", "The fax document's recorded content type does not match its file extension.");
      }

      const buffer = await fsImpl.readFile(resolvedPath);
      if (row.content_sha256) {
        const actual = createHash("sha256").update(buffer).digest("hex");
        if (actual.toLowerCase() !== row.content_sha256.trim().toLowerCase()) {
          throw new FaxProviderPreflightError("document_hash_mismatch", "The fax document's content no longer matches its recorded hash.");
        }
      }

      return { kind: "contents", buffer, filename: row.display_name || safeName, contentType: canonicalContentType };
    }
  };
}

// --- Telnyx status normalization (frozen contract) --------------------------
// The rest of ForgeLink must never see Telnyx's own status strings -- see
// FaxSubmissionService, which feeds every mapped result through
// applyFaxObservation (Phase 1.1's monotonic, skip-ahead-safe reconciliation),
// never through the strict local command path.
const OUTBOUND_STATUS_MAP: Readonly<Record<string, FaxState>> = {
  "queued": "accepted",
  "media.processed": "accepted",
  "originated": "sending",
  "sending": "sending",
  "delivered": "delivered",
  "failed": "failed"
};

const INBOUND_STATUS_MAP: Readonly<Record<string, FaxState>> = {
  "initiated": "receiving",
  "receiving": "receiving",
  "media.processing": "processing",
  "received": "received",
  "failed": "failed"
};

export function mapTelnyxFaxStatus(status: string, direction: FaxDirection): FaxState | null {
  const table = direction === "inbound" ? INBOUND_STATUS_MAP : OUTBOUND_STATUS_MAP;
  return table[status] ?? null;
}

const TELNYX_QUALITY_VALUES = new Set(["normal", "high", "very_high", "ultra_light", "ultra_dark"]);

function normalizeTelnyxQuality(quality: string | undefined): string | undefined {
  if (!quality) return undefined;
  return TELNYX_QUALITY_VALUES.has(quality) ? quality : undefined;
}

// A bounded, safe error category derived from Telnyx's JSON:API-style error
// body ({ errors: [{ code, title }] }). Never the raw body, never `detail`
// (which can echo request field values back, including media information).
async function safeTelnyxErrorCategory(response: Response): Promise<string> {
  try {
    const json = await response.json() as { errors?: Array<{ code?: string; title?: string }> };
    const first = Array.isArray(json.errors) ? json.errors[0] : undefined;
    const code = typeof first?.code === "string" ? first.code : "";
    if (code) return code.slice(0, 40);
    const title = typeof first?.title === "string" ? first.title : "";
    return title ? title.slice(0, 60).replace(/[^\x20-\x7e]/g, "") : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

function authHeaders(config: TelnyxFaxConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" };
}

const TELNYX_CAPABILITIES: ChannelCapabilities = {
  kind: "fax_edge",
  provider: "telnyx",
  displayName: "Telnyx Fax",
  // Truthful to this phase only: outbound send/status/cancel. fax_receive is
  // not advertised -- inbound reception is not implemented (Phase 4/WI041
  // scope). fax_media is not advertised as a standalone capability -- media
  // resolution here is an internal adapter concern, not a capability other
  // ForgeLink code discovers/depends on.
  capabilities: ["fax_send", "fax_status", "fax_cancel"]
};

export interface CreateTelnyxFaxProviderOptions {
  config?: TelnyxFaxConfig;
  fetchImpl?: typeof fetch;
  documentResolver: TelnyxFaxDocumentResolver;
}

export function createTelnyxFaxProvider(options: CreateTelnyxFaxProviderOptions): FaxProvider {
  const fetchImpl = options.fetchImpl || fetch;
  const { documentResolver } = options;
  const configOf = (): TelnyxFaxConfig => options.config || loadTelnyxFaxConfig();

  return {
    capabilities: () => TELNYX_CAPABILITIES,

    // Phase 2.1 finding 3: `ok` must not be true when outbound fax is not
    // actually ready. `readiness.ok` (structurally valid, resolvable
    // configuration) is necessary but not sufficient for a send-gating
    // credential check -- a Fax Application with no Outbound Voice Profile
    // is exactly the case the review flagged. Richer readiness
    // (configured/outbound_ready/inbound_webhook_ready) remains available
    // separately via validateTelnyxFaxConfig for settings/status UI, which
    // must still be able to show configured=true, outbound_ready=false
    // truthfully rather than a single collapsed boolean.
    validateCredentials: async (): Promise<CredentialValidation> => {
      const readiness = await validateTelnyxFaxConfig(configOf(), fetchImpl);
      const ok = readiness.ok && readiness.outboundReady;
      return { ok, phoneNumber: readiness.phoneNumber, error: ok ? undefined : (readiness.error || "Telnyx Fax outbound is not ready.") };
    },

    // Phase 2.1 finding 5: build/validate the request (local, no side
    // effect) is fully separated from invoking network transport. Only a
    // failure of the fetch() call itself becomes FaxProviderAmbiguousError;
    // every failure above that line -- missing config, missing sending
    // number, an unresolvable/invalid document, a request-construction
    // error -- is a FaxProviderPreflightError and never reaches fetch().
    sendFax: async (request: FaxRequest): Promise<FaxResult> => {
      const config = configOf();
      if (!config.apiKey || !config.connectionId) throw new FaxProviderPreflightError("not_configured", "Telnyx Fax is not configured.");
      const from = request.from || config.phoneNumber;
      if (!from) throw new FaxProviderPreflightError("missing_from_number", "No sending fax number is configured or provided.");

      // Document resolution (including all Phase 2.1 finding 4 provider-
      // boundary checks: size, format, path safety, hash) is a preflight
      // concern -- its own errors are already FaxProviderPreflightError and
      // are never caught by the network try/catch below.
      const media = await documentResolver.resolve(request.documentRef);
      const quality = normalizeTelnyxQuality(request.quality);

      let transport: { init: RequestInit; timeoutMs: number };
      try {
        if (media.kind === "contents") {
          // The multipart schema does not include client_state (frozen
          // contract) -- the opaque correlation token cannot be carried on a
          // contents-mode send. This is a recorded, accepted limitation.
          const form = new FormData();
          form.set("connection_id", config.connectionId);
          form.set("from", from);
          form.set("to", request.to);
          if (quality) form.set("quality", quality);
          form.set("contents", new Blob([new Uint8Array(media.buffer)], { type: media.contentType || "application/octet-stream" }), media.filename || "fax-document");
          transport = {
            init: { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" }, body: form },
            timeoutMs: 60_000
          };
        } else {
          const body: Record<string, unknown> = { connection_id: config.connectionId, from, to: request.to };
          if (media.kind === "media_url") body.media_url = media.url; else body.media_name = media.name;
          if (quality) body.quality = quality;
          if (request.correlation) body.client_state = Buffer.from(request.correlation, "utf8").toString("base64");
          transport = {
            init: { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) },
            timeoutMs: 30_000
          };
        }
      } catch {
        // FormData/Blob/JSON construction failed before any network
        // attempt. This provably happened before fetch() -- never ambiguous.
        throw new FaxProviderPreflightError("request_construction_failed", "The fax request could not be constructed.");
      }

      let response: Response;
      try {
        response = await fetchImpl("https://api.telnyx.com/v2/faxes", { ...transport.init, signal: AbortSignal.timeout(transport.timeoutMs) });
      } catch {
        // fetch() itself threw: DNS failure, connection reset, or our own
        // AbortSignal timeout. ForgeLink cannot prove Telnyx never received
        // the request -- never safe to treat as a definite rejection.
        throw new FaxProviderAmbiguousError("network_error", "Could not confirm whether Telnyx received the fax request.");
      }

      if (response.status === 202) {
        const json = await response.json().catch(() => null) as { data?: { id?: string; status?: string; created_at?: string } } | null;
        const providerFaxId = json?.data?.id;
        if (!providerFaxId || typeof providerFaxId !== "string") {
          throw new FaxProviderAmbiguousError("malformed_response", "Telnyx accepted the request but returned no usable fax id.");
        }
        const status = typeof json?.data?.status === "string" ? json.data.status : "";
        const normalizedState = (status && mapTelnyxFaxStatus(status, "outbound")) || "accepted";
        return { providerFaxId, normalizedState, providerAcceptedAt: typeof json?.data?.created_at === "string" ? json.data.created_at : undefined, safeProviderCode: status.slice(0, 40) };
      }
      if (response.status >= 500) {
        throw new FaxProviderAmbiguousError("server_error", `Telnyx returned a server error (${response.status}); acceptance cannot be excluded.`);
      }
      // Phase 2.1 finding 6: 401 (authentication rejected before any fax
      // processing) and 429 (rate-limited, never processed) are definite
      // rejections, not left ambiguous forever -- Telnyx did not accept the
      // request in either case. Automatic retry remains prohibited
      // regardless of this classification; a 429 may become an
      // operator-visible retry-eligible failed state later, never an
      // automatic duplicate send here.
      if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404 || response.status === 422 || response.status === 429) {
        const category = await safeTelnyxErrorCategory(response);
        throw new FaxProviderRejectionError(category, `Telnyx rejected the fax request (${response.status}).`);
      }
      // Any other status this adapter does not explicitly recognize: never
      // guess. Treat as ambiguous rather than silently classifying it as
      // either a success or a definite rejection.
      throw new FaxProviderAmbiguousError("unexpected_status", `Telnyx returned an unexpected response (${response.status}).`);
    },

    // Phase 2.1 finding 1: this method only ever reports what Telnyx said
    // about the *command* (accepted/rejected/uncertain). It is the
    // orchestrator's (FaxSubmissionService) job to decide what that means
    // for local cancel_pending/rollback state -- this adapter never mutates
    // local state and never fabricates a terminal "cancelled" result.
    cancelFax: async (providerFaxId: string): Promise<FaxResult> => {
      const config = configOf();
      if (!config.apiKey) throw new FaxProviderPreflightError("not_configured", "Telnyx Fax is not configured.");
      let response: Response;
      try {
        response = await fetchImpl(`https://api.telnyx.com/v2/faxes/${encodeURIComponent(providerFaxId)}/actions/cancel`, {
          method: "POST",
          headers: authHeaders(config),
          signal: AbortSignal.timeout(20_000)
        });
      } catch {
        throw new FaxProviderAmbiguousError("network_error", "Could not confirm whether Telnyx received the cancel request.");
      }
      if (response.status === 404) throw new FaxProviderRejectionError("not_found", "Telnyx has no record of this fax to cancel.");
      if (response.status === 422) {
        const category = await safeTelnyxErrorCategory(response);
        throw new FaxProviderRejectionError(category, "Telnyx rejected the cancel request; the fax may no longer be cancellable.");
      }
      if (response.status !== 202) throw new FaxProviderAmbiguousError("cancel_uncertain", `Telnyx returned an unexpected response to the cancel request (${response.status}).`);
      // Telnyx's cancel acknowledgment ({ data: { result: "ok" } }) confirms
      // only that the command was accepted, never that the fax is
      // terminally cancelled -- the status enum has no "cancelled" value.
      // See the frozen contract. The true outcome requires a later GET/
      // webhook observation.
      return { providerFaxId, normalizedState: "cancel_pending" };
    },

    // Phase 2.1 finding 2: direction is now an explicit, required property
    // of the returned observation. A missing/malformed Telnyx `direction`
    // is never defaulted to "outbound" -- it becomes a bounded ambiguous
    // error so the caller (FaxSubmissionService.reconcileFax) cannot
    // mutate local state from an unverifiable observation.
    getFax: async (providerFaxId: string): Promise<FaxStatusUpdate> => {
      const config = configOf();
      let response: Response;
      try {
        response = await fetchImpl(`https://api.telnyx.com/v2/faxes/${encodeURIComponent(providerFaxId)}`, { headers: authHeaders(config), signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new FaxProviderAmbiguousError("network_error", "Could not confirm the fax status with Telnyx.");
      }
      if (response.status === 404) throw new FaxProviderRejectionError("not_found", "Telnyx has no record of this fax.");
      if (!response.ok) throw new FaxProviderAmbiguousError("reconciliation_error", `Telnyx reconciliation request failed (${response.status}).`);
      const json = await response.json().catch(() => null) as { data?: { status?: string; direction?: string; updated_at?: string } } | null;
      const rawDirection = json?.data?.direction;
      const direction: FaxDirection | null = rawDirection === "outbound" ? "outbound" : rawDirection === "inbound" ? "inbound" : null;
      if (!direction) throw new FaxProviderAmbiguousError("malformed_direction", "Telnyx reported no recognizable fax direction.");
      const status = typeof json?.data?.status === "string" ? json.data.status : "";
      const mapped = status ? mapTelnyxFaxStatus(status, direction) : null;
      if (!mapped) throw new FaxProviderAmbiguousError("unknown_status", "Telnyx reported an unrecognized fax status.");
      return {
        providerFaxId,
        direction,
        normalizedState: mapped,
        occurredAt: typeof json?.data?.updated_at === "string" ? json.data.updated_at : new Date().toISOString(),
        safeProviderCode: status.slice(0, 40)
      };
    }
  };
}

// Best-effort inbound media reference recovery (work item 041, Phase 4:
// FAX-007). Current Telnyx documentation does not state whether
// GET /v2/faxes/{id} returns a *refreshed* media_url once the original
// webhook's signed URL has expired, nor does it document an
// inbound-specific size limit -- this function makes no such assumption.
// It only fetches and normalizes whatever the Fax resource currently
// reports; the caller (fax-inbound-acquisition.ts) is responsible for
// validating the returned identity fields before using any media URL and
// for treating a still-unusable/expired reference as a truthful
// retryable/unavailable acquisition state, never a fabricated success.
// Deliberately separate from FaxProvider.getFax -- that method's
// FaxStatusUpdate contract is provider-neutral and does not carry
// media_url; this function is Telnyx-specific media recovery only.
export interface TelnyxInboundFaxMediaReference {
  providerFaxId: string;
  direction: FaxDirection | null;
  connectionId: string;
  mediaUrl: string;
}

export async function getTelnyxInboundFaxMediaReference(
  config: TelnyxFaxConfig,
  providerFaxId: string,
  fetchImpl: typeof fetch = fetch
): Promise<TelnyxInboundFaxMediaReference | null> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telnyx.com/v2/faxes/${encodeURIComponent(providerFaxId)}`, { headers: authHeaders(config), signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const json = await response.json().catch(() => null) as { data?: { id?: string; direction?: string; connection_id?: string; media_url?: string } } | null;
  const data = json?.data;
  const id = typeof data?.id === "string" ? data.id : "";
  if (!id) return null;
  const rawDirection = data?.direction;
  const direction: FaxDirection | null = rawDirection === "outbound" ? "outbound" : rawDirection === "inbound" ? "inbound" : null;
  const connectionId = typeof data?.connection_id === "string" ? data.connection_id : "";
  const mediaUrl = typeof data?.media_url === "string" ? data.media_url : "";
  return { providerFaxId: id, direction, connectionId, mediaUrl };
}
