// Outbound fax submission orchestration (work item 041, Phase 2: FAX-005).
//
// This is the single ForgeLink-owned boundary between a locally-prepared
// fax and an external provider side effect. Callers never invoke
// FaxProvider.sendFax() directly or hand-manipulate fax state; they call
// submitFax()/reconcileFax()/requestFaxCancellation() here.
//
//   existing fax (state=submission_pending)
//       |
//       | atomic CAS claim: applyFaxState(id, "submitting")
//       |   -- a WHERE local_fax_id=? AND state=? conditional UPDATE
//       |      (Phase 1.1); only the caller whose UPDATE actually matches a
//       |      row wins, so a second concurrent caller's own claim attempt
//       |      correctly fails rather than racing a second send.
//       v
//   submitting (exactly one winner reaches this point)
//       |
//       | exactly one FaxProvider.sendFax() invocation, by the winner
//       v
//   FaxProviderRejectionError / FaxProviderPreflightError -> failed (definite, provider not called or explicitly rejected)
//   FaxProviderAmbiguousError                             -> ambiguous (network/timeout/5xx/malformed -- never auto-retried)
//   explicit accepted response with a usable provider id   -> accepted (provider id persisted first)

import { randomBytes } from "node:crypto";
import {
  FaxProvider,
  FaxProviderAmbiguousError,
  FaxProviderPreflightError,
  FaxProviderRejectionError,
  FaxState
} from "./fax";
import { FaxRow, PhoneDatabase } from "./database";

export type FaxSubmissionOutcome =
  | { outcome: "not_claimed" }
  | { outcome: "accepted"; providerFaxId: string }
  | { outcome: "failed"; category: string }
  | { outcome: "ambiguous"; category: string };

export type FaxSubmissionDatabase = Pick<
  PhoneDatabase,
  "faxByLocalId" | "applyFaxState" | "applyFaxObservation" | "faxDocumentsByFaxId" | "setFaxProviderCorrelationToken"
>;

export interface FaxSubmissionDeps {
  database: FaxSubmissionDatabase;
  provider: FaxProvider;
  generateCorrelationToken?: () => string;
}

// Opaque, locally-generated, non-sensitive: no phone numbers, filenames,
// contact/agent names, document hashes, or other private metadata. Safe to
// leave the local machine as a provider client_state value.
export function generateProviderCorrelationToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function submitFax(localFaxId: string, deps: FaxSubmissionDeps): Promise<FaxSubmissionOutcome> {
  // The atomic claim. Any state other than submission_pending (including a
  // second concurrent caller who also thought the fax was submission_pending)
  // fails this cleanly -- see Phase 1.1's applyFaxState.
  const claimed = deps.database.applyFaxState(localFaxId, "submitting");
  if (!claimed) return { outcome: "not_claimed" };

  const fax: FaxRow | undefined = deps.database.faxByLocalId(localFaxId);
  if (!fax) return { outcome: "not_claimed" };

  try {
    const documents = deps.database.faxDocumentsByFaxId(localFaxId);
    const primary = documents.find((doc) => doc.role === "primary") || documents[0];
    if (!primary) throw new FaxProviderPreflightError("missing_document", "No document is attached to this fax.");

    const token = (deps.generateCorrelationToken || generateProviderCorrelationToken)();
    deps.database.setFaxProviderCorrelationToken(localFaxId, token);

    const result = await deps.provider.sendFax({
      localFaxId,
      from: fax.from_number || undefined,
      to: fax.to_number,
      documentRef: { id: primary.id, contentType: primary.content_type || undefined, pageCount: primary.page_count ?? undefined },
      quality: fax.quality || undefined,
      correlation: token
    });

    // Defense in depth: even if a provider implementation returns an
    // "accepted" result with no usable reconciliation identity, treat it as
    // ambiguous rather than trusting a nominally-successful call.
    if (!result.providerFaxId) {
      deps.database.applyFaxState(localFaxId, "ambiguous", { failureCategory: "missing_provider_id" });
      return { outcome: "ambiguous", category: "missing_provider_id" };
    }

    deps.database.applyFaxState(localFaxId, "accepted", { providerFaxId: result.providerFaxId });
    return { outcome: "accepted", providerFaxId: result.providerFaxId };
  } catch (error) {
    if (error instanceof FaxProviderRejectionError || error instanceof FaxProviderPreflightError) {
      deps.database.applyFaxState(localFaxId, "failed", { failureCategory: error.category, redactedError: error.message.slice(0, 300) });
      return { outcome: "failed", category: error.category };
    }
    if (error instanceof FaxProviderAmbiguousError) {
      deps.database.applyFaxState(localFaxId, "ambiguous", { failureCategory: error.category, redactedError: error.message.slice(0, 300) });
      return { outcome: "ambiguous", category: error.category };
    }
    // An error type this orchestrator does not recognize: never assume
    // failure just because it isn't one of the typed classes above --
    // an unrecognized error after the provider call began is exactly the
    // "unexpected response after request transmission" case the README
    // requires to resolve as ambiguous, not failed.
    deps.database.applyFaxState(localFaxId, "ambiguous", { failureCategory: "unknown_error" });
    return { outcome: "ambiguous", category: "unknown_error" };
  }
}

export type FaxReconciliationOutcome =
  | { outcome: "advanced"; state: FaxState }
  | { outcome: "unchanged" }
  | { outcome: "no_provider_id" }
  | { outcome: "error"; category: string };

// GET-based reconciliation (FAX-005). Only usable once a provider fax id is
// known; if it is not, the caller cannot resolve the fax here -- see the
// frozen contract's note on the contents-mode client_state gap. Every
// observation is fed through applyFaxObservation (Phase 1.1's monotonic,
// direction-aware, skip-ahead-safe reconciliation), never the strict local
// command path, so a stale/out-of-order GET never regresses local state and
// a cross-direction observation is safely refused.
export async function reconcileFax(localFaxId: string, deps: FaxSubmissionDeps): Promise<FaxReconciliationOutcome> {
  const fax = deps.database.faxByLocalId(localFaxId);
  if (!fax || !fax.provider_fax_id) return { outcome: "no_provider_id" };
  if (!deps.provider.getFax) return { outcome: "unchanged" };
  try {
    const update = await deps.provider.getFax(fax.provider_fax_id);
    const applied = deps.database.applyFaxObservation(localFaxId, update.normalizedState, { occurredAt: update.occurredAt, providerFaxId: fax.provider_fax_id });
    return applied ? { outcome: "advanced", state: update.normalizedState } : { outcome: "unchanged" };
  } catch (error) {
    if (error instanceof FaxProviderRejectionError) return { outcome: "error", category: error.category };
    // Ambiguous/unknown reconciliation failures never mutate state -- try again later.
    return { outcome: "unchanged" };
  }
}

export type FaxCancellationOutcome =
  | { outcome: "claimed" }
  | { outcome: "not_claimed" }
  | { outcome: "error"; category: string };

// Requests cancellation (FAX-005). Entering cancel_pending is a local
// command claim, independent of whether the provider command itself
// succeeds -- Telnyx's cancel acknowledgment is not proof of a terminal
// cancelled outcome (see the frozen contract), so this never sets a
// terminal state itself. Later reconciliation/observation remains
// authoritative for the actual transmission outcome.
export async function requestFaxCancellation(localFaxId: string, deps: FaxSubmissionDeps): Promise<FaxCancellationOutcome> {
  const fax = deps.database.faxByLocalId(localFaxId);
  if (!fax) return { outcome: "not_claimed" };
  const claimed = deps.database.applyFaxState(localFaxId, "cancel_pending");
  if (!claimed) return { outcome: "not_claimed" };
  if (!fax.provider_fax_id || !deps.provider.cancelFax) return { outcome: "claimed" };
  try {
    await deps.provider.cancelFax(fax.provider_fax_id);
    return { outcome: "claimed" };
  } catch (error) {
    if (error instanceof FaxProviderRejectionError) return { outcome: "error", category: error.category };
    return { outcome: "claimed" };
  }
}
