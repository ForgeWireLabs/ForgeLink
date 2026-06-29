import type { AndroidOperatorStatus } from "./types";

// Android/Fabric operator-status consumer (work item 030, decision 0017).
//
// The payload comes from the Moto One Hyper ROM lab read-only bridge. ForgeLink
// treats it as UNTRUSTED, ADVISORY, DISPLAY-ONLY device status: it is rendered for
// the operator and never used to grant authority, change policy, or trigger an
// action. There is no live transport yet; the panel renders a status object that is
// either provided by a future transport or loaded as the clearly-labeled sample
// below. `ok: false` (or a malformed payload) is shown as a degraded status, never
// a crash.

// Captured live emulator payload (bridge rom_lab.forgelink_operator_status.v1,
// 2026-06-29). Used by tests and as the labeled "sample status" in the panel.
export const SAMPLE_OPERATOR_STATUS: AndroidOperatorStatus = {
  ok: true,
  target: "emulator-only",
  authority: "readonly-emulator-inspection",
  mode: "operator-status",
  request_id: "manual-op-001",
  generated_at: "2026-06-29T18:29:13.660043Z",
  bridge_version: "rom_lab.forgelink_operator_status.v1",
  device: {
    android_release: "15",
    sdk: "35",
    model: "Android SDK built for x86_64",
    hardware: "ranchu",
    fingerprint: "Android/sdk_phone64_x86_64/emu64x:15/AE3A.240806.019/12368160:userdebug/test-keys"
  },
  boot: { completed: true },
  network: { summary: "network-read: 52 sanitized line(s)" },
  storage: { summary: "storage-read: 52 sanitized line(s)" },
  activity: {
    current_user: "0",
    top_activity: "ACTIVITY com.android.launcher3/.uioverrides.QuickstepLauncher 7b3f70c pid=1156 userId=0 uid=10121 displayId=0(type=INTERNAL)"
  },
  packages: { summary: "packages: 40 visible package line(s)", count: 40 }
};

export type OperatorStatusHealth = "online" | "degraded";

export interface NormalizedOperatorStatus {
  health: OperatorStatusHealth;
  status: AndroidOperatorStatus;
}

// Display-only neutralization: drop control characters and zero-width/bidi-override
// characters that could spoof the rendered status, collapse whitespace, and clamp
// length. React already escapes text, so this is presentation integrity, not XSS.
function clean(value: unknown, max = 200): string {
  let text = String(value ?? "");
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001F\u007F]/g, " ");
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

// Parse/validate an unknown payload into a typed status with a health verdict.
// Anything that is not an explicit ok:true operator-status payload is degraded.
export function parseOperatorStatus(raw: unknown): NormalizedOperatorStatus {
  const record = (raw && typeof raw === "object" ? raw : {}) as Partial<AndroidOperatorStatus>;
  const ok = record.ok === true;
  const status: AndroidOperatorStatus = {
    ok,
    target: record.target ? clean(record.target, 40) : undefined,
    authority: record.authority ? clean(record.authority, 60) : undefined,
    mode: "operator-status",
    request_id: clean(record.request_id, 120),
    generated_at: record.generated_at ? clean(record.generated_at, 60) : undefined,
    bridge_version: record.bridge_version ? clean(record.bridge_version, 80) : undefined,
    device: record.device ? {
      android_release: clean(record.device.android_release, 40),
      sdk: clean(record.device.sdk, 40),
      model: clean(record.device.model, 80),
      hardware: clean(record.device.hardware, 40),
      fingerprint: clean(record.device.fingerprint, 200)
    } : undefined,
    boot: record.boot ? { completed: record.boot.completed === true } : undefined,
    network: record.network ? { summary: clean(record.network.summary, 120) } : undefined,
    storage: record.storage ? { summary: clean(record.storage.summary, 120) } : undefined,
    activity: record.activity ? {
      current_user: clean(record.activity.current_user, 40),
      top_activity: clean(record.activity.top_activity, 200)
    } : undefined,
    packages: record.packages ? { summary: clean(record.packages.summary, 120), count: Number(record.packages.count) || 0 } : undefined,
    error: record.error ? clean(record.error, 200) : undefined
  };
  // Online requires ok:true plus at least the core device signal; otherwise the
  // bridge is reachable but incomplete, which we treat as degraded.
  const health: OperatorStatusHealth = ok && Boolean(status.device) ? "online" : "degraded";
  return { health, status };
}

// Best-effort short label for the current foreground activity (the trailing
// component name) so the panel does not show the full raw dump.
export function topActivityLabel(topActivity?: string): string {
  if (!topActivity) return "unknown";
  const match = topActivity.match(/([A-Za-z0-9_.]+)\/([A-Za-z0-9_.]+)/);
  if (!match) return clean(topActivity, 60);
  const component = match[2].startsWith(".") ? match[2].slice(1) : match[2];
  return component.split(".").pop() || clean(topActivity, 60);
}
