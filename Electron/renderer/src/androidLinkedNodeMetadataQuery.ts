import type {
  DesktopLinkedNodeStatus,
  ForgeLinkNodeLinkStatus
} from "./types";
import type {
  AndroidLocalCommsStoreSnapshot
} from "./androidLocalCommsStore";
import {
  buildRedactedLinkedNodeLifecycleStatus,
  type LinkedNodeLifecycleState
} from "./linkedNodeLifecycle";

export interface AndroidLinkedNodeMetadataQueryResult {
  schema_version: 1;
  local_android_node_id: string;
  authority_node_id: string | null;
  link_id: string | null;
  link_state: ForgeLinkNodeLinkStatus["link_state"];
  trust_state: ForgeLinkNodeLinkStatus["trust_state"];
  lifecycle_state: LinkedNodeLifecycleState;
  capability_claims: string[];
  sync_mode: ForgeLinkNodeLinkStatus["sync_mode"];
  redacted_sync_health: {
    state:
      | "local_only"
      | "healthy"
      | "degraded"
      | "revoked"
      | "stale";
    redacted: true;
    detail: string;
    last_checked_at: string | null;
  };
  private_data_locked: boolean;
  private_change_sets_accepted: false;
  recovery_hint: string;
  last_seen_at: string | null;
  stale_after: string | null;
  revoked_at: string | null;
}

export interface AndroidLinkedNodeMetadataQueryInput {
  local_store: AndroidLocalCommsStoreSnapshot;
  desktop_status?: DesktopLinkedNodeStatus | null;
  lifecycle_state?: LinkedNodeLifecycleState;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.trim().length > 0))];
}

function lifecycleFromLinkState(
  linkState: ForgeLinkNodeLinkStatus["link_state"]
): LinkedNodeLifecycleState {
  switch (linkState) {
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

function buildLocalFallbackStatus(
  store: AndroidLocalCommsStoreSnapshot
): ForgeLinkNodeLinkStatus {
  return {
    schema_version: 1,
    node_id: store.node_id,
    platform: "android",
    device_label: "Android ForgeLink node",
    link_state: store.link_metadata.link_state,
    trust_state: store.link_metadata.trust_state,
    sync_mode: store.link_metadata.sync_mode,
    capability_claims: [...store.capability_cache],
    authority_node_id:
      store.link_metadata.authority_node_id,
    linked_at: null,
    last_seen_at: store.link_metadata.last_seen_at,
    revoked_at: null,
    stale_after: store.link_metadata.stale_after,
    detail:
      "Android-local metadata status; private communication data remains disabled."
  };
}

export function queryAndroidLinkedNodeMetadata(
  input: AndroidLinkedNodeMetadataQueryInput
): AndroidLinkedNodeMetadataQueryResult {
  const store = input.local_store;
  const desktop = input.desktop_status ?? null;

  if (store.platform !== "android") {
    throw new Error(
      "Android linked-node metadata query requires an Android-local store."
    );
  }

  if (store.private_data_enabled !== false) {
    throw new Error(
      "Android linked-node metadata query cannot enable private data."
    );
  }

  if (store.desktop_db_copy_enabled !== false) {
    throw new Error(
      "Android linked-node metadata query cannot enable desktop DB copying."
    );
  }

  if (
    desktop &&
    (
      desktop.sync_health.accepts_private_change_sets !== false ||
      desktop.sync_health.private_data_sync_enabled !== false ||
      desktop.sync_health.broad_background_sync_enabled !== false ||
      desktop.sync_health.clustering_enabled !== false
    )
  ) {
    throw new Error(
      "Desktop linked-node status violates the metadata-only query boundary."
    );
  }

  const linkedNode =
    desktop?.linked_nodes.find(
      node => node.node_id === store.node_id
    ) ?? buildLocalFallbackStatus(store);

  const lifecycleState =
    input.lifecycle_state ??
    lifecycleFromLinkState(linkedNode.link_state);

  const lifecycle =
    buildRedactedLinkedNodeLifecycleStatus(
      linkedNode,
      {
        lifecycle_state: lifecycleState,
        link_id: store.link_metadata.link_id
      }
    );

  const authorityNodeId =
    desktop?.authority_node_id ||
    store.link_metadata.authority_node_id ||
    linkedNode.authority_node_id ||
    null;

  const capabilityClaims = unique([
    ...store.capability_cache,
    ...(desktop?.capability_claims ?? []),
    ...linkedNode.capability_claims
  ]);

  const healthState =
    desktop?.sync_health.state ??
    (
      lifecycleState === "linked"
        ? "healthy"
        : lifecycleState === "degraded"
          ? "degraded"
          : lifecycleState === "stale"
            ? "stale"
            : lifecycleState === "revoked" ||
                lifecycleState === "wipe_pending" ||
                lifecycleState === "wiped"
              ? "revoked"
              : "local_only"
    );

  return {
    schema_version: 1,
    local_android_node_id: store.node_id,
    authority_node_id: authorityNodeId,
    link_id: store.link_metadata.link_id,
    link_state: linkedNode.link_state,
    trust_state: linkedNode.trust_state,
    lifecycle_state: lifecycle.lifecycle_state,
    capability_claims: capabilityClaims,
    sync_mode: linkedNode.sync_mode,
    redacted_sync_health: {
      state: healthState,
      redacted: true,
      detail:
        desktop?.sync_health.detail ??
        lifecycle.redacted_health_detail,
      last_checked_at:
        desktop?.sync_health.last_checked_at ?? null
    },
    private_data_locked:
      lifecycle.private_data_locked,
    private_change_sets_accepted: false,
    recovery_hint:
      lifecycle.recovery_action_hint,
    last_seen_at: lifecycle.last_seen_at,
    stale_after: lifecycle.stale_after,
    revoked_at: lifecycle.revoked_at
  };
}
