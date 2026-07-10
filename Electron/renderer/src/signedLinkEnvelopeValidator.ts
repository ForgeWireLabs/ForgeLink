export const SIGNED_LINK_ENVELOPE_OPERATIONS = [
  "link_request",
  "link_accept",
  "link_revoke",
  "sync_policy_update",
  "change_set_offer",
  "change_set_ack",
  "wipe_request",
  "wipe_ack",
  "stale_notice"
] as const;

export type SignedLinkEnvelopeOperation =
  typeof SIGNED_LINK_ENVELOPE_OPERATIONS[number];

export const SIGNED_LINK_ENVELOPE_SYNC_MODES = [
  "none",
  "metadata_only",
  "redacted",
  "private_data_disabled",
  "private_data_policy_pending"
] as const;

export type SignedLinkEnvelopeSyncMode =
  typeof SIGNED_LINK_ENVELOPE_SYNC_MODES[number];

export const SIGNED_LINK_ENVELOPE_DATA_CLASSES = [
  "attention_policy",
  "agent_channel_metadata",
  "pairing_status",
  "node_link_status",
  "sync_policy",
  "audit_event",
  "redacted_summary",
  "change_set_metadata",
  "wipe_status"
] as const;

export type SignedLinkEnvelopeDataClass =
  typeof SIGNED_LINK_ENVELOPE_DATA_CLASSES[number];

export const SIGNED_LINK_ENVELOPE_FORBIDDEN_DATA_CLASSES = [
  "raw_private_data",
  "raw_messages",
  "contacts",
  "calls",
  "call_history",
  "attachments",
  "raw_signal_content",
  "notification_body",
  "credentials",
  "provider_secrets",
  "tokens",
  "private_keys"
] as const;

export interface SignedLinkEnvelopeSignatureFixture {
  algorithm: "ed25519";
  key_id: string;
  value: string;
}

export interface SignedLinkEnvelopeFixture {
  schema_version: 1;
  op: string;
  source_node_id: string;
  target_node_id: string;
  link_id: string;
  timestamp: string;
  nonce: string;
  required_capabilities: string[];
  data_classes: string[];
  sync_mode: string;
  policy_id: string;
  base_checkpoint_hash: string | null;
  change_set_hash: string | null;
  audit_parent_hash: string | null;
  payload_hash: string;
  signature: SignedLinkEnvelopeSignatureFixture | null;
}

export type SignedLinkEnvelopeValidationReason =
  | "valid"
  | "invalid_schema_version"
  | "unknown_operation"
  | "missing_source_node_id"
  | "missing_target_node_id"
  | "missing_link_id"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "timestamp_outside_window"
  | "missing_nonce"
  | "replayed_nonce"
  | "missing_required_capabilities"
  | "invalid_required_capability"
  | "missing_data_classes"
  | "forbidden_data_class"
  | "unsupported_data_class"
  | "unsupported_sync_mode"
  | "missing_policy_id"
  | "missing_payload_hash"
  | "missing_signature_metadata"
  | "unsupported_signature_algorithm"
  | "missing_signature_key_id"
  | "missing_signature_value"
  | "invalid_hash_linkage";

export interface SignedLinkEnvelopeValidationResult {
  valid: boolean;
  reason_code: SignedLinkEnvelopeValidationReason;
  redacted_reason: string;
  replay_key: string | null;
  audit_event_type:
    | "signed_link_envelope.accepted"
    | "signed_link_envelope.rejected";
}

export interface SignedLinkEnvelopeValidationOptions {
  now?: string;
  max_clock_skew_ms?: number;
  seen_replay_keys?: ReadonlySet<string>;
}

const OPERATION_SET = new Set<string>(
  SIGNED_LINK_ENVELOPE_OPERATIONS
);

const SYNC_MODE_SET = new Set<string>(
  SIGNED_LINK_ENVELOPE_SYNC_MODES
);

const DATA_CLASS_SET = new Set<string>(
  SIGNED_LINK_ENVELOPE_DATA_CLASSES
);

const FORBIDDEN_DATA_CLASS_SET = new Set<string>(
  SIGNED_LINK_ENVELOPE_FORBIDDEN_DATA_CLASSES
);

function reject(
  reasonCode: SignedLinkEnvelopeValidationReason,
  redactedReason: string,
  replayKey: string | null = null
): SignedLinkEnvelopeValidationResult {
  return {
    valid: false,
    reason_code: reasonCode,
    redacted_reason: redactedReason,
    replay_key: replayKey,
    audit_event_type: "signed_link_envelope.rejected"
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validHashOrNull(value: unknown): boolean {
  return value === null || nonEmpty(value);
}

export function buildSignedLinkEnvelopeReplayKey(
  envelope: Pick<
    SignedLinkEnvelopeFixture,
    | "source_node_id"
    | "target_node_id"
    | "link_id"
    | "op"
    | "nonce"
  >
): string {
  return [
    envelope.source_node_id,
    envelope.target_node_id,
    envelope.link_id,
    envelope.op,
    envelope.nonce
  ].join(":");
}

export function validateSignedLinkEnvelopeFixture(
  envelope: SignedLinkEnvelopeFixture,
  options: SignedLinkEnvelopeValidationOptions = {}
): SignedLinkEnvelopeValidationResult {
  if (envelope.schema_version !== 1) {
    return reject(
      "invalid_schema_version",
      "The signed envelope schema version is unsupported."
    );
  }

  if (!OPERATION_SET.has(envelope.op)) {
    return reject(
      "unknown_operation",
      "The signed envelope operation is unsupported."
    );
  }

  if (!nonEmpty(envelope.source_node_id)) {
    return reject(
      "missing_source_node_id",
      "The source node identifier is missing."
    );
  }

  if (!nonEmpty(envelope.target_node_id)) {
    return reject(
      "missing_target_node_id",
      "The target node identifier is missing."
    );
  }

  if (!nonEmpty(envelope.link_id)) {
    return reject(
      "missing_link_id",
      "The link identifier is missing."
    );
  }

  if (!nonEmpty(envelope.timestamp)) {
    return reject(
      "missing_timestamp",
      "The signed envelope timestamp is missing."
    );
  }

  const timestamp = Date.parse(envelope.timestamp);
  const now = Date.parse(options.now || new Date().toISOString());

  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return reject(
      "invalid_timestamp",
      "The signed envelope timestamp is invalid."
    );
  }

  const maxClockSkewMs =
    options.max_clock_skew_ms ?? 5 * 60 * 1000;

  if (Math.abs(now - timestamp) > maxClockSkewMs) {
    return reject(
      "timestamp_outside_window",
      "The signed envelope timestamp is outside the accepted window."
    );
  }

  if (!nonEmpty(envelope.nonce)) {
    return reject(
      "missing_nonce",
      "The signed envelope nonce is missing."
    );
  }

  const replayKey = buildSignedLinkEnvelopeReplayKey(envelope);

  if (options.seen_replay_keys?.has(replayKey)) {
    return reject(
      "replayed_nonce",
      "The signed envelope replay tuple has already been observed.",
      replayKey
    );
  }

  if (!Array.isArray(envelope.required_capabilities)) {
    return reject(
      "missing_required_capabilities",
      "The required capability list is missing."
    );
  }

  if (
    envelope.required_capabilities.some(
      capability => !nonEmpty(capability)
    )
  ) {
    return reject(
      "invalid_required_capability",
      "The required capability list contains an invalid entry.",
      replayKey
    );
  }

  if (
    !Array.isArray(envelope.data_classes) ||
    envelope.data_classes.length === 0
  ) {
    return reject(
      "missing_data_classes",
      "The signed envelope data-class list is missing.",
      replayKey
    );
  }

  for (const dataClass of envelope.data_classes) {
    if (FORBIDDEN_DATA_CLASS_SET.has(dataClass)) {
      return reject(
        "forbidden_data_class",
        "The signed envelope requests a forbidden private data class.",
        replayKey
      );
    }

    if (!DATA_CLASS_SET.has(dataClass)) {
      return reject(
        "unsupported_data_class",
        "The signed envelope requests an unsupported metadata class.",
        replayKey
      );
    }
  }

  if (!SYNC_MODE_SET.has(envelope.sync_mode)) {
    return reject(
      "unsupported_sync_mode",
      "The signed envelope sync mode is unsupported.",
      replayKey
    );
  }

  if (!nonEmpty(envelope.policy_id)) {
    return reject(
      "missing_policy_id",
      "The signed envelope policy identifier is missing.",
      replayKey
    );
  }

  if (!validHashOrNull(envelope.base_checkpoint_hash)) {
    return reject(
      "invalid_hash_linkage",
      "The base checkpoint hash linkage is invalid.",
      replayKey
    );
  }

  if (!validHashOrNull(envelope.change_set_hash)) {
    return reject(
      "invalid_hash_linkage",
      "The change-set hash linkage is invalid.",
      replayKey
    );
  }

  if (!validHashOrNull(envelope.audit_parent_hash)) {
    return reject(
      "invalid_hash_linkage",
      "The audit parent hash linkage is invalid.",
      replayKey
    );
  }

  if (!nonEmpty(envelope.payload_hash)) {
    return reject(
      "missing_payload_hash",
      "The signed envelope payload hash is missing.",
      replayKey
    );
  }

  if (
    envelope.signature === null ||
    typeof envelope.signature !== "object"
  ) {
    return reject(
      "missing_signature_metadata",
      "The signed envelope signature metadata is missing.",
      replayKey
    );
  }

  if (envelope.signature.algorithm !== "ed25519") {
    return reject(
      "unsupported_signature_algorithm",
      "The signature algorithm is unsupported.",
      replayKey
    );
  }

  if (!nonEmpty(envelope.signature.key_id)) {
    return reject(
      "missing_signature_key_id",
      "The signature key identifier is missing.",
      replayKey
    );
  }

  if (!nonEmpty(envelope.signature.value)) {
    return reject(
      "missing_signature_value",
      "The fixture signature value is missing.",
      replayKey
    );
  }

  return {
    valid: true,
    reason_code: "valid",
    redacted_reason:
      "The signed link-envelope fixture satisfies the metadata contract.",
    replay_key: replayKey,
    audit_event_type: "signed_link_envelope.accepted"
  };
}
