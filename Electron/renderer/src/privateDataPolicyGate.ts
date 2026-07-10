export type PrivateDataDomain =
  | "messages"
  | "contacts"
  | "calls"
  | "signal_content"
  | "attachments";

export type PrivateDataSensitivityClass =
  | "private"
  | "restricted";

export type PrivateDataRequestedSyncMode =
  | "private_change_set"
  | "metadata_only"
  | "none";

export type PrivateDataPolicyLinkState =
  | "local_only"
  | "link_requested"
  | "linked"
  | "degraded"
  | "stale"
  | "lost"
  | "revoked"
  | "wipe_pending"
  | "wiped";

export type PrivateDataPolicyTrustState =
  | "local"
  | "pending"
  | "limited"
  | "trusted"
  | "revoked";

export type PrivateDataPolicyGateReason =
  | "allowed"
  | "not_private_data_request"
  | "invalid_request_identity"
  | "missing_policy"
  | "policy_expired"
  | "missing_operator_confirmation"
  | "encryption_unavailable"
  | "retention_undefined"
  | "revocation_undefined"
  | "wipe_undefined"
  | "conflict_handling_undefined"
  | "rollback_undefined"
  | "audit_undefined"
  | "link_stale"
  | "link_revoked"
  | "link_lost"
  | "link_degraded"
  | "link_not_active"
  | "trust_not_approved"
  | "unsupported_data_domain"
  | "unsupported_sync_mode";

export interface PrivateDataPolicyGateInput {
  source_node_id: string;
  target_node_id: string;
  link_id: string;
  data_domain: string;
  sensitivity_class: string;
  requested_sync_mode: string;
  link_state: PrivateDataPolicyLinkState;
  trust_state: PrivateDataPolicyTrustState;
  policy_present: boolean;
  policy_expires_at: string | null;
  operator_confirmation_present: boolean;
  encryption_ready: boolean;
  retention_ready: boolean;
  revocation_behavior_ready: boolean;
  wipe_behavior_ready: boolean;
  conflict_handling_ready: boolean;
  rollback_ready: boolean;
  audit_ready: boolean;
  now?: string;
}

export interface PrivateDataPolicyGateDecision {
  decision: "allow" | "deny";
  reason_code: PrivateDataPolicyGateReason;
  redacted_reason: string;
  audit_event_type:
    | "private_data_policy_gate.allowed"
    | "private_data_policy_gate.denied";
}

const SUPPORTED_PRIVATE_DATA_DOMAINS = new Set<PrivateDataDomain>([
  "messages",
  "contacts",
  "calls",
  "signal_content",
  "attachments"
]);

const SUPPORTED_SENSITIVITY_CLASSES =
  new Set<PrivateDataSensitivityClass>(["private", "restricted"]);

function deny(
  reasonCode: PrivateDataPolicyGateReason,
  redactedReason: string
): PrivateDataPolicyGateDecision {
  return {
    decision: "deny",
    reason_code: reasonCode,
    redacted_reason: redactedReason,
    audit_event_type: "private_data_policy_gate.denied"
  };
}

export function evaluatePrivateDataPolicyGate(
  input: PrivateDataPolicyGateInput
): PrivateDataPolicyGateDecision {
  if (
    !input.source_node_id.trim() ||
    !input.target_node_id.trim() ||
    !input.link_id.trim()
  ) {
    return deny(
      "invalid_request_identity",
      "Private-data request identity is incomplete."
    );
  }

  if (
    input.requested_sync_mode === "metadata_only" ||
    input.requested_sync_mode === "none"
  ) {
    return deny(
      "not_private_data_request",
      "Metadata-only and disabled sync requests do not use private-data approval."
    );
  }

  if (input.requested_sync_mode !== "private_change_set") {
    return deny(
      "unsupported_sync_mode",
      "The requested private-data sync mode is unsupported."
    );
  }

  if (!SUPPORTED_PRIVATE_DATA_DOMAINS.has(input.data_domain as PrivateDataDomain)) {
    return deny(
      "unsupported_data_domain",
      "The requested private-data domain is unsupported."
    );
  }

  if (
    !SUPPORTED_SENSITIVITY_CLASSES.has(
      input.sensitivity_class as PrivateDataSensitivityClass
    )
  ) {
    return deny(
      "unsupported_data_domain",
      "The requested sensitivity class is unsupported."
    );
  }

  if (input.link_state === "stale") {
    return deny("link_stale", "The linked node is stale.");
  }

  if (
    input.link_state === "revoked" ||
    input.link_state === "wipe_pending" ||
    input.link_state === "wiped"
  ) {
    return deny("link_revoked", "The linked node is revoked or unavailable.");
  }

  if (input.link_state === "lost") {
    return deny("link_lost", "The linked node is lost.");
  }

  if (input.link_state === "degraded") {
    return deny(
      "link_degraded",
      "A degraded link cannot authorize private-data sync."
    );
  }

  if (input.link_state !== "linked") {
    return deny(
      "link_not_active",
      "An active linked-node relationship is required."
    );
  }

  if (input.trust_state !== "trusted") {
    return deny(
      "trust_not_approved",
      "The linked node is not trusted for private-data evaluation."
    );
  }

  if (!input.policy_present) {
    return deny(
      "missing_policy",
      "No private-data policy authorizes this request."
    );
  }

  if (input.policy_expires_at === null) {
    return deny(
      "policy_expired",
      "The private-data policy has no valid expiry."
    );
  }

  const now = Date.parse(input.now || new Date().toISOString());
  const expiresAt = Date.parse(input.policy_expires_at);

  if (
    !Number.isFinite(now) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    return deny(
      "policy_expired",
      "The private-data policy is expired or invalid."
    );
  }

  if (!input.operator_confirmation_present) {
    return deny(
      "missing_operator_confirmation",
      "Explicit operator confirmation is required."
    );
  }

  if (!input.encryption_ready) {
    return deny(
      "encryption_unavailable",
      "Required encryption is unavailable."
    );
  }

  if (!input.retention_ready) {
    return deny(
      "retention_undefined",
      "Private-data retention behavior is undefined."
    );
  }

  if (!input.revocation_behavior_ready) {
    return deny(
      "revocation_undefined",
      "Private-data revocation behavior is undefined."
    );
  }

  if (!input.wipe_behavior_ready) {
    return deny(
      "wipe_undefined",
      "Private-data wipe behavior is undefined."
    );
  }

  if (!input.conflict_handling_ready) {
    return deny(
      "conflict_handling_undefined",
      "Private-data conflict handling is undefined."
    );
  }

  if (!input.rollback_ready) {
    return deny(
      "rollback_undefined",
      "Private-data rollback behavior is undefined."
    );
  }

  if (!input.audit_ready) {
    return deny(
      "audit_undefined",
      "Private-data audit behavior is undefined."
    );
  }

  return {
    decision: "allow",
    reason_code: "allowed",
    redacted_reason:
      "The request satisfies the modeled private-data policy prerequisites.",
    audit_event_type: "private_data_policy_gate.allowed"
  };
}
