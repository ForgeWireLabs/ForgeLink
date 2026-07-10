export const METADATA_CHANGE_SET_DATA_CLASSES = [
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

export type MetadataChangeSetDataClass =
  typeof METADATA_CHANGE_SET_DATA_CLASSES[number];

export const METADATA_CHANGE_SET_SYNC_MODES = [
  "metadata_only",
  "redacted",
  "private_data_disabled",
  "private_data_policy_pending"
] as const;

export type MetadataChangeSetSyncMode =
  typeof METADATA_CHANGE_SET_SYNC_MODES[number];

export const METADATA_CHANGE_SET_FORBIDDEN_DATA_CLASSES = [
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
  "private_keys",
  "desktop_database",
  "database_dump"
] as const;

export interface MetadataChangeSetOperationFixture {
  operation_id: string;
  data_class: string;
  operation_type: "observe" | "upsert_metadata" | "remove_metadata";
  operation_timestamp: string;
  operation_hash: string;
  redacted: true;
}

export interface MetadataChangeSetFixture {
  schema_version: 1;
  change_set_id: string;
  source_node_id: string;
  target_node_id: string;
  link_id: string;
  policy_id: string;
  checkpoint_base_hash: string;
  checkpoint_result_hash: string;
  envelope_hash: string;
  data_classes: string[];
  sync_mode: string;
  created_at: string;
  expires_at: string;
  operation_count: number;
  payload_hash: string;
  redaction_profile: string;
  audit_parent_hash: string;
  operations: MetadataChangeSetOperationFixture[];
}

export type MetadataChangeSetValidationReason =
  | "valid"
  | "invalid_schema_version"
  | "missing_change_set_id"
  | "missing_source_node_id"
  | "missing_target_node_id"
  | "missing_link_id"
  | "missing_policy_id"
  | "missing_checkpoint_base_hash"
  | "missing_checkpoint_result_hash"
  | "checkpoint_hash_unchanged"
  | "missing_envelope_hash"
  | "missing_payload_hash"
  | "missing_audit_parent_hash"
  | "missing_redaction_profile"
  | "missing_created_at"
  | "missing_expires_at"
  | "invalid_timestamp"
  | "change_set_expired"
  | "invalid_expiry_order"
  | "missing_data_classes"
  | "forbidden_data_class"
  | "unsupported_data_class"
  | "unsupported_sync_mode"
  | "invalid_operation_count"
  | "operation_count_mismatch"
  | "invalid_operation"
  | "operation_data_class_mismatch"
  | "operation_not_redacted"
  | "duplicate_operation_id";

export interface MetadataChangeSetValidationResult {
  valid: boolean;
  reason_code: MetadataChangeSetValidationReason;
  redacted_reason: string;
  audit_event_type:
    | "metadata_change_set.accepted"
    | "metadata_change_set.rejected";
}

export interface MetadataChangeSetValidationOptions {
  now?: string;
  max_operations?: number;
}

const ALLOWED_DATA_CLASSES = new Set<string>(
  METADATA_CHANGE_SET_DATA_CLASSES
);

const ALLOWED_SYNC_MODES = new Set<string>(
  METADATA_CHANGE_SET_SYNC_MODES
);

const FORBIDDEN_DATA_CLASSES = new Set<string>(
  METADATA_CHANGE_SET_FORBIDDEN_DATA_CLASSES
);

const ALLOWED_OPERATION_TYPES = new Set<string>([
  "observe",
  "upsert_metadata",
  "remove_metadata"
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function reject(
  reasonCode: MetadataChangeSetValidationReason,
  redactedReason: string
): MetadataChangeSetValidationResult {
  return {
    valid: false,
    reason_code: reasonCode,
    redacted_reason: redactedReason,
    audit_event_type: "metadata_change_set.rejected"
  };
}

export function validateMetadataChangeSetFixture(
  changeSet: MetadataChangeSetFixture,
  options: MetadataChangeSetValidationOptions = {}
): MetadataChangeSetValidationResult {
  if (changeSet.schema_version !== 1) {
    return reject(
      "invalid_schema_version",
      "The metadata change-set schema version is unsupported."
    );
  }

  const requiredIdentityFields: Array<
    [
      keyof Pick<
        MetadataChangeSetFixture,
        | "change_set_id"
        | "source_node_id"
        | "target_node_id"
        | "link_id"
        | "policy_id"
      >,
      MetadataChangeSetValidationReason,
      string
    ]
  > = [
    [
      "change_set_id",
      "missing_change_set_id",
      "The change-set identifier is missing."
    ],
    [
      "source_node_id",
      "missing_source_node_id",
      "The source node identifier is missing."
    ],
    [
      "target_node_id",
      "missing_target_node_id",
      "The target node identifier is missing."
    ],
    [
      "link_id",
      "missing_link_id",
      "The link identifier is missing."
    ],
    [
      "policy_id",
      "missing_policy_id",
      "The policy identifier is missing."
    ]
  ];

  for (const [field, reason, detail] of requiredIdentityFields) {
    if (!nonEmpty(changeSet[field])) {
      return reject(reason, detail);
    }
  }

  if (!nonEmpty(changeSet.checkpoint_base_hash)) {
    return reject(
      "missing_checkpoint_base_hash",
      "The base checkpoint hash is missing."
    );
  }

  if (!nonEmpty(changeSet.checkpoint_result_hash)) {
    return reject(
      "missing_checkpoint_result_hash",
      "The result checkpoint hash is missing."
    );
  }

  if (
    changeSet.checkpoint_base_hash ===
    changeSet.checkpoint_result_hash
  ) {
    return reject(
      "checkpoint_hash_unchanged",
      "The result checkpoint must differ from the base checkpoint."
    );
  }

  if (!nonEmpty(changeSet.envelope_hash)) {
    return reject(
      "missing_envelope_hash",
      "The signed-envelope hash is missing."
    );
  }

  if (!nonEmpty(changeSet.payload_hash)) {
    return reject(
      "missing_payload_hash",
      "The metadata payload hash is missing."
    );
  }

  if (!nonEmpty(changeSet.audit_parent_hash)) {
    return reject(
      "missing_audit_parent_hash",
      "The audit parent hash is missing."
    );
  }

  if (!nonEmpty(changeSet.redaction_profile)) {
    return reject(
      "missing_redaction_profile",
      "The redaction profile is missing."
    );
  }

  if (!nonEmpty(changeSet.created_at)) {
    return reject(
      "missing_created_at",
      "The change-set creation timestamp is missing."
    );
  }

  if (!nonEmpty(changeSet.expires_at)) {
    return reject(
      "missing_expires_at",
      "The change-set expiry timestamp is missing."
    );
  }

  const createdAt = Date.parse(changeSet.created_at);
  const expiresAt = Date.parse(changeSet.expires_at);
  const now = Date.parse(options.now || new Date().toISOString());

  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now)
  ) {
    return reject(
      "invalid_timestamp",
      "The change-set contains an invalid timestamp."
    );
  }

  if (expiresAt <= createdAt) {
    return reject(
      "invalid_expiry_order",
      "The change-set expiry must follow its creation time."
    );
  }

  if (expiresAt <= now) {
    return reject(
      "change_set_expired",
      "The metadata change set has expired."
    );
  }

  if (
    !Array.isArray(changeSet.data_classes) ||
    changeSet.data_classes.length === 0
  ) {
    return reject(
      "missing_data_classes",
      "The change-set data-class list is missing."
    );
  }

  for (const dataClass of changeSet.data_classes) {
    if (FORBIDDEN_DATA_CLASSES.has(dataClass)) {
      return reject(
        "forbidden_data_class",
        "The change set requests a forbidden private data class."
      );
    }

    if (!ALLOWED_DATA_CLASSES.has(dataClass)) {
      return reject(
        "unsupported_data_class",
        "The change set requests an unsupported metadata class."
      );
    }
  }

  if (!ALLOWED_SYNC_MODES.has(changeSet.sync_mode)) {
    return reject(
      "unsupported_sync_mode",
      "The change-set sync mode is unsupported."
    );
  }

  const maxOperations = options.max_operations ?? 128;

  if (
    !Number.isInteger(changeSet.operation_count) ||
    changeSet.operation_count < 0 ||
    changeSet.operation_count > maxOperations
  ) {
    return reject(
      "invalid_operation_count",
      "The change-set operation count is outside allowed bounds."
    );
  }

  if (!Array.isArray(changeSet.operations)) {
    return reject(
      "invalid_operation",
      "The metadata operation list is invalid."
    );
  }

  if (changeSet.operation_count !== changeSet.operations.length) {
    return reject(
      "operation_count_mismatch",
      "The operation count does not match the operation list."
    );
  }

  const operationIds = new Set<string>();

  for (const operation of changeSet.operations) {
    if (
      !nonEmpty(operation.operation_id) ||
      !nonEmpty(operation.operation_timestamp) ||
      !nonEmpty(operation.operation_hash) ||
      !ALLOWED_OPERATION_TYPES.has(operation.operation_type)
    ) {
      return reject(
        "invalid_operation",
        "A metadata operation is malformed."
      );
    }

    if (operationIds.has(operation.operation_id)) {
      return reject(
        "duplicate_operation_id",
        "The change set contains a duplicate operation identifier."
      );
    }

    operationIds.add(operation.operation_id);

    if (
      !changeSet.data_classes.includes(operation.data_class) ||
      !ALLOWED_DATA_CLASSES.has(operation.data_class)
    ) {
      return reject(
        "operation_data_class_mismatch",
        "A metadata operation is outside the declared data classes."
      );
    }

    if (operation.redacted !== true) {
      return reject(
        "operation_not_redacted",
        "Every metadata operation must be explicitly redacted."
      );
    }

    const operationTimestamp = Date.parse(
      operation.operation_timestamp
    );

    if (
      !Number.isFinite(operationTimestamp) ||
      operationTimestamp < createdAt ||
      operationTimestamp > expiresAt
    ) {
      return reject(
        "invalid_operation",
        "A metadata operation timestamp is outside the change-set window."
      );
    }
  }

  return {
    valid: true,
    reason_code: "valid",
    redacted_reason:
      "The metadata change-set fixture satisfies the bounded communication-sync contract.",
    audit_event_type: "metadata_change_set.accepted"
  };
}
