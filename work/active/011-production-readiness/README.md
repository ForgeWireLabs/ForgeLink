---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-17
source_of_truth: AGENTS.md; work/active/011-production-readiness/_audit/alignment-report.md
---

# Work Item 011: Production Readiness

> Lifecycle state for this item lives in [`work-item.json`](work-item.json); this
> README is the intent and history narrative. Closed phases PR-001 through PR-005
> are recorded below; open work (PR-006 through PR-016) is tracked as pending
> acceptance criteria in the manifest. Migrated from the pre-ledger
> `todos/001-production-readiness` plan on 2026-06-17.

## Goal

Turn Twilio Phone into a secure, installable, recoverable Windows desktop messaging application with predictable operations and trustworthy releases.

## Reconciliation 2026-06-18 (decision 0005)

011 is reconciled against the 015-017 roadmap. Authoritative criterion state is
in [`work-item.json`](work-item.json); this is the human summary.

**Done this session** (evidence `20260618-011-baseline-hardening`):
- **PR-010 single-instance** — `app.requestSingleInstanceLock()`; a second launch
  focuses the first window and starts no competing backend (runtime-verified).
- **PR-015 support diagnostics** — authenticated `/api/diagnostics` with versions
  and status; credentials/messages/contacts/media excluded (unit-tested).
- **PR-006 backend lifecycle** — port-conflict detection + dynamic-port fallback,
  bounded crash-restart, lifecycle diagnostics, clean shutdown, and a recovery
  message (unit-tested; conflict + restart runtime-verified). Evidence
  `20260618-pr006-backend-lifecycle`.
- **PR-011 security verification** — proxy-aware webhook signature tests (bind to
  the configured public URL, not the Host header), local API threat tests (auth,
  media traversal, redacted config), a git-tracked secret scanner (`scan:secrets`)
  with unit tests, and a production dependency audit (`scan:deps`). Evidence
  `20260618-pr011-security-verification`.
- **PR-013 test pyramid** — added the two missing layers: static installer/
  packaging-completeness tests (catch the missing-module crash class) and an
  opt-in live Twilio test (skipped unless FORGELINK_LIVE_TWILIO=1). Backend
  HTTP, renderer interaction, and lifecycle layers already existed. Evidence
  `20260618-pr013-test-pyramid`.

**Waived — absorbed by the roadmap** (work continues there, not in 011):
- **PR-007 contacts** -> 015 (CLV-009/010/011).
- **PR-008 media** -> 015 (channel/media model).
- **PR-009 notifications/deep links** -> 015 (CLV-004) + 017.
- **PR-012 accessibility** -> 017.
- **PR-016 voice** -> 015 (CLV-012/013); voice accepted, legacy iframe rejected.

**Remaining genuine baseline** (still pending; 011 stays active):
- **PR-014** releases — **partially landed** (evidence
  `20260618-pr014-release-unblocked`): real icon, installer, checksums, version
  metadata, release notes (`CHANGELOG.md`), a reproducible release checklist
  (`docs/release-checklist.md`), and auto-update *wiring* (tested helper + guarded
  main-process check + GitHub publish config + electron-updater dependency) are
  done. **Remaining (keeps PR-014 pending):** a code-signing certificate
  (operator-provided), electron-updater bundled into the asar, and a published
  release feed before auto-update is functional and trust-anchored. Overlaps 017
  OCX-020.

## Priority order

### Phase 0: TypeScript and React migration

- [x] **PR-001 Retire the Python backend.** Reimplement the local service in TypeScript on Electron's bundled Node runtime, use built-in `node:sqlite`, preserve the HTTP/database contract, and run it as an Electron utility process.
  - Acceptance: TypeScript contract and database tests; Electron launches with Python absent from `PATH`; packaged health and renderer smoke pass; Python is removed only after parity evidence.
- [x] **PR-001A Convert the renderer to React and TypeScript.** Move the validated design into React components with typed API contracts, explicit state boundaries, and interaction tests.
  - Acceptance: feature parity with the current renderer; visual smoke parity; keyboard and modal interaction tests; no vanilla renderer remains.
  - Completion: React 19 and strict TypeScript own all renderer source; messaging, pagination, media, uploads, contacts, linking, settings, service controls, polling, and notification behavior are restored and covered by interaction tests. The installer contains only the compiled renderer assets.
- [x] **PR-001B Remove migration scaffolding.** Delete Python sources/tests and temporary compatibility paths after TypeScript backend and React renderer gates pass.
  - Acceptance: repository and package contain no Python runtime dependency; clean-machine install and launch succeed without Python or Node installed.
  - Completion: tracked Python sources and stale references are removed; first launch can copy legacy SQLite/uploads without overwriting current data; webhook, status, upload, media, database, renderer, package, and clean-runtime checks pass.

### Phase 1: Installation and onboarding

- [x] **PR-002 Add secure in-app onboarding.** Store credentials with Electron's OS-backed `safeStorage`, validate them, show the selected Twilio number, and never expose secrets to the renderer.
  - Acceptance: first-run wizard, credential test, update/remove flow, redacted logs, and migration from environment variables.
  - Completion: first-run setup and Settings validate the account and selected number through Twilio before save; credentials can be updated, removed, or explicitly imported from environment variables; renderer-visible status is redacted.
- [x] **PR-003 Authenticate the local API.** Generate a per-launch secret or equivalent protected channel between renderer and backend; reject unauthenticated local requests.
  - Acceptance: API tests prove missing/incorrect credentials fail and the Electron client succeeds.
  - Completion: Electron main generates a 256-bit launch credential, the backend requires it for private routes, and the renderer attaches it to every local API request through a narrow preload connection capability.

### Phase 2: Data safety and backend reliability

- [x] **PR-004 Formalize data lifecycle.** Add schema versioning, migrations, backup, restore, export, retention, and corruption recovery.
  - Acceptance: upgrade tests across schema versions; verified restore; documented sensitive-data handling.
  - Completion: schema version 2 migrates legacy stores transactionally with pre-migration copies; managed backups include SQLite and uploads; restore verifies integrity; JSON export, bounded retention, orphan upload cleanup, and corruption quarantine are available from Settings.
- [x] **PR-005 Harden messaging behavior.** Add optimistic sends, stable pending/failed states, retries, idempotency, drafts, complete delivery receipts, unread correctness, grouping, and pagination.
  - Acceptance: HTTP/database tests for success, timeout, Twilio rejection, duplicate callback, restart, and retry paths.
  - Completion: stable local IDs persist before network calls; local send requests and inbound webhooks are idempotent; failures and interrupted sends are retryable; drafts, attempt counts, provider SIDs, monotonic receipts, date grouping, and existing pagination survive restart.
- [x] **PR-006 Harden backend lifecycle.** Detect port conflicts, use dynamic ports where appropriate, restart crashed services with limits, expose diagnostics, and shut down cleanly.
  - Acceptance: automated process lifecycle tests and clear user-facing recovery instructions.

### Phase 3: Product workflows

- [ ] **PR-007 Complete contacts.** Add edit/delete confirmation, duplicate merge, CSV import/export, and contact selection during composition.
- [ ] **PR-008 Complete media.** Add previews, upload progress, cancellation, validation errors, download/open controls, and retention cleanup.
- [ ] **PR-009 Complete notifications and deep links.** Clicking a notification opens the correct conversation; background and focus behavior are tested.
- [x] **PR-010 Add single-instance behavior.** A second launch focuses the first app and cannot start a competing backend.

### Phase 4: Security, quality, and releases

- [x] **PR-011 Expand security verification.** Add proxy-aware webhook signature tests, local API threat tests, secret scanning, dependency scanning, and diagnostic redaction tests.
- [ ] **PR-012 Complete accessibility.** Keyboard-only navigation, focus restoration, screen-reader labels, WCAG AA contrast, zoom, reduced motion, and high-contrast behavior.
- [x] **PR-013 Build the test pyramid.** Backend HTTP integration tests, renderer interaction tests, Electron lifecycle tests, installer tests, and opt-in Twilio sandbox/live tests.
- [ ] **PR-014 Establish releases.** Real icon, signed installer, version metadata, release notes, checksums, update strategy, rollback, and reproducible release checklist.
- [x] **PR-015 Add support diagnostics.** User-triggered health report with versions and status while excluding credentials, messages, contacts, and media by default.

## Deferred product decision

- [ ] **PR-016 Decide Voice scope.** Either design and implement Twilio Voice as a separately tested product surface or explicitly reject it from the roadmap. Do not restore the legacy iframe implementation.

## Cross-cutting definition of done

- No credentials or personal communication data in commits, screenshots, test fixtures, or default logs.
- Current behavior documented under `docs/`; future behavior stays here until shipped.
- Every closed item includes commands run, manual evidence, limitations, and rollback notes.
- Installer behavior is tested on a clean Windows environment.
- Security-sensitive claims have tests or reproducible inspection evidence.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-14 | Baseline | Backend unit tests, Electron syntax checks, Chromium UI capture | Green; production gaps remain open. |
| 2026-06-14 | PR-001 decision | Electron 42 verified with Node 24.16 and SQLite 3.53 through `node:sqlite` | Python bundling rejected; TypeScript migration started. |
| 2026-06-14 | PR-001 slice 1 | TypeScript compile; database, HTTP, and signature tests; Chromium smoke; package ASAR inspection; clean-runtime package health | Green. Package contains TypeScript backend and no Python files; Python retained only for remaining parity review. |
| 2026-06-14 | PR-002 slice 1 | Main-process settings IPC, loopback validation, `safeStorage` encryption, renderer configuration form, backend restart, visual smoke | Partial. Secure entry and storage work; validation, removal, and first-run onboarding remain open. |
| 2026-06-14 | PR-001A slice 1 | Strict renderer compile, React bundle, Vitest/Testing Library navigation and modal tests, backend suite, Chromium visual smoke | Green. Vanilla renderer source removed; broader workflow parity tests remain before closure. |
| 2026-06-14 | PR-001A closure | 9 renderer interaction tests, 4 backend tests, strict compile, visual smoke inspection, ASAR inventory, unpacked Windows build, isolated packaged health check | Complete. ASAR contains only compiled renderer assets; packaged runtime returns Node health. Remaining Python removal risk belongs to PR-001/PR-001B. |
| 2026-06-15 | PR-001/PR-001B closure | 9 renderer tests, 6 backend/migration tests, Python reference removal, repository scan, compiled-only ASAR inspection, unpacked Windows build, isolated package health | Complete. Supported SMS/MMS contracts are TypeScript-only; legacy data is copied once without overwrite. |
| 2026-06-15 | PR-002 closure | 11 renderer tests, 3 onboarding tests, encrypted-settings inspection, Twilio validation contract tests, visual inspection, ASAR inventory, unpacked Windows build, isolated package health | Complete. Credential lifecycle is OS-encrypted and renderer-redacted; provider calls are tested with deterministic HTTP fixtures rather than a live account. |
| 2026-06-15 | PR-003 closure | Missing/wrong/valid bearer API tests, 12 authenticated renderer tests, authenticated visual smoke, unpacked Windows package, unauthenticated package probe | Complete. Private routes reject unauthenticated callers with `401`; webhooks and MMS media retain their separate external controls. |
| 2026-06-15 | PR-004 closure | Version 0/1 upgrade tests, verified SQLite and upload restore, JSON export, retention tests, corruption quarantine, 13 renderer tests, visual inspection, unpacked package migration | Complete. Data lifecycle is recoverable and sensitive plaintext artifacts are documented. |
| 2026-06-15 | PR-005 closure | 14 renderer tests, 16 backend/onboarding tests, send failure/retry and duplicate webhook contracts, draft restart, status callback inspection, failed-state visual smoke, unpacked schema-2 upgrade | Complete. Messaging intent and failure state are durable; provider timeout duplication remains an explicit retry risk. |

## PR-001A closure notes

- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, packaged `/health` smoke on isolated port `5088`, and `.local/validate_system.py`.
- Rollback: restore the previous `Electron/renderer/app.js`, remove the renderer build step, and revert the exact renderer file list in `builder.json`.
- Remaining risk: tests use a contract-faithful local fake for renderer interactions rather than a live Twilio account; live-provider behavior remains outside PR-001A.

## PR-001B closure notes

- Scope: SMS/MMS, contacts used by current UI, webhook validation, uploads/media, delivery state, local SQLite, and packaging were migration contracts. Voice was explicitly deferred to PR-016; advanced contacts, media retention, notification deep links, and search remain separately tracked product work rather than Python compatibility requirements.
- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, repository Python-reference scan, ASAR inventory, isolated packaged `/health` smoke, and `.local/validate_system.py`.
- Data safety: `~/.config/TwilioPhone/phone.sqlite` and `uploads/` are copied only if the new `%USERPROFILE%\.twilio-phone` targets are absent; legacy source data is retained.
- Rollback: restore `Python/TWL_phone.py` from Git history. The Electron runtime and migrated data do not depend on it.

## PR-002 closure notes

- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, ASAR inventory, isolated packaged `/health` smoke, and `.local/validate_system.py`.
- Security evidence: persisted settings contain only the encrypted token; preload status exposes a configured boolean rather than the token; Twilio failure messages omit response bodies and credentials.
- UX evidence: first-run setup, connection testing, selected-number confirmation, update, removal, explicit environment import, focus, Escape, and backdrop behavior are covered by implementation and renderer tests.
- Rollback: revert `Electron/onboarding.js` and its IPC bridge, then restore environment-only startup settings. Existing encrypted settings may be deleted safely but cannot be consumed by the old flow.
- Remaining risk: validation uses contract-faithful HTTP fixtures in automated tests. A live Twilio account smoke remains opt-in because it requires operator credentials and network access.

## PR-003 closure notes

- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, unauthenticated packaged `/health` probe, and `.local/validate_system.py`.
- Security evidence: the launch credential is generated with 32 random bytes, is absent from public status and logs, and is compared through fixed-length SHA-256 digests with `timingSafeEqual`.
- Route scope: `/health`, `/api/*`, and `/upload` are protected. Twilio-signed `/webhooks/*` and entropy-named `/media/*` remain externally reachable for provider operation.
- Rollback: remove the backend authorization gate, restore URL-only preload discovery, and stop passing `TWILIO_PHONE_API_TOKEN` to the utility process.
- Remaining risk: a fully compromised renderer can use its in-memory launch credential during that session; CSP, sandboxing, context isolation, and the narrow preload boundary remain required defenses.

## PR-004 closure notes

- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, packaged schema-1 upgrade with pre-migration backup inspection, and `.local/validate_system.py`.
- Recovery evidence: SQLite backups are integrity checked; restore preserves a rollback copy and restores uploads; corrupt stores are quarantined rather than overwritten.
- Retention evidence: 30-3650 day bounds, automatic pre-retention backup, old message and empty-thread deletion, and unreferenced upload cleanup are tested.
- Rollback: restore the generated pre-migration or managed backup database, restore its uploads directory, and revert schema-aware database startup and `/api/data/*` routes.
- Remaining risk: managed backups and exports are plaintext under the user data directory. Operators must encrypt and control access to copies moved off-device; automated backup rotation is not yet implemented.

## PR-005 closure notes

- Commands: `npm test`, `npm run screenshot`, `npm run build -- --dir`, packaged schema-2 upgrade and interrupted-pending inspection, and `.local/validate_system.py`.
- Reliability evidence: outbound intent is persisted before network I/O; local request IDs prevent duplicate POST processing; inbound webhook retries do not duplicate unread counts; drafts, attempts, failures, and receipts survive restart.
- Delivery evidence: outbound Twilio requests include the signed status callback URL, provider SIDs map to stable local rows, and duplicate/backward callback transitions are ignored.
- Rollback: restore the schema-2 pre-migration backup, revert local-ID send/retry/draft routes, and restore the previous post-provider-write send behavior.
- Remaining risk: Twilio does not document provider-side idempotency for message creation. An explicit retry after an ambiguous timeout may create a duplicate; the UI does not retry automatically.
| 2026-06-18 | reconciliation | Decision 0005: closed PR-010 + PR-015 with evidence; waived PR-007/008/009/012/016 into 015/017; PR-006/011/013/014 remain baseline | 011 reconciled and slimmer; stays active. |
| 2026-06-18 | PR-006 | Backend lifecycle: dynamic-port fallback + bounded crash-restart, diagnostics, clean shutdown, recovery message; lifecycle unit tests + runtime conflict/restart checks | Closed PR-006 with evidence 20260618-pr006-backend-lifecycle. |
| 2026-06-18 | PR-011 | Proxy-aware webhook signature tests, local API threat tests, secret scanner (scan:secrets) + unit tests, dependency audit (scan:deps), redaction coverage | Closed PR-011 with evidence 20260618-pr011-security-verification. |
| 2026-06-18 | PR-013 | Installer/packaging completeness tests + opt-in live Twilio test; pyramid layers (backend HTTP, renderer, lifecycle, security) confirmed green | Closed PR-013 with evidence 20260618-pr013-test-pyramid. |
| 2026-06-18 | PR-014 (partial) | Version metadata, release notes (CHANGELOG), reproducible release checklist (docs), and auto-update wiring; packaging test caught + fixed a missing-module regression | Unblocked items landed (evidence 20260618-pr014-release-unblocked); PR-014 stays pending on signing, electron-updater asar bundling, and a published feed. |
