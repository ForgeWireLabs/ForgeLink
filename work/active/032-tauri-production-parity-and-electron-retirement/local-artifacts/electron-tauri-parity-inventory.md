# WI032 Electron/Tauri parity inventory

Verified 2026-09-13 against implementation commit `a33c8a3` (the README
checkpoint immediately before the WI032 implementation slice), with `origin/main`
at `6823a40` as the reconciled repository base. This is the deletion checklist
for TPR-009; `yes` in the final column means the capability still blocks Electron
retirement. Historical WI030 evidence is cited as foundation input, not as proof
of current parity.

## Inspection basis

The inventory was built from `Electron/preload.js`, `Electron/main.js`,
`Electron/lifecycle.js`, `Electron/onboarding.js`, `Electron/emailSettings.js`,
`Electron/pushSettings.js`, `Electron/smsProviderSettings.js`,
`Electron/telnyxFaxSettings.js`, `Electron/tunnel.js`, `Electron/updates.js`,
`Electron/builder.json`, `Electron/package.json`, `Electron/renderer/src/shell.ts`,
`Electron/renderer/src/api.ts`, the backend sources and tests under
`Electron/backend/src/`, and all Tauri sources/configuration under `Tauri/`.

State vocabulary: `parity` means the current Tauri path is exercised and has the
same contract; `partial` means a bounded replacement exists but important proof
or platform behavior remains; `scaffold` means the command/shape exists without
the Electron behavior; `missing` means no Tauri replacement was found;
`intentionally_replaced` means the product contract deliberately differs;
`not_applicable` means the Electron behavior has no Tauri equivalent in scope.

## Shell bridge and operator workflows

| Capability | Electron owner/path | Current Tauri owner/path | State | Replacement strategy | Test/evidence | Remaining gap | Criterion | Electron-removal blocker |
|---|---|---|---|---|---|---|---|---|
| Backend connection/discovery | `preload.js` → `backend-connection`; `main.js` token/base URL | `local_service.rs` `BackendConnection`; `lib.rs` `forgelink_backend_connection` | parity for TPR-002 | Return the manager’s loopback URL and launch token; keep token out of status | Rust serialization/redaction test; `tauri-lifecycle.test.js` | Full secure-token storage is TPR-003 | TPR-001/002/003 | yes |
| Status | `get-status` → `publicStatus()` | `local_service_status`; `forgelink_get_status` | parity for lifecycle, partial overall | Derive phase/running/ports/ownership/recovery from manager and persisted onboarding | 37 Rust tests; renderer startup gating | Provider/settings status remains later TPR work | TPR-001/002/003 | yes |
| Onboarding and local-only startup | `onboarding.js`; `start-local-only` in `main.js` | `local-service.json`, `forgelink_start_local_only`, shared `ConnectionModal` | partial | Persist loopback config, require onboarding completion, start the real local backend | Rust fresh-start/status tests; renderer baseline | Provider credential onboarding is TPR-003 | TPR-001/002/003 | yes |
| Provider validation | `main.js` → `validateTwilioCredentials`; Telnyx stores/validators | `forgelink_validate_settings`, `forgelink_validate_telnyx_settings` currently bounded errors/redacted status | scaffold | Implement against shared backend/provider stores under TPR-003 | Existing Electron provider tests; Tauri command static guard | No Tauri credential/provider implementation yet | TPR-001/003 | yes |
| Credential import/save/remove | `onboarding.js`, `smsProviderSettings.js`, `emailSettings.js`, `pushSettings.js`, `main.js` IPC | Tauri command names exist but return bounded later-slice errors/defaults | scaffold | Port OS-backed credential stores and renderer contract after lifecycle | Electron security/provider tests; Tauri status never claims configured credentials | TPR-003 owns secure storage and import/remove proof | TPR-001/003 | yes |
| Notifications | Electron `Notification`, `attention.js`, `notify`/`notify-event` IPC | `forgelink_notify`/`forgelink_notify_event` return renderer-safe shapes; no native plugin | scaffold | Add Tauri notification plugin/native implementation and policy integration | Electron attention tests; Tauri default-shape Rust test | Native desktop/mobile notification evidence missing | TPR-001/004 | yes |
| Attention policy | `attention.js`; persisted through Electron main IPC | `mobile_state_dir`, `forgelink_attention_policy`, save command | partial | Keep policy data local and apply it in native notification replacement | Rust persistence/default tests; renderer tests | Desktop policy persistence/notification application not proven | TPR-001/004 | yes |
| External navigation | Electron `shell.openExternal` with HTTPS allow-list | `forgelink_open_external` is a no-op scaffold | scaffold | Use Tauri shell/open plugin with the same HTTPS validation | Electron navigation tests/static bridge tests | No native open-external proof | TPR-001/004 | yes |
| Deep links/protocol entry | No active Electron protocol handler found in `main.js`; HTTPS navigation is guarded | No Tauri deep-link handler | missing | Either document unsupported deep links or add explicit Tauri plugin behavior before gate | Inspection result recorded here | Must decide and test supported target behavior | TPR-001/004 | yes |
| Single-instance behavior | `app.requestSingleInstanceLock`, `second-instance` in `main.js` | No Tauri single-instance plugin/lock | missing | Add Tauri single-instance plugin and activation focus behavior | Electron lifecycle tests | Competing Tauri launches are not yet controlled | TPR-001/004 | yes |
| Activation/window restoration | Electron `activate`, restore/minimize/focus, `window-all-closed` | Tauri default window lifecycle only | partial | Use Tauri window/event APIs and document platform differences | Electron main inspection | Restore/focus semantics lack Tauri evidence | TPR-001/004 | yes |
| Secure settings surface | Electron main-only IPC and OS-encrypted stores | Command names registered in `lib.rs`; most return bounded defaults | scaffold | Port stores behind Tauri commands, never renderer filesystem access | Electron security tests; Tauri command registration test | TPR-003 not implemented in this slice | TPR-001/003 | yes |
| MCP credentials | `main.js` `/api/mcp/*`, `~/.forgelink/api.token`, status/install command | `forgelink_mcp_*` returns scaffold metadata | scaffold | Reuse backend API with Tauri protected file/OS-store boundary | Electron MCP tests; Tauri status redaction test | Credential generation/storage parity missing | TPR-001/003 | yes |
| Agent-channel credentials | `main.js` `/api/agent-channels/*`, token files | `forgelink_agent_channels` persists metadata only; no secret files | partial/intentionally_replaced | Keep mobile metadata-only boundary; add desktop protected store | Rust metadata persistence tests; capability JSON | Desktop token operations not ported | TPR-001/003 | yes |
| Email settings | `emailSettings.js`, main IPC, backend env bridge | `forgelink_email_settings` returns default scaffold | scaffold | Port encrypted store and backend env construction | Electron email tests | Tauri cannot claim email parity | TPR-001/003 | yes |
| Push settings | `pushSettings.js`, main IPC, backend env bridge | `forgelink_push_settings` returns default scaffold | scaffold | Port encrypted topic/token store and native delivery | Electron push tests | Tauri cannot claim push parity | TPR-001/003/004 | yes |
| Linked-node identity operations | Electron renderer uses shared API/bridge; Tauri `node_identity*.rs` orchestrates vault/backend | Tauri commands in `lib.rs`, encrypted local vault and loopback lifecycle | partial | Retain Tauri Rust implementation and connect it to manager credentials | Rust node identity/lifecycle tests; WI030 evidence | Desktop command path still uses legacy env fallback instead of manager token | TPR-001/003 | yes |
| Diagnostics/support | Shared backend `/api/diagnostics`; renderer `PhoneApi` | Same endpoint becomes available only after manager starts backend | partial | Preserve backend API and add Tauri support report/native diagnostics wrapper | Backend diagnostics tests and API inspection | Tauri shell packaging/support report UX unproven | TPR-001/005 | yes |
| Backup/restore/export/retention | `renderer/src/api.ts` `/api/data/*`; backend database/data safety modules | Same shared backend endpoints, no Tauri-specific shell wrapper | partial | Exercise endpoints through Tauri-owned backend and add shell-level smoke | Electron/backend data tests; docs | Tauri backup/restore/corruption smoke not yet run | TPR-001/005 | yes |
| Corrupt/damaged DB recovery | Backend migration/database/data-status implementation | Backend is packaged but Tauri recovery UX/evidence absent | partial | Reuse backend recovery and surface status/retry in shared cockpit | Backend migration tests/docs | Tauri-specific packaged recovery proof missing | TPR-001/005/007 | yes |
| Updates/release hooks | `electron-updater`, `updates.js`, builder publish config | Tauri config/resource build; no updater plugin configured | scaffold | Port updater only after signing/feed policy; retain Electron fallback | Electron update tests; Tauri distribution guard | Public signed update feed is intentionally not claimed | TPR-001/006/007 | yes |

## Process and runtime lifecycle

| Concern | Electron owner/path | Current Tauri owner/path | State | Replacement strategy | Test/evidence | Remaining gap | Criterion | Electron-removal blocker |
|---|---|---|---|---|---|---|---|---|
| Backend entrypoint | `main.js` `backendEntryPath()` → `backend-dist/index.js` | `local_service.rs` `resolve_backend_runtime()` → bundled `forgelink-runtime/backend-dist/index.js` | parity for lifecycle | Resolve packaged resource first, debug fallback second | Rust runtime resolution path; packaging static guard | Packaged Windows launch remains unproven | TPR-001/002/007 | yes |
| Executable/runtime | Electron utility process supplies Electron Node | Tauri resource includes `process.execPath` as `node.exe`/`node` | partial | Stage a self-contained Node runtime via `prepare-backend-runtime.mjs` | Script and config static tests | Clean packaged build/install proof pending | TPR-001/002/007 | yes |
| Working directory | Electron utility process inherits app process context | Tauri runtime uses packaged runtime directory when bundled | parity for boundary | Set `current_dir` only to owned resource root | Rust spawn implementation | Platform-specific filesystem permission proof pending | TPR-001/002/007 | yes |
| Environment construction | `main.js` passes API token, provider env, data dir/version | `local_service.rs` passes loopback host/port, launch token, data dir/version | partial | Add provider env only with TPR-003 store implementation | Rust token-redaction test; Electron lifecycle inspection | Provider env parity intentionally deferred | TPR-001/002/003 | yes |
| Authentication token | `randomBytes(32).toString("base64url")` in Electron main | Manager creates 32-byte base64url token and injects it only into child/connection command | parity for TPR-002 | Keep launch-only bearer contract; never serialize into public status | Rust serialized-status test; backend `/health` contract | OS persistence/rotation belongs to TPR-003 | TPR-001/002/003 | yes |
| Port selection | `findAvailablePort(preferred, host)` with OS-assigned fallback | `select_port` preferred bind then loopback port 0 | parity | Preserve dynamic fallback and report configured/effective ports | Rust unrelated-process conflict test | Renderer-level conflict UX needs broader integration evidence | TPR-001/002 | yes |
| Valid existing service | Electron probes current endpoint before/after start | Tauri authenticated health probe attaches without owning child | parity | Attach only on authenticated `{ok:true,runtime:"node"}` health | Rust attach test | Cross-process token discovery remains intentionally bounded | TPR-001/002 | yes |
| Unrelated process/stale service | Electron does not kill the port occupant; dynamic fallback | Tauri never broad-kills; fallback records non-termination note | parity | Own and kill only the exact child handle spawned by manager | Rust dynamic conflict test | Windows operator presentation not packaged-tested | TPR-001/002/007 | yes |
| Readiness probe | Electron HTTP `/health` Bearer token, 500ms request timeout | Reqwest blocking `/health`, bearer token, 500ms request timeout and JSON runtime check | parity | Do not report ready until authenticated health succeeds | Rust readiness/timeout tests | Renderer integration with Tauri window pending | TPR-001/002 | yes |
| Startup bound | Electron `waitForBackend(10000)` polls every 200ms | Tauri `READINESS_TIMEOUT` 10 seconds; 100ms polling | parity | Preserve bounded startup failure | Rust timeout test | No packaged launch timing evidence | TPR-001/002/007 | yes |
| Unexpected exit | Electron child `exit`, nonzero restart policy max 5/60s | Tauri monitor thread `try_wait`, same bounded budget/backoff | parity | Track generation, requested stop, exit code, restart count | Rust crash/restart/exhaustion test | Crash UX still uses shared settings surface | TPR-001/002 | yes |
| Shutdown | Electron `stopBackend()` kills current utility process | Tauri `stop`, `shutdown`, bounded child termination, monitor join | parity for ownership/bound | Kill only manager-owned child and clear lifecycle state | Rust explicit stop/shutdown tests | Graceful signal semantics need platform-specific proof | TPR-001/002/007 | yes |
| App exit cleanup | Electron `before-quit` stops backend/tunnel | Tauri `RunEvent::ExitRequested/Exit` calls manager shutdown | parity for current slice | Register exit cleanup before retiring Electron | Rust static guard; lifecycle implementation | Full desktop app-exit smoke pending | TPR-001/002/007 | yes |
| Orphan/stale process handling | Electron probes valid service and only tracks current utility handle | Tauri attach/fallback model; no name-based process scan | partial | Keep safe attach and never broad-kill; operator retries degraded state | Rust attach/conflict tests | Persisted stale PID registry is intentionally not introduced | TPR-001/002 | no |
| Recovery/status/logging | Electron console logs child output and recovery message; raw logs may contain child output | Tauri suppresses child stdout/stderr, redacts token from status/errors, exposes recovery/port note | partial | Safe operator messages now; add structured diagnostics later | Rust no-token status/error test | Tauri structured support logging remains TPR-005 | TPR-001/002/005 | yes |

## Desktop OS integration and distribution

| Concern | Electron owner/path | Current Tauri owner/path | State | Replacement strategy | Test/evidence | Remaining gap | Criterion | Electron-removal blocker |
|---|---|---|---|---|---|---|---|---|
| Native notifications | Electron `Notification` | No Tauri native notification plugin yet | missing | Add Tauri notification plugin and platform tests | Electron attention suite only | TPR-004 | TPR-004 | yes |
| HTTPS external open | Electron `shell.openExternal` | No-op command | scaffold | Tauri shell plugin with allow-list | Static bridge coverage only | TPR-004 | TPR-004 | yes |
| Protocol/deep-link registration | No active Electron protocol registration found; navigation guard only | No handler | missing/not_applicable pending decision | Record supported deep-link posture and implement if required | Source inspection | TPR-004 decision/evidence missing | TPR-004 | yes |
| Single instance | Electron app lock and second-instance focus | No Tauri single-instance plugin/lock | missing | Tauri single-instance plugin | Electron main source | TPR-004 | TPR-004 | yes |
| Window restore/activation | Electron `activate`, show/restore/focus | Tauri default window | partial | Tauri window event/plugin equivalent | Electron source; no Tauri smoke | TPR-004 | TPR-004 | yes |
| Tray/background/autostart | No tray or autostart implementation found in Electron source | None | not_applicable (current product) | Keep absent unless product scope changes | Source inspection | Reconfirm at retirement review | TPR-004 | no |
| OS credential storage | Electron `safeStorage` in onboarding/email/push/provider stores | Tauri `keyring` dependency exists for node identity wrapping, not all settings | partial | Port all protected settings to Tauri OS-backed store | Electron security tests; Tauri identity tests | TPR-003 | TPR-003 | yes |
| Renderer/resource resolution | Electron `renderer/index.html`; builder includes renderer | Tauri `frontendDist: ../../Electron/renderer`; resource resolver handles runtime | parity for shared shell/build | Keep one renderer and explicit resource roots | `tauri-scaffold.test.js`, lifecycle static test | Generated renderer assumption remains until TPR-009 | TPR-001/006/009 | yes |
| Backend inclusion | Electron builder includes/unpacks `backend-dist/**`, Node is Electron runtime | Tauri script copies backend-dist, prod dependencies and Node into `.runtime` resource | partial | Use bundled resource mapping and independent runtime | Script/config static test; `npm run backend:prepare` | TPR-007 packaged clean-machine proof | TPR-006/007 | yes |
| Installer/uninstaller | `electron-builder` NSIS/AppImage/deb/mac targets | Tauri bundle active; icon/resource configuration present | scaffold | Add/validate Tauri target installers | Existing Tauri distribution contract tests | No Tauri artifact run recorded here | TPR-006/007/008 | yes |
| Version metadata | Electron package/builder and `app.getVersion()` | Cargo package/Tauri config 2.0.3 and runtime manifest | partial | Keep versions synchronized and include manifest | Config/script inspection | Release artifact proof pending | TPR-006 | yes |
| Signing/checksums/notes | Electron publish config; release preflight | Tauri distribution plan explicitly holds public signing/feed | partial/intentionally_replaced | Certificate-gated Tauri release with checksums/rollback | `tauri-distribution.test.js`, strategy docs | TPR-006/007/008 | TPR-006 | yes |
| Updates/feed | `electron-updater` guarded by packaged/opt-out | No Tauri updater/feed implementation | missing | Add signed updater only after release contract is approved | Electron update tests; Tauri plan | TPR-006 | TPR-006 | yes |
| Rollback | Electron remains available; managed backups/schema ladder | Tauri docs/plan preserve Electron and data rollback | partial | Keep old shell and managed data rollback until signed Tauri path | `docs/tauri-validation-rollback-evidence.md` | No packaged rollback drill | TPR-006/007/011 | yes |

## Data safety and operator ownership

| Concern | Electron owner/path | Current Tauri owner/path | State | Replacement strategy | Test/evidence | Remaining gap | Criterion | Electron-removal blocker |
|---|---|---|---|---|---|---|---|---|
| Private data authority | Electron child backend uses `FORGELINK_DATA_DIR` default `~/.forgelink` | Tauri desktop passes the same `USERPROFILE/HOME/.forgelink` data root | partial | Preserve desktop data authority while migrating shell | Source inspection; manager spawn env | Migration/upgrade smoke remains open | TPR-001/005/007 | yes |
| Mobile data boundary | Electron has no mobile shell | Tauri mobile manager has no child/runtime/data use and acts as remote authenticated client | parity/intentionally_replaced | Keep mobile remote-only; never copy SQLite/private state | `mobile-cockpit.json`, Rust cfg implementation, distribution plan | Packaged mobile authenticated-node smoke remains open | TPR-001/002/005/007 | yes |
| Fresh onboarding | Electron settings store starts unconfigured and local-only route starts backend | Tauri persisted config starts `needs_onboarding`, local-only command completes config then starts | partial | Match shared renderer modal and status gating | Renderer startup changes; Rust onboarding guard | Full Tauri window smoke pending | TPR-001/002/007 | yes |
| Existing configuration | Electron settings/userData + backend startup | Tauri app-data `local-service.json` + desktop data root; auto-start only when onboarding is complete | partial | Restore config and authenticated service without false running status | Config loader and setup code | Migration from Electron userData not implemented | TPR-001/002/007 | yes |
| Service unavailable | Electron recovery message and status after readiness failure | Tauri degraded phase, recovery message, retry through start controls, `running=false` | parity for lifecycle | Surface truthful degraded state and no API load until ready | Rust timeout/spawn tests; renderer `connectionReady` gating | UI end-to-end recovery smoke pending | TPR-001/002 | yes |
| Backup/restore/export | Shared `PhoneApi` and backend data routes | Shared API behind Tauri local service | partial | Reuse backend implementation; add Tauri evidence | Electron/backend tests | TPR-005 | TPR-005 | yes |
| Retention/migration | Shared backend data routes and migration tests | Same packaged backend | partial | Reuse backend; verify Tauri profile | Backend migration/data tests | TPR-005 | TPR-005 | yes |
| Damaged DB recovery | Backend quarantine/recovery and status DTO | Same backend, no Tauri-specific diagnostic surface yet | partial | Reuse backend and expose truthful recovery status | Backend tests/docs | TPR-005/007 | TPR-005 | yes |
| Diagnostics/private evidence | Electron security scanner and backend redacted diagnostics | Tauri lifecycle status omits token; no support-report port | partial | Port redacted diagnostics and scan Tauri artifacts | Rust no-token serialization test; Electron scanner | TPR-005/003 | TPR-003/005 | yes |
| Operator recovery | Electron retry/start controls and close/reopen recovery text | Tauri start/stop manager, bounded retry exhaustion, actionable recovery string | parity for lifecycle | Keep restart/port/readiness retry controls | Rust recovery tests | Full settings UX and packaged recovery drill pending | TPR-001/002/007 | yes |

## TPR-001 conclusion and deletion checklist

The Electron-only surface was inspected across bridge methods, main-process
lifecycle, OS integration, packaging/release, shared backend data workflows, and
operator/data-safety responsibilities. The table deliberately records the
remaining TPR-003 through TPR-008 work instead of silently treating scaffold
commands as parity. TPR-001 can therefore be satisfied as an inventory criterion;
the many `yes` rows are blockers for the later Electron-removal criterion, not a
claim that Electron is removable now.

The Android evidence already present in
`evidence/runs/20260703-tauri007-android-emulator-smoke.json` and the WI030
artifacts was reconciled as historical emulator/operator-status evidence. It does
not prove a packaged Tauri mobile app can authenticate to an operator node, and it
does not authorize embedding the desktop backend or private database on mobile.
