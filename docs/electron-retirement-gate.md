# Electron Retirement Gate

Electron remains ForgeLink's compatibility shell until the Tauri 2 shell proves
parity with the current desktop workflows and release-critical OS integrations.

## Gate Checklist

Electron can be removed only after all of these are true and recorded in WI032
evidence. WI030 established the foundation and gate; it remains historical input
and does not authorize removal:

- Tauri desktop starts the shared cockpit from `Electron/renderer` without a
  separate product UI.
- The Tauri shell bridge covers local service lifecycle, authenticated local API
  discovery, notifications, external navigation, secure settings, attention
  policy, MCP credentials, agent channels, email settings, and push settings.
- Onboarding and local-only startup work from a clean profile.
- Credential import, save, remove, and provider-optional local mode preserve the
  protected-settings boundary. Electron safeStorage migration is an explicit
  manual re-entry path with legacy files preserved; automatic decryption is not
  assumed and silent credential loss is not allowed.
- Decisions, People, Agents, Channels, Settings, mobile cockpit, outbox, calls,
  signals, and data-safety workflows pass renderer parity tests.
- Data backup, export, restore-latest, retention, migration, and damaged-database
  recovery have explicit smoke evidence under Tauri.
- Deep links, notifications, diagnostics, and updater/distribution hooks have
  platform evidence for the supported desktop targets.
- Mobile Android/iOS builds run the shared cockpit as an authenticated local API
  client without replicating the private desktop database.
- The restricted mobile decision terminal preserves redaction, paired-device
  signed decisions, approve/deny/defer/request-more-info/short-reply actions,
  presence, emergency contact mode, and device revoke.
- Rollback is documented and leaves Electron packaging available until at least
  one signed/public Tauri distribution path is proven.

## Current Status

WI030 established the shared-shell architecture and retirement gate. WI032 now
owns the parity evidence and the later Electron-retirement implementation; WI030
remains historical foundation evidence.

The current WI032 slice has moved the Tauri desktop local-service path beyond the
old scaffold:

- `Tauri/src-tauri/src/local_service.rs` owns a real desktop backend child,
  authenticated readiness, safe port fallback, bounded crash recovery, explicit
  stop/shutdown, and truthful degraded status.
- `Tauri/src-tauri/tauri.conf.json` points at the shared renderer output in
  `Electron/renderer` and stages a self-contained backend runtime resource for
  packaged builds.
- `Tauri/src-tauri/capabilities/mobile-cockpit.json` records the mobile cockpit
  profile and blocks private database replication.
- `Electron/tauri-lifecycle.test.js` and the Tauri Rust tests guard the lifecycle
  boundary and confirm Electron remains present.

TPR-003 is now satisfied by the Tauri protected-settings slice:

- `Tauri/src-tauri/src/secure_store.rs` provides the shared AES-256-GCM encrypted
  record store with an OS-keyring wrapping key, opaque hashed references, random
  nonce/AAD binding, atomic writes, private directories, and zeroizing reads.
- `Tauri/src-tauri/src/protected_settings.rs` separates provider metadata from
  secret references for Twilio, Telnyx SMS, email, push, MCP, agent channels,
  local integrations, and linked-node lifecycle credentials.
- Tauri launches the backend with a cleared, allow-listed environment and only
  transient protected values; child output and status/debug surfaces are redacted.
  Shared renderer tests prove secret inputs clear after save and synthetic canaries
  do not remain in the rendered document.
- MCP, agent-channel, and local-integration token files are bounded 0600 desktop
  compatibility artifacts for external consumers. The encrypted vault is the
  source of truth; these files are not created on mobile or returned as secret
  contents through the bridge.

### Migration decision

The migration strategy is `manual_reentry`. Tauri detects likely legacy Electron
settings files and presents an explicit re-entry notice, but it does not attempt to
decrypt Electron `safeStorage` blobs with a different shell/keyring boundary. The
legacy files are preserved and never overwritten, so the operator can re-enter
credentials without silent loss. Automatic conversion remains a future, separately
reviewable migration slice if it is ever required.

TPR-001 and TPR-002 are tracked in
`work/active/032-tauri-production-parity-and-electron-retirement/README.md`, with
the exhaustive deletion checklist at
`work/active/032-tauri-production-parity-and-electron-retirement/local-artifacts/electron-tauri-parity-inventory.md`.
Native notifications/deep links/single-instance behavior, Tauri-specific
data-safety smoke, signed distribution, and packaged clean-machine validation
remain later criteria. This slice does not remove Electron or claim production
release readiness.

The Android emulator/operator-status evidence under WI030 remains historical and
does not prove a packaged mobile app or desktop-backend replication. Public signed
distribution and packaged clean-machine validation remain later WI032 work under
TPR-006 through TPR-008.
