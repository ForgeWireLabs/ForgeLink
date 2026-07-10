import type { ForgeLinkNodeLinkStatus } from "./types";

export type AndroidLocalCommsStoreKind = "local_sqlite" | "app_local_file_state";

export type AndroidLocalCommsStoreDataClass =
  | "schema_version"
  | "node_id"
  | "link_metadata"
  | "capability_cache"
  | "sync_checkpoint_metadata"
  | "redacted_status_rows";

export const ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES = [
  "raw_messages",
  "contacts",
  "calls",
  "signal_content",
  "attachments",
  "secrets",
  "tokens",
  "credentials",
  "provider_secrets"
] as const;

export interface AndroidLocalCommsStoreCheckpoint {
  checkpoint_id: string;
  link_id: string;
  policy_id: string;
  data_classes: AndroidLocalCommsStoreDataClass[];
  checkpoint_hash: string;
  previous_checkpoint_hash: string | null;
  created_at: string;
}

export interface AndroidLocalCommsStoreRedactedStatusRow {
  id: string;
  kind: "link" | "sync" | "wipe" | "stale" | "capability";
  label: string;
  detail: string;
  updated_at: string;
}

export interface AndroidLocalCommsStoreSnapshot {
  schema_version: 1;
  storage_kind: AndroidLocalCommsStoreKind;
  node_id: string;
  platform: "android";
  link_metadata: {
    link_id: string | null;
    link_state: ForgeLinkNodeLinkStatus["link_state"];
    trust_state: ForgeLinkNodeLinkStatus["trust_state"];
    sync_mode: ForgeLinkNodeLinkStatus["sync_mode"];
    authority_node_id: string | null;
    last_seen_at: string | null;
    stale_after: string | null;
  };
  capability_cache: string[];
  sync_checkpoints: AndroidLocalCommsStoreCheckpoint[];
  redacted_status_rows: AndroidLocalCommsStoreRedactedStatusRow[];
  forbidden_data_classes: typeof ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES;
  private_data_enabled: false;
  desktop_db_copy_enabled: false;
  detail: string;
}

export function buildAndroidLocalCommsStoreSnapshot(
  nodeLinkStatus: ForgeLinkNodeLinkStatus,
  options: {
    storage_kind?: AndroidLocalCommsStoreKind;
    link_id?: string | null;
    policy_id?: string;
    checkpoint_hash?: string;
    previous_checkpoint_hash?: string | null;
    now?: string;
  } = {}
): AndroidLocalCommsStoreSnapshot {
  const now = options.now || new Date(0).toISOString();
  const linkId = options.link_id ?? null;
  const policyId = options.policy_id || "policy.local.metadata-only";
  const checkpointHash = options.checkpoint_hash || "sha256:metadata-only-stub";
  const previousCheckpointHash = options.previous_checkpoint_hash ?? null;

  return {
    schema_version: 1,
    storage_kind: options.storage_kind || "app_local_file_state",
    node_id: nodeLinkStatus.node_id,
    platform: "android",
    link_metadata: {
      link_id: linkId,
      link_state: nodeLinkStatus.link_state,
      trust_state: nodeLinkStatus.trust_state,
      sync_mode: nodeLinkStatus.sync_mode,
      authority_node_id: nodeLinkStatus.authority_node_id ?? null,
      last_seen_at: nodeLinkStatus.last_seen_at ?? null,
      stale_after: nodeLinkStatus.stale_after ?? null
    },
    capability_cache: [...nodeLinkStatus.capability_claims],
    sync_checkpoints: [{
      checkpoint_id: "checkpoint.android.metadata.stub",
      link_id: linkId || "local-only",
      policy_id: policyId,
      data_classes: ["schema_version", "node_id", "link_metadata", "capability_cache", "sync_checkpoint_metadata", "redacted_status_rows"],
      checkpoint_hash: checkpointHash,
      previous_checkpoint_hash: previousCheckpointHash,
      created_at: now
    }],
    redacted_status_rows: [{
      id: "android-local-comms-store",
      kind: "sync",
      label: "Android local comms metadata store",
      detail: "Metadata-only Android-local store stub; no raw messages, contacts, calls, signal content, attachments, or secrets are stored.",
      updated_at: now
    }],
    forbidden_data_classes: ANDROID_LOCAL_COMMS_STORE_FORBIDDEN_DATA_CLASSES,
    private_data_enabled: false,
    desktop_db_copy_enabled: false,
    detail: "Android can own local ForgeLink metadata without desktop DB copying. Private communication data remains disabled pending explicit policy and implementation."
  };
}

export function androidLocalCommsStoreAllowsDataClass(dataClass: string): dataClass is AndroidLocalCommsStoreDataClass {
  return ["schema_version", "node_id", "link_metadata", "capability_cache", "sync_checkpoint_metadata", "redacted_status_rows"].includes(dataClass);
}


export interface AndroidLocalCommsStorePersistenceEnvelope {
  schema_version: 1;
  format: "forgelink.android.local_comms_store.v1";
  persisted_at: string;
  storage_kind: AndroidLocalCommsStoreKind;
  snapshot: AndroidLocalCommsStoreSnapshot;
  private_data_enabled: false;
  desktop_db_copy_enabled: false;
}

export function serializeAndroidLocalCommsStoreSnapshot(
  snapshot: AndroidLocalCommsStoreSnapshot,
  options: { persisted_at?: string } = {}
): string {
  const envelope: AndroidLocalCommsStorePersistenceEnvelope = {
    schema_version: 1,
    format: "forgelink.android.local_comms_store.v1",
    persisted_at: options.persisted_at || new Date(0).toISOString(),
    storage_kind: snapshot.storage_kind,
    snapshot,
    private_data_enabled: false,
    desktop_db_copy_enabled: false
  };

  return JSON.stringify(envelope, null, 2);
}

export function parseAndroidLocalCommsStoreSnapshot(serialized: string): AndroidLocalCommsStorePersistenceEnvelope {
  const parsed = JSON.parse(serialized) as AndroidLocalCommsStorePersistenceEnvelope;

  if (parsed.schema_version !== 1) throw new Error("Unsupported Android local comms store envelope schema.");
  if (parsed.format !== "forgelink.android.local_comms_store.v1") throw new Error("Unsupported Android local comms store format.");
  if (parsed.private_data_enabled !== false) throw new Error("Android local comms store cannot enable private data.");
  if (parsed.desktop_db_copy_enabled !== false) throw new Error("Android local comms store cannot enable desktop DB copy.");
  if (parsed.snapshot.platform !== "android") throw new Error("Android local comms store snapshot must target Android.");
  if (parsed.snapshot.private_data_enabled !== false) throw new Error("Android local comms store snapshot cannot enable private data.");
  if (parsed.snapshot.desktop_db_copy_enabled !== false) throw new Error("Android local comms store snapshot cannot enable desktop DB copy.");

  for (const checkpoint of parsed.snapshot.sync_checkpoints) {
    for (const dataClass of checkpoint.data_classes) {
      if (!androidLocalCommsStoreAllowsDataClass(dataClass)) {
        throw new Error(`Unsupported Android local comms store data class: ${dataClass}`);
      }
    }
  }

  return parsed;
}
