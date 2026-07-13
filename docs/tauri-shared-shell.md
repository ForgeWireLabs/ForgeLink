# Tauri Shared Shell Architecture

ForgeLink's target shell is Tauri 2 for both desktop and mobile. The product UI
is one shared React/Web cockpit; Electron remains a compatibility shell until the
Tauri parity gate is satisfied.

## Target Shape

- **Renderer:** one shared React/Web cockpit for Decisions, People, Agents,
  Channels, Settings, and mobile layouts.
- **Desktop shell:** Tauri 2 with Rust-native shell logic for process lifecycle,
  OS notifications, secure storage access, deep-link/update hooks, diagnostics,
  and packaged distribution.
- **Mobile shell:** Tauri 2 for Android/iOS running the shared cockpit in a
  responsive mobile layout. Mobile is a full cockpit where platform limits allow
  it; the redacted decision terminal is a restricted mode/profile, not the whole
  product.
- **Data authority:** at this stage the desktop/local backend remains the source
  of truth for private local data. Mobile is an authenticated client of the
  operator's local connection and must not replicate the private database.
- **Platform plugins:** Swift/Kotlin plugins are allowed only where Tauri's
  standard APIs do not cover mobile notifications, secure storage, deep links,
  pairing, or platform-specific health signals.
- **Distribution:** unsigned/dev Tauri builds are acceptable for scaffolding and
  validation. Signed public distribution waits on the operator-provided
  certificate per decision 0018.

## Bridge Boundary

Renderer code must depend on the ForgeLink shell bridge, not directly on
Electron or Tauri APIs. The current Electron preload exposes `forgeLinkShell`;
`desktop` remains only as a compatibility alias. The Tauri scaffold exposes the
same TypeScript bridge shape through Tauri's `window.__TAURI__.core.invoke`.

Current bridge capability groups are declared in
`Electron/renderer/src/shell.ts` as `SHELL_BRIDGE_CAPABILITIES`:

- local service lifecycle and authenticated backend connection;
- notifications and attention-policy-aware notification decisions;
- external navigation/deep-link entry points;
- secure settings and provider credential actions;
- local attention policy;
- MCP and agent-channel credential actions.

The bridge deliberately excludes raw filesystem, raw process, raw device shell,
and private database access. Product data flows through the authenticated local
API and scoped resources; shell capabilities provide OS integration only.

## Tauri Scaffold

The initial Tauri 2 scaffold lives under `Tauri/`:

- `Tauri/src-tauri/tauri.conf.json` uses the existing `Electron/renderer` build
  output as `frontendDist`.
- `Tauri/src-tauri/src/main.rs` registers ForgeLink shell-bridge commands for
  startup, authenticated backend discovery, notifications, settings,
  attention-policy, MCP, agent-channel, email, and push capability groups.
- `Tauri/src-tauri/capabilities/mobile-cockpit.json` records the mobile cockpit
  profile: shared cockpit enabled, `mobile_lock_screen` restricted decision
  terminal profile, paired-device signed decisions, device revoke, and no private
  database replication.
- `Electron/tauri-scaffold.test.js` guards that Electron remains available until
  the retirement gate is satisfied.

The scaffold responses are local-only/degraded until the Tauri shell owns the
full backend lifecycle. A real local API connection can be pointed at
`FORGELINK_LOCAL_API_URL` and `FORGELINK_LOCAL_API_TOKEN`.

Desktop linked-node private keys are stored as authenticated encrypted blobs in the
operator-owned local vault. `FORGELINK_IDENTITY_VAULT_DIR` selects the exact vault;
`FORGELINK_LOCAL_ROOT/keys/linked-node-identities` is the secondary resolution path.
The Windows development fallback is
`C:\Projects\ForgeLink-local\keys\linked-node-identities`. The native OS
credential manager stores only the vault-wrapping key. Public APIs and the renderer
receive public key metadata and opaque `secure_key_ref` values, never private bytes.

The authenticated local backend exposes a launch-only lifecycle surface at
`/api/linked-node-identities`: create, readiness, rotation, revocation, and
replacement-based recovery. These routes preserve forbidden private-material fields
until the database validator rejects them, so private bytes cannot be silently ignored
or persisted. The older `/api/device-keys` AGH-025 routes remain a separate legacy
decision-attribution surface and do not weaken the linked-node lifecycle contract.

The Tauri shell exposes only orchestrated linked-node identity creation, rotation,
and replacement-recovery commands. It provisions a generation-scoped key in the
encrypted local vault, then commits the corresponding public metadata through the
loopback launch-authenticated backend. Recovery first verifies that the old identity is
revoked and still awaiting replacement, provisions generation 1 under a different ID,
and verifies both the replacement metadata and the revoked record's forward link. An
explicit backend rejection during recovery deletes the newly provisioned replacement
key before returning failure. An unavailable or invalid response preserves that key
because the database may already be committed and requires reconciliation instead of
destructive rollback. A successful-but-mismatched backend response follows the same
fail-closed preservation rule. Recovery never resurrects the revoked ID or automatically
deletes its historical key. After a committed rotation, deletion of the retired
generation is reported separately through `retired_secret_deleted` and
`cleanup_required`; the active database record always points at the new generation.
The former low-level provision and delete commands are no longer exposed to renderer
invocation.

## Mobile Decisions

Mobile decision actions use the same governed approval records, device-key
trust, redaction profiles, and audit chain as the desktop cockpit. The mobile
surface may present redacted approval cards, approve/deny/defer/request-more-info
actions, short replies, presence, emergency contact state, and device revocation.
The decision terminal profile must not expose full private evidence or replicate
the local database.

## Retirement Gate

Electron cannot be removed until Tauri covers:

- onboarding and local-only startup;
- local service lifecycle and authenticated API discovery;
- credential storage and import/remove flows;
- notifications and attention policy;
- deep links and external navigation;
- update/distribution hooks;
- diagnostics and support report behavior;
- data safety, backup, export, retention, and recovery workflows;
- Decisions, People, Agents, Channels, Settings, and mobile cockpit workflows.

The explicit gate checklist is recorded in
[`docs/electron-retirement-gate.md`](electron-retirement-gate.md).

## Validation And Rollback

TAURI-001/002 are architecture and bridge-boundary closure. TAURI-003/004/005 add
the first Tauri desktop/mobile scaffold and Electron-retirement guardrails. They
do not yet claim signed public distribution, Android/iOS emulator/device smoke,
or Electron removal; those belong to TAURI-006/007 and later parity evidence.

Rollback for the scaffold is straightforward: keep Electron as the supported
shell, remove or ignore `Tauri/`, and restore the previous work item state. No
database schema, provider credential, or private data migration is introduced.
