import type {
  ForgeLinkNodeLinkState,
  ForgeLinkNodePlatform,
  ForgeLinkNodeSyncMode,
  ForgeLinkNodeTrustState
} from "./types";

export interface CrossPlatformNodeMetadataInput {
  node_id: string;
  platform: string;
  device_label: string;
  link_state: ForgeLinkNodeLinkState;
  trust_state: ForgeLinkNodeTrustState;
  sync_mode: ForgeLinkNodeSyncMode;
  capability_claims: string[];
  health_state:
    | "local_only"
    | "healthy"
    | "degraded"
    | "stale"
    | "revoked";
  health_detail: string;
}

export interface CrossPlatformNodeMetadataContract {
  schema_version: 1;
  node_id: string;
  platform: ForgeLinkNodePlatform;
  device_label: string;
  link_state: ForgeLinkNodeLinkState;
  trust_state: ForgeLinkNodeTrustState;
  sync_mode: ForgeLinkNodeSyncMode;
  capability_claims: string[];
  redacted_health: {
    state:
      | "local_only"
      | "healthy"
      | "degraded"
      | "stale"
      | "revoked";
    redacted: true;
    detail: string;
  };
  private_data_enabled: false;
  private_change_sets_accepted: false;
  credentials_available: false;
  provider_secrets_available: false;
  token_values_available: false;
  private_keys_available: false;
  clustering_enabled: false;
  degraded_safely: boolean;
}

export type CrossPlatformNodeMetadataReason =
  | "valid"
  | "missing_node_id"
  | "missing_device_label"
  | "invalid_capability_claim"
  | "unsupported_private_sync_mode";

export interface CrossPlatformNodeMetadataResult {
  valid: boolean;
  reason_code: CrossPlatformNodeMetadataReason;
  contract: CrossPlatformNodeMetadataContract | null;
}

const SUPPORTED_PLATFORMS = new Set<string>([
  "windows",
  "linux",
  "macos",
  "android"
]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(
  reasonCode: CrossPlatformNodeMetadataReason
): CrossPlatformNodeMetadataResult {
  return {
    valid: false,
    reason_code: reasonCode,
    contract: null
  };
}

export function buildCrossPlatformNodeMetadataContract(
  input: CrossPlatformNodeMetadataInput
): CrossPlatformNodeMetadataResult {
  if (!nonEmpty(input.node_id)) {
    return failure("missing_node_id");
  }

  if (!nonEmpty(input.device_label)) {
    return failure("missing_device_label");
  }

  if (
    !Array.isArray(input.capability_claims) ||
    input.capability_claims.some(
      claim => !nonEmpty(claim)
    )
  ) {
    return failure("invalid_capability_claim");
  }

  if (
    ![
      "none",
      "metadata_only",
      "redacted",
      "private_data_disabled",
      "private_data_policy_pending"
    ].includes(input.sync_mode)
  ) {
    return failure("unsupported_private_sync_mode");
  }

  const platform: ForgeLinkNodePlatform =
    SUPPORTED_PLATFORMS.has(input.platform)
      ? input.platform as ForgeLinkNodePlatform
      : "unknown";

  const degradedSafely = platform === "unknown";

  return {
    valid: true,
    reason_code: "valid",
    contract: {
      schema_version: 1,
      node_id: input.node_id,
      platform,
      device_label: input.device_label,
      link_state: degradedSafely
        ? "degraded"
        : input.link_state,
      trust_state: degradedSafely
        ? "limited"
        : input.trust_state,
      sync_mode: degradedSafely
        ? "private_data_disabled"
        : input.sync_mode,
      capability_claims: degradedSafely
        ? input.capability_claims.filter(
            claim =>
              claim === "node.capabilities.read" ||
              claim === "sync.health.redacted"
          )
        : [...new Set(input.capability_claims)],
      redacted_health: {
        state: degradedSafely
          ? "degraded"
          : input.health_state,
        redacted: true,
        detail: degradedSafely
          ? "Unknown platform metadata degraded safely. Private data and linked writes remain disabled."
          : input.health_detail
      },
      private_data_enabled: false,
      private_change_sets_accepted: false,
      credentials_available: false,
      provider_secrets_available: false,
      token_values_available: false,
      private_keys_available: false,
      clustering_enabled: false,
      degraded_safely: degradedSafely
    }
  };
}
