export type CheckpointReplayLinkState =
  | "linked"
  | "degraded"
  | "stale"
  | "lost"
  | "revoked"
  | "wipe_pending"
  | "wiped";

export interface CheckpointReplayGuardInput {
  checkpoint_id: string;
  previous_checkpoint_hash: string | null;
  proposed_base_checkpoint_hash: string;
  current_checkpoint_hash: string;
  result_checkpoint_hash: string;
  link_id: string;
  policy_id: string;
  source_node_id: string;
  target_node_id: string;
  operation: string;
  nonce: string;
  link_state: CheckpointReplayLinkState;
  previous_checkpoint_required: boolean;
}

export interface CheckpointReplayGuardOptions {
  seen_replay_keys?: ReadonlySet<string>;
}

export type CheckpointReplayGuardReason =
  | "accepted"
  | "missing_checkpoint_id"
  | "missing_link_id"
  | "missing_policy_id"
  | "missing_source_node_id"
  | "missing_target_node_id"
  | "missing_operation"
  | "missing_nonce"
  | "duplicate_nonce_tuple"
  | "missing_previous_checkpoint"
  | "missing_base_checkpoint"
  | "missing_current_checkpoint"
  | "missing_result_checkpoint"
  | "stale_checkpoint"
  | "checkpoint_result_unchanged"
  | "link_degraded"
  | "link_stale"
  | "link_lost"
  | "link_revoked";

export interface CheckpointReplayGuardResult {
  accepted: boolean;
  reason_code: CheckpointReplayGuardReason;
  redacted_reason: string;
  replay_key: string | null;
  audit_event_type:
    | "checkpoint_replay_guard.accepted"
    | "checkpoint_replay_guard.rejected";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function reject(
  reasonCode: CheckpointReplayGuardReason,
  redactedReason: string,
  replayKey: string | null = null
): CheckpointReplayGuardResult {
  return {
    accepted: false,
    reason_code: reasonCode,
    redacted_reason: redactedReason,
    replay_key: replayKey,
    audit_event_type: "checkpoint_replay_guard.rejected"
  };
}

export function buildCheckpointReplayKey(
  input: Pick<
    CheckpointReplayGuardInput,
    | "source_node_id"
    | "target_node_id"
    | "link_id"
    | "operation"
    | "nonce"
  >
): string {
  return [
    input.source_node_id,
    input.target_node_id,
    input.link_id,
    input.operation,
    input.nonce
  ].join(":");
}

export function evaluateCheckpointReplayGuard(
  input: CheckpointReplayGuardInput,
  options: CheckpointReplayGuardOptions = {}
): CheckpointReplayGuardResult {
  if (!nonEmpty(input.checkpoint_id)) {
    return reject(
      "missing_checkpoint_id",
      "The checkpoint identifier is missing."
    );
  }

  if (!nonEmpty(input.link_id)) {
    return reject(
      "missing_link_id",
      "The link identifier is missing."
    );
  }

  if (!nonEmpty(input.policy_id)) {
    return reject(
      "missing_policy_id",
      "The policy identifier is missing."
    );
  }

  if (!nonEmpty(input.source_node_id)) {
    return reject(
      "missing_source_node_id",
      "The source node identifier is missing."
    );
  }

  if (!nonEmpty(input.target_node_id)) {
    return reject(
      "missing_target_node_id",
      "The target node identifier is missing."
    );
  }

  if (!nonEmpty(input.operation)) {
    return reject(
      "missing_operation",
      "The guarded operation is missing."
    );
  }

  if (!nonEmpty(input.nonce)) {
    return reject(
      "missing_nonce",
      "The replay-protection nonce is missing."
    );
  }

  const replayKey = buildCheckpointReplayKey(input);

  if (options.seen_replay_keys?.has(replayKey)) {
    return reject(
      "duplicate_nonce_tuple",
      "The replay tuple has already been observed.",
      replayKey
    );
  }

  if (input.link_state === "degraded") {
    return reject(
      "link_degraded",
      "The linked node is degraded and checkpoint application is paused.",
      replayKey
    );
  }

  if (input.link_state === "stale") {
    return reject(
      "link_stale",
      "The linked node is stale and checkpoint application is paused.",
      replayKey
    );
  }

  if (input.link_state === "lost") {
    return reject(
      "link_lost",
      "The linked node is lost and checkpoint application is paused.",
      replayKey
    );
  }

  if (
    input.link_state === "revoked" ||
    input.link_state === "wipe_pending" ||
    input.link_state === "wiped"
  ) {
    return reject(
      "link_revoked",
      "The linked relationship is revoked or unavailable.",
      replayKey
    );
  }

  if (
    input.previous_checkpoint_required &&
    !nonEmpty(input.previous_checkpoint_hash)
  ) {
    return reject(
      "missing_previous_checkpoint",
      "Required checkpoint lineage is missing.",
      replayKey
    );
  }

  if (!nonEmpty(input.proposed_base_checkpoint_hash)) {
    return reject(
      "missing_base_checkpoint",
      "The proposed base checkpoint hash is missing.",
      replayKey
    );
  }

  if (!nonEmpty(input.current_checkpoint_hash)) {
    return reject(
      "missing_current_checkpoint",
      "The current checkpoint hash is missing.",
      replayKey
    );
  }

  if (!nonEmpty(input.result_checkpoint_hash)) {
    return reject(
      "missing_result_checkpoint",
      "The proposed result checkpoint hash is missing.",
      replayKey
    );
  }

  if (
    input.proposed_base_checkpoint_hash !==
    input.current_checkpoint_hash
  ) {
    return reject(
      "stale_checkpoint",
      "The proposed change set is based on a stale checkpoint.",
      replayKey
    );
  }

  if (
    input.result_checkpoint_hash ===
    input.current_checkpoint_hash
  ) {
    return reject(
      "checkpoint_result_unchanged",
      "The proposed result checkpoint does not advance state.",
      replayKey
    );
  }

  return {
    accepted: true,
    reason_code: "accepted",
    redacted_reason:
      "Checkpoint lineage and replay protections accept the metadata fixture.",
    replay_key: replayKey,
    audit_event_type: "checkpoint_replay_guard.accepted"
  };
}
