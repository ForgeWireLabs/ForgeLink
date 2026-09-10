// Telnyx Programmable Fax outbound edge (work item 041, Phase 2: FAX-004,
// FAX-005). Kept entirely separate from telnyx.ts (SMS/MMS) and twilio.ts:
// a Fax Application is not a Messaging Profile, and fax lifecycle parsing
// stays fax-specific even though both products share one Telnyx account.
// The frozen contract this file implements (verified 2026-09-10 against the
// authoritative Telnyx OpenAPI spec) is recorded in
// work/active/041-first-class-fax-communications-and-telnyx-fax-edge/local-artifacts/phase2-telnyx-fax-contract.md;
// re-read it before changing request/response field handling here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

// Production resolver: reads a ForgeLink-managed fax document from the same
// `<dataDir>/uploads/` directory server.ts already uses for MMS media.
// `fax_documents.local_ref` is treated as a filename within that directory,
// never an absolute/external path, and never a public URL.
export function createLocalFileFaxDocumentResolver(
  database: Pick<PhoneDatabase, "faxDocumentById">,
  uploadsDir: string,
  readFileImpl: typeof readFile = readFile
): TelnyxFaxDocumentResolver {
  return {
    async resolve(documentRef: FaxDocumentRef): Promise<TelnyxFaxMediaSource> {
      const row: FaxDocumentRow | undefined = database.faxDocumentById(documentRef.id);
      if (!row) throw new FaxProviderPreflightError("document_unavailable", "The fax document could not be found.");
      if (row.retention_state !== "active") throw new FaxProviderPreflightError("document_unavailable", "The fax document is no longer available.");
      const safeName = row.local_ref.replace(/[\\/]/g, "");
      if (!safeName || safeName !== row.local_ref) throw new FaxProviderPreflightError("document_unavailable", "The fax document reference is invalid.");
      let buffer: Buffer;
      try {
        buffer = await readFileImpl(join(uploadsDir, safeName));
      } catch {
        throw new FaxProviderPreflightError("document_unavailable", "The fax document could not be read.");
      }
      return { kind: "contents", buffer, filename: row.display_name || safeName, contentType: row.content_type || "application/pdf" };
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

    validateCredentials: async (): Promise<CredentialValidation> => {
      const readiness = await validateTelnyxFaxConfig(configOf(), fetchImpl);
      return { ok: readiness.ok, phoneNumber: readiness.phoneNumber, error: readiness.error };
    },

    sendFax: async (request: FaxRequest): Promise<FaxResult> => {
      const config = configOf();
      if (!config.apiKey || !config.connectionId) throw new FaxProviderPreflightError("not_configured", "Telnyx Fax is not configured.");

      const media = await documentResolver.resolve(request.documentRef);
      const quality = normalizeTelnyxQuality(request.quality);
      const from = request.from || config.phoneNumber;

      let response: Response;
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
          response = await fetchImpl("https://api.telnyx.com/v2/faxes", {
            method: "POST",
            headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
            body: form,
            signal: AbortSignal.timeout(60_000)
          });
        } else {
          const body: Record<string, unknown> = { connection_id: config.connectionId, from, to: request.to };
          if (media.kind === "media_url") body.media_url = media.url; else body.media_name = media.name;
          if (quality) body.quality = quality;
          if (request.correlation) body.client_state = Buffer.from(request.correlation, "utf8").toString("base64");
          response = await fetchImpl("https://api.telnyx.com/v2/faxes", {
            method: "POST",
            headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000)
          });
        }
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
      if (response.status === 400 || response.status === 403 || response.status === 404 || response.status === 422) {
        const category = await safeTelnyxErrorCategory(response);
        throw new FaxProviderRejectionError(category, `Telnyx rejected the fax request (${response.status}).`);
      }
      // Any other status this adapter does not explicitly recognize: never
      // guess. Treat as ambiguous rather than silently classifying it as
      // either a success or a definite rejection.
      throw new FaxProviderAmbiguousError("unexpected_status", `Telnyx returned an unexpected response (${response.status}).`);
    },

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
      const status = typeof json?.data?.status === "string" ? json.data.status : "";
      const direction: FaxDirection = json?.data?.direction === "inbound" ? "inbound" : "outbound";
      const mapped = status ? mapTelnyxFaxStatus(status, direction) : null;
      if (!mapped) throw new FaxProviderAmbiguousError("unknown_status", "Telnyx reported an unrecognized fax status.");
      return {
        providerFaxId,
        normalizedState: mapped,
        occurredAt: typeof json?.data?.updated_at === "string" ? json.data.updated_at : new Date().toISOString(),
        safeProviderCode: status.slice(0, 40)
      };
    }
  };
}
