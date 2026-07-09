import type { DesktopLinkedNodeStatus, ForgeLinkNodeLinkStatus } from "./types";

export const DESKTOP_LINKED_NODE_ACCEPTED_DATA_CLASSES = [
  "node_link_status",
  "capability_cache",
  "sync_checkpoint_metadata",
  "redacted_sync_health",
  "wipe_status"
] as const;

export const DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES = [
  "raw_private_data",
  "raw_messages",
  "contacts",
  "calls",
  "signal_content",
  "attachments",
  "credentials",
  "provider_secrets",
  "tokens"
] as const;

export function buildDesktopLinkedNodeStatus(
  linkedNodes: ForgeLinkNodeLinkStatus[] = [],
  options: {
    authority_node_id?: string;
    last_checked_at?: string | null;
    health_state?: DesktopLinkedNodeStatus["sync_health"]["state"];
  } = {}
): DesktopLinkedNodeStatus {
  const healthState = options.health_state || (linkedNodes.length > 0 ? "healthy" : "local_only");

  return {
    schema_version: 1,
    authority_node_id: options.authority_node_id || "desktop-authority-node",
    linked_nodes: linkedNodes,
    sync_health: {
      state: healthState,
      redacted: true,
      detail: "Desktop linked-node status stub exposes redacted metadata only and accepts no private change sets.",
      last_checked_at: options.last_checked_at ?? null,
      accepts_private_change_sets: false,
      private_data_sync_enabled: false,
      broad_background_sync_enabled: false,
      clustering_enabled: false
    },
    accepted_data_classes: [...DESKTOP_LINKED_NODE_ACCEPTED_DATA_CLASSES],
    forbidden_data_classes: [...DESKTOP_LINKED_NODE_FORBIDDEN_DATA_CLASSES],
    capability_claims: [
      "linked_nodes.list",
      "node.capabilities.read",
      "sync.health.redacted",
      "change_sets.private.reject"
    ],
    detail: "Desktop authority metadata stub. Android can query link status and redacted sync health without private data, credentials, provider secrets, broad background sync, or clustering."
  };
}

export function desktopLinkedNodeStatusAcceptsDataClass(dataClass: string): boolean {
  return DESKTOP_LINKED_NODE_ACCEPTED_DATA_CLASSES.includes(dataClass as never);
}
