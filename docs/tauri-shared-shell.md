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
`desktop` remains only as a compatibility alias. Future Tauri shells implement
the same TypeScript bridge shape.

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

## Validation And Rollback

TAURI-001/002 are architecture and bridge-boundary closure only. They do not yet
claim a Tauri desktop build, Tauri mobile build, or emulator/device smoke result.
Those belong to TAURI-003/004/007.

Rollback for these criteria is straightforward: restore the previous work item
state and remove this architecture note or bridge capability manifest. No
database schema, provider credential, or runtime migration is introduced here.
