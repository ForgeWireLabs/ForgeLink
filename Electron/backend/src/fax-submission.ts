// Outbound fax submission orchestration (work item 041, Phase 2/2.1: FAX-005;
// Phase 3 prerequisite hardening: provider identity binding and POST-response
// vs. webhook convergence).
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
//       |
//       | bind fax.provider to this provider's name BEFORE ever calling it
//       |   (Phase 3 prerequisite): an unbound fax binds now; an
//       |   already-bound fax must match, or submission fails closed with
//       |   no provider call at all.
//       v
//   submitting (exactly one winner reaches this point)
//       |
//       | exactly one FaxProvider.sendFax() invocation, by the winner
//       v
//   FaxProviderRejectionError / FaxProviderPreflightError -> failed (definite, provider not called or explicitly rejected)
//   FaxProviderAmbiguousError                             -> ambiguous (network/timeout/5xx/malformed -- never auto-retried)
//   explicit accepted response with a usable provider id:
//       1. bindFaxProviderIdentity(provider, providerFaxId) -- independent of
//          lifecycle state, so a webhook that already advanced the state
//          first (e.g. a fax.queued webhook racing the HTTP response) can
//          never cause the provider fax id itself to be lost;
//       2. reprocess any ingress events that arrived "unresolved" for this
//          provider fax id before it was bound (the webhook-before-response
//          race), so they converge without waiting for a restart;
//       3. apply the provider's own response observation via
//          applyFaxObservation (never applyFaxState) -- if a webhook has
//          already moved the fax further (sending/delivered/failed), this
//          is correctly refused as "stale" rather than regressing it back
//          to "accepted";
//       4. return the fax's truthful *current* state, not an assumed one.

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
  | { outcome: "accepted"; providerFaxId: string; state: FaxState }
  | { outcome: "failed"; category: string }
  | { outcome: "ambiguous"; category: string };

export type FaxSubmissionDatabase = Pick<
  PhoneDatabase,
  | "faxByLocalId"
  | "applyFaxState"
  | "applyFaxObservation"
  | "faxDocumentsByFaxId"
  | "setFaxProviderCorrelationToken"
  | "restoreCancelClaim"
  | "bindFaxProvider"
  | "bindFaxProviderIdentity"
>;

export interface FaxSubmissionDeps {
  database: FaxSubmissionDatabase;
  provider: FaxProvider;
  generateCorrelationToken?: () => string;
  // Called once a provider fax id is durably bound to this local fax, so a
  // caller (server.ts) can reprocess any webhook events that arrived
  // "unresolved" for that provider fax id before the binding existed --
  // without this hook, such an event would otherwise only resolve on the
  // next restart-recovery drain. Provider-agnostic on purpose: this module
  // has no Telnyx-specific import.
  onProviderFaxIdBound?: (provider: string, providerFaxId: string) => void;
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

  const providerName = deps.provider.capabilities().provider;

  // Provider ownership must be settled before the provider is ever invoked
  // (Phase 3 prerequisite): an unbound fax binds to this provider now; a fax
  // already bound to a *different* provider must never be submitted through
  // this one.
  const providerBinding = deps.database.bindFaxProvider(localFaxId, providerName);
  if (providerBinding === "conflict" || providerBinding === "not_found") {
    deps.database.applyFaxState(localFaxId, "failed", { failureCategory: "provider_mismatch" });
    return { outcome: "failed", category: "provider_mismatch" };
  }

  try {
    const documents = deps.database.faxDocumentsByFaxId(localFaxId);
    const primary = documents.find((doc) => doc.role === "primary") || documents[0];
    if (!primary) throw new FaxProviderPreflightError("missing_document", "No document is attached to this fax.");

    const token = (deps.generateCorrelationToken || generateProviderCorrelationToken)();
    // If the token cannot be durably established first, the provider must
    // never be called -- this is a definite local failure, not an ambiguous
    // one (nothing was sent to the network).
    const tokenPersisted = deps.database.setFaxProviderCorrelationToken(localFaxId, token);
    if (!tokenPersisted) {
      deps.database.applyFaxState(localFaxId, "failed", { failureCategory: "correlation_token_unavailable" });
      return { outcome: "failed", category: "correlation_token_unavailable" };
    }

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

    // Bind the provider fax id independently of lifecycle state (the
    // critical race this phase fixes): a webhook may already have moved the
    // fax's state forward by the time we get here, but the provider fax id
    // itself must never be lost or overwritten.
    const identityBinding = deps.database.bindFaxProviderIdentity(localFaxId, providerName, result.providerFaxId);
    if (identityBinding === "conflict" || identityBinding === "not_found") {
      // Do not guess which id is correct; preserve evidence via the
      // ambiguous state rather than silently overwriting or discarding it.
      deps.database.applyFaxState(localFaxId, "ambiguous", { failureCategory: "provider_identity_conflict" });
      return { outcome: "ambiguous", category: "provider_identity_conflict" };
    }

    // A webhook that arrived before this binding existed could not resolve
    // to a local fax; let it resolve now instead of waiting for a restart.
    deps.onProviderFaxIdBound?.(providerName, result.providerFaxId);

    // Apply the provider's own response observation through the monotonic
    // reconciliation path, never the strict local-command path: if a
    // webhook already advanced the fax further, this is correctly refused
    // (stale) rather than regressing the state back to "accepted".
    deps.database.applyFaxObservation(localFaxId, result.normalizedState, {
      occurredAt: result.providerAcceptedAt,
      providerFaxId: result.providerFaxId
    });

    // Return the fax's truthful current state, whatever it actually
    // resolved to (normally "accepted", but possibly further along if a
    // webhook raced ahead of this response).
    const finalFax = deps.database.faxByLocalId(localFaxId)!;
    return { outcome: "accepted", providerFaxId: result.providerFaxId, state: finalFax.state };
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
  | { outcome: "direction_mismatch" }
  | { outcome: "error"; category: string };

// GET-based reconciliation (FAX-005). Only usable once a provider fax id is
// known; if it is not, the caller cannot resolve the fax here -- see the
// frozen contract's note on the contents-mode client_state gap. Every
// observation is fed through applyFaxObservation (Phase 1.1's monotonic,
// direction-aware, skip-ahead-safe reconciliation), never the strict local
// command path, so a stale/out-of-order GET never regresses local state.
//
// Phase 2.1 finding 2: a provider-observed state alone is not a safe
// direction check -- "failed" is legal in both the outbound and inbound
// graphs. The provider's own reported direction (FaxStatusUpdate.direction)
// is compared against the local fax's direction *before* calling
// applyFaxObservation at all, so a genuinely mismatched observation (e.g. a
// stale/incorrect provider fax id pointing at someone else's inbound fax)
// can never mutate this fax's state, including into "failed".
export async function reconcileFax(localFaxId: string, deps: FaxSubmissionDeps): Promise<FaxReconciliationOutcome> {
  const fax = deps.database.faxByLocalId(localFaxId);
  if (!fax || !fax.provider_fax_id) return { outcome: "no_provider_id" };
  if (!deps.provider.getFax) return { outcome: "unchanged" };
  try {
    const update = await deps.provider.getFax(fax.provider_fax_id);
    if (update.direction !== fax.direction) return { outcome: "direction_mismatch" };
    const outcome = deps.database.applyFaxObservation(localFaxId, update.normalizedState, { occurredAt: update.occurredAt, providerFaxId: fax.provider_fax_id });
    return outcome === "advanced" ? { outcome: "advanced", state: update.normalizedState } : { outcome: "unchanged" };
  } catch (error) {
    if (error instanceof FaxProviderRejectionError) return { outcome: "error", category: error.category };
    // Ambiguous/unknown reconciliation failures never mutate state -- try again later.
    return { outcome: "unchanged" };
  }
}

export type FaxCancellationOutcome =
  | { outcome: "claimed" }
  | { outcome: "ambiguous" }
  | { outcome: "rejected"; category: string }
  | { outcome: "unsupported" }
  | { outcome: "not_claimed" };

// Requests cancellation (FAX-005). Phase 2.1 finding 1: entering
// cancel_pending is no longer unconditional. If there is no known provider
// fax id, or the provider does not implement cancelFax at all, ForgeLink
// cannot issue a cancellation command -- the fax must not be mutated into
// cancel_pending merely because cancellation was requested ("unsupported").
//
// When cancellation *can* be attempted, the local claim
// (accepted/sending -> cancel_pending) is still atomic and still the
// concurrency guard against two callers issuing two cancel commands -- but
// its outcome is now reconciled against what Telnyx actually said:
//
//   provider explicitly accepted (202)        -> remain cancel_pending ("claimed")
//   provider outcome unknown (network/5xx/...) -> remain cancel_pending ("ambiguous";
//                                                  acceptance cannot be excluded)
//   provider explicitly rejected (404/422)     -> roll the claim back to the
//                                                  fax's prior state via a
//                                                  dedicated CAS restore,
//                                                  scoped to cancel_pending
//                                                  only -- never a general
//                                                  reconciliation-graph edge
//
// If a provider observation races the rejection and has already advanced
// the fax to a terminal state, restoreCancelClaim's own
// `WHERE state = cancel_pending` guard makes the rollback a harmless no-op.
export async function requestFaxCancellation(localFaxId: string, deps: FaxSubmissionDeps): Promise<FaxCancellationOutcome> {
  const fax = deps.database.faxByLocalId(localFaxId);
  if (!fax) return { outcome: "not_claimed" };
  if (!fax.provider_fax_id || !deps.provider.cancelFax) return { outcome: "unsupported" };

  const priorState = fax.state;
  const claimed = deps.database.applyFaxState(localFaxId, "cancel_pending");
  if (!claimed) return { outcome: "not_claimed" };

  try {
    await deps.provider.cancelFax(fax.provider_fax_id);
    return { outcome: "claimed" };
  } catch (error) {
    if (error instanceof FaxProviderRejectionError) {
      deps.database.restoreCancelClaim(localFaxId, priorState);
      return { outcome: "rejected", category: error.category };
    }
    // Ambiguous/unknown cancel outcome: Telnyx's acceptance cannot be
    // excluded, so the local claim stands -- it is not safe to assume the
    // command was rejected and roll back.
    return { outcome: "ambiguous" };
  }
}

