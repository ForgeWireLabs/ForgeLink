export const LINKED_NODE_AUDIT_EVENT_TYPES = [
  "link.requested",
  "link.accepted",
  "link.revoked",
  "link.degraded",
  "link.stale",
  "link.lost",
  "wipe.requested",
  "wipe.acknowledged",
  "policy.allowed",
  "policy.denied",
  "envelope.accepted",
  "envelope.rejected",
  "change_set.accepted",
  "change_set.rejected",
  "change_set.quarantined",
  "checkpoint.accepted",
  "checkpoint.rejected",
  "rollback.requested",
  "rollback.completed",
  "rollback.rejected"
] as const;

export type LinkedNodeAuditEventType =
  typeof LINKED_NODE_AUDIT_EVENT_TYPES[number];

export type LinkedNodeAuditDecision =
  | "accepted"
  | "rejected"
  | "quarantined"
  | "revoked"
  | "degraded"
  | "stale"
  | "wiped"
  | "rolled_back";

export interface RedactedLinkedNodeAuditInput {
  event_id: string;
  event_type: string;
  source_node_id: string;
  target_node_id: string;
  link_id: string;
  policy_id: string | null;
  data_classes: string[];
  sync_mode: string;
  checkpoint_hash: string | null;
  change_set_hash: string | null;
  envelope_hash: string | null;
  decision: LinkedNodeAuditDecision;
  reason_code: string;
  redacted_reason: string;
  created_at: string;
  audit_parent_hash: string | null;
  nonce_hash?: string | null;
}

export interface RedactedLinkedNodeAuditEvent {
  schema_version: 1;
  event_id: string;
  event_type: LinkedNodeAuditEventType;
  source_node_id: string;
  target_node_id: string;
  link_id: string;
  policy_id: string | null;
  data_classes: string[];
  sync_mode: string;
  checkpoint_hash: string | null;
  change_set_hash: string | null;
  envelope_hash: string | null;
  decision: LinkedNodeAuditDecision;
  reason_code: string;
  redacted_reason: string;
  created_at: string;
  audit_parent_hash: string | null;
  nonce_hash: string | null;
  redacted: true;
}

export type RedactedLinkedNodeAuditWriteReason =
  | "written"
  | "invalid_event_id"
  | "unsupported_event_type"
  | "missing_source_node_id"
  | "missing_target_node_id"
  | "missing_link_id"
  | "missing_reason_code"
  | "missing_redacted_reason"
  | "invalid_created_at"
  | "invalid_data_classes"
  | "forbidden_data_class"
  | "invalid_sync_mode";

export interface RedactedLinkedNodeAuditWriteResult {
  written: boolean;
  reason_code: RedactedLinkedNodeAuditWriteReason;
  event: RedactedLinkedNodeAuditEvent | null;
}

const EVENT_TYPE_SET = new Set<string>(
  LINKED_NODE_AUDIT_EVENT_TYPES
);

const ALLOWED_DATA_CLASSES = new Set<string>([
  "attention_policy",
  "agent_channel_metadata",
  "pairing_status",
  "node_link_status",
  "capability_cache",
  "sync_policy",
  "sync_checkpoint_metadata",
  "redacted_sync_health",
  "redacted_summary",
  "redacted_status_rows",
  "change_set_metadata",
  "wipe_status",
  "audit_event",
  "audit_event_hashes"
]);

const FORBIDDEN_DATA_CLASSES = new Set<string>([
  "raw_private_data",
  "raw_messages",
  "messages",
  "contacts",
  "calls",
  "call_history",
  "attachments",
  "signal_content",
  "raw_signal_content",
  "notification_body",
  "credentials",
  "provider_secrets",
  "tokens",
  "private_keys",
  "desktop_database",
  "database_dump"
]);

const ALLOWED_SYNC_MODES = new Set<string>([
  "none",
  "metadata_only",
  "redacted",
  "private_data_disabled",
  "private_data_policy_pending"
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(
  reasonCode: RedactedLinkedNodeAuditWriteReason
): RedactedLinkedNodeAuditWriteResult {
  return {
    written: false,
    reason_code: reasonCode,
    event: null
  };
}

export function writeRedactedLinkedNodeAuditEvent(
  input: RedactedLinkedNodeAuditInput
): RedactedLinkedNodeAuditWriteResult {
  if (!nonEmpty(input.event_id)) {
    return failure("invalid_event_id");
  }

  if (!EVENT_TYPE_SET.has(input.event_type)) {
    return failure("unsupported_event_type");
  }

  if (!nonEmpty(input.source_node_id)) {
    return failure("missing_source_node_id");
  }

  if (!nonEmpty(input.target_node_id)) {
    return failure("missing_target_node_id");
  }

  if (!nonEmpty(input.link_id)) {
    return failure("missing_link_id");
  }

  if (!nonEmpty(input.reason_code)) {
    return failure("missing_reason_code");
  }

  if (!nonEmpty(input.redacted_reason)) {
    return failure("missing_redacted_reason");
  }

  if (
    !nonEmpty(input.created_at) ||
    !Number.isFinite(Date.parse(input.created_at))
  ) {
    return failure("invalid_created_at");
  }

  if (
    !Array.isArray(input.data_classes) ||
    input.data_classes.length === 0
  ) {
    return failure("invalid_data_classes");
  }

  for (const dataClass of input.data_classes) {
    if (FORBIDDEN_DATA_CLASSES.has(dataClass)) {
      return failure("forbidden_data_class");
    }

    if (!ALLOWED_DATA_CLASSES.has(dataClass)) {
      return failure("invalid_data_classes");
    }
  }

  if (!ALLOWED_SYNC_MODES.has(input.sync_mode)) {
    return failure("invalid_sync_mode");
  }

  return {
    written: true,
    reason_code: "written",
    event: {
      schema_version: 1,
      event_id: input.event_id,
      event_type: input.event_type as LinkedNodeAuditEventType,
      source_node_id: input.source_node_id,
      target_node_id: input.target_node_id,
      link_id: input.link_id,
      policy_id: input.policy_id,
      data_classes: [...input.data_classes],
      sync_mode: input.sync_mode,
      checkpoint_hash: input.checkpoint_hash,
      change_set_hash: input.change_set_hash,
      envelope_hash: input.envelope_hash,
      decision: input.decision,
      reason_code: input.reason_code,
      redacted_reason: input.redacted_reason,
      created_at: input.created_at,
      audit_parent_hash: input.audit_parent_hash,
      nonce_hash: input.nonce_hash ?? null,
      redacted: true
    }
  };
}

export function serializeRedactedLinkedNodeAuditEvent(
  event: RedactedLinkedNodeAuditEvent
): string {
  return JSON.stringify(event);
}
