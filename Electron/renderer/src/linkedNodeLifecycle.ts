import type { ForgeLinkNodeLinkStatus } from "./types";

export type LinkedNodeLifecycleState =
  | "local_only"
  | "linked"
  | "degraded"
  | "stale"
  | "lost"
  | "revoked"
  | "wipe_pending"
  | "wiped";

export interface RedactedLinkedNodeLifecycleStatus {
  schema_version: 1;
  node_id: string;
  platform: ForgeLinkNodeLinkStatus["platform"];
  device_label: string;
  link_id: string | null;
  link_state: ForgeLinkNodeLinkStatus["link_state"];
  trust_state: ForgeLinkNodeLinkStatus["trust_state"];
  lifecycle_state: LinkedNodeLifecycleState;
  sync_mode: ForgeLinkNodeLinkStatus["sync_mode"];
  redacted_health_label: string;
  redacted_health_detail: string;
  private_data_locked: boolean;
  linked_operations_paused: boolean;
  recovery_action_hint: string;
  last_seen_at: string | null;
  stale_after: string | null;
  revoked_at: string | null;
  wipe_request_id: string | null;
  wipe_ack_id: string | null;
  audit_event_id: string | null;
}

export const LINKED_NODE_LIFECYCLE_PRIVATE_DATA_LOCKED_STATES: LinkedNodeLifecycleState[] = [
  "degraded",
  "stale",
  "lost",
  "revoked",
  "wipe_pending",
  "wiped"
];

export function linkedNodeLifecycleLocksPrivateData(lifecycleState: LinkedNodeLifecycleState): boolean {
  return LINKED_NODE_LIFECYCLE_PRIVATE_DATA_LOCKED_STATES.includes(lifecycleState);
}

export function linkedNodeLifecyclePausesLinkedOperations(lifecycleState: LinkedNodeLifecycleState): boolean {
  return ["stale", "lost", "revoked", "wipe_pending", "wiped"].includes(lifecycleState);
}

function defaultHealthLabel(lifecycleState: LinkedNodeLifecycleState): string {
  switch (lifecycleState) {
    case "local_only":
      return "Local only";
    case "linked":
      return "Linked";
    case "degraded":
      return "Degraded";
    case "stale":
      return "Stale";
    case "lost":
      return "Lost";
    case "revoked":
      return "Revoked";
    case "wipe_pending":
      return "Wipe pending";
    case "wiped":
      return "Wiped";
  }
}

function defaultHealthDetail(lifecycleState: LinkedNodeLifecycleState): string {
  switch (lifecycleState) {
    case "local_only":
      return "This node is operating locally with no linked peer. Private data sync is disabled.";
    case "linked":
      return "This node has a linked metadata relationship. Private data remains policy-gated.";
    case "degraded":
      return "This link is degraded. Linked operations are limited and private data is locked.";
    case "stale":
      return "This link is stale. Linked operations are paused until the peer revalidates.";
    case "lost":
      return "This linked node is unreachable. Local-only operation remains available.";
    case "revoked":
      return "This link was revoked. Relink requires explicit operator approval.";
    case "wipe_pending":
      return "A wipe request is pending acknowledgement for this link scope.";
    case "wiped":
      return "A wipe acknowledgement was recorded for this link scope.";
  }
}

function defaultRecoveryHint(lifecycleState: LinkedNodeLifecycleState): string {
  switch (lifecycleState) {
    case "local_only":
      return "Pair or link only when operator policy allows it.";
    case "linked":
      return "Continue metadata-only operation unless policy changes.";
    case "degraded":
      return "Review redacted health and revalidate before resuming linked operations.";
    case "stale":
      return "Revalidate the peer before linked operations resume.";
    case "lost":
      return "Wait for the peer to return or revoke the link.";
    case "revoked":
      return "Create a new operator-approved link to resume linked operations.";
    case "wipe_pending":
      return "Wait for wipe acknowledgement or review the pending request.";
    case "wiped":
      return "Keep the link disabled unless a new operator-approved link is created.";
  }
}

function lifecycleStateFromNodeLinkStatus(nodeLinkStatus: ForgeLinkNodeLinkStatus): LinkedNodeLifecycleState {
  switch (nodeLinkStatus.link_state) {
    case "linked":
      return "linked";
    case "degraded":
      return "degraded";
    case "stale":
      return "stale";
    case "revoked":
      return "revoked";
    case "local_only":
    case "link_requested":
      return "local_only";
  }
}

export function buildRedactedLinkedNodeLifecycleStatus(
  nodeLinkStatus: ForgeLinkNodeLinkStatus,
  options: {
    lifecycle_state?: LinkedNodeLifecycleState;
    link_id?: string | null;
    redacted_health_label?: string;
    redacted_health_detail?: string;
    recovery_action_hint?: string;
    wipe_request_id?: string | null;
    wipe_ack_id?: string | null;
    audit_event_id?: string | null;
  } = {}
): RedactedLinkedNodeLifecycleStatus {
  const lifecycleState: LinkedNodeLifecycleState = options.lifecycle_state || lifecycleStateFromNodeLinkStatus(nodeLinkStatus);
  const privateDataLocked = linkedNodeLifecycleLocksPrivateData(lifecycleState);
  const linkedOperationsPaused = linkedNodeLifecyclePausesLinkedOperations(lifecycleState);

  return {
    schema_version: 1,
    node_id: nodeLinkStatus.node_id,
    platform: nodeLinkStatus.platform,
    device_label: nodeLinkStatus.device_label,
    link_id: options.link_id ?? null,
    link_state: nodeLinkStatus.link_state,
    trust_state: nodeLinkStatus.trust_state,
    lifecycle_state: lifecycleState,
    sync_mode: nodeLinkStatus.sync_mode,
    redacted_health_label: options.redacted_health_label || defaultHealthLabel(lifecycleState),
    redacted_health_detail: options.redacted_health_detail || defaultHealthDetail(lifecycleState),
    private_data_locked: privateDataLocked,
    linked_operations_paused: linkedOperationsPaused,
    recovery_action_hint: options.recovery_action_hint || defaultRecoveryHint(lifecycleState),
    last_seen_at: nodeLinkStatus.last_seen_at ?? null,
    stale_after: nodeLinkStatus.stale_after ?? null,
    revoked_at: nodeLinkStatus.revoked_at ?? null,
    wipe_request_id: options.wipe_request_id ?? null,
    wipe_ack_id: options.wipe_ack_id ?? null,
    audit_event_id: options.audit_event_id ?? null
  };
}
