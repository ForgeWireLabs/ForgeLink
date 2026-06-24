---
audience: planning agents and reviewers
status: active
last_verified: 2026-06-24
source_of_truth: work/active/011-production-readiness/README.md; work/active/011-production-readiness/work-item.json
---

# Work Item 011 Alignment Report

## Baseline findings

- The modern renderer and dependency-light backend are functional development foundations.
- The packaged architecture is now clean-machine installable: the backend is TypeScript on Electron's bundled Node runtime (`node:sqlite`), and Python has been removed (PR-001/001A/001B).
- Secure onboarding, credential validation, removal, and explicit environment migration are complete.
- Local storage has versioned migrations, backup/restore, retention, export, and corruption recovery contracts.
- Messaging reliability is covered with deterministic provider failure and callback contracts; live Twilio failure testing remains opt-in.
- Backend lifecycle (PR-006), single-instance (PR-010), security verification (PR-011), the test pyramid (PR-013), and support diagnostics (PR-015) are complete. Release signing and a published auto-update feed (PR-014) are the only baseline items still open.

## Current criterion state (2026-06-24)

Authoritative state is in [`work-item.json`](../work-item.json). Summary:

- **Satisfied:** PR-001/001A/001B, PR-002, PR-003, PR-004, PR-005, PR-006, PR-010, PR-011, PR-013, PR-015.
- **Waived into the 015/017 roadmap (decision 0005):** PR-007 (contacts), PR-008 (media), PR-009 (notifications/deep links), PR-012 (accessibility), PR-016 (voice; voice accepted, legacy iframe rejected).
- **Pending:** PR-014 (releases) — partially landed (icon, installer, checksums, version metadata, CHANGELOG, reproducible checklist, auto-update wiring with electron-updater bundled). Blocked on an operator-provided code-signing certificate and a published `latest.yml` feed (held until signing so the channel is not unauthenticated). A manual-download release is fine now.

## Sequencing risks

- PR-014 is the only remaining baseline; it is blocked on the operator, not on more engineering. Do not publish an auto-update feed before code-signing is in place.
- Do not claim webhook security incomplete: proxy-aware signature tests landed with PR-011.
- Do not revive Voice from legacy code; PR-016 was waived to 015 (CLV-012/013) as a fresh product surface.

## PR-001 migration evidence (2026-06-14)

- TypeScript backend compiles under TypeScript 5.9 for Electron's Node 24 runtime.
- `node:sqlite` database tests cover number normalization, thread creation, unread reset, messages, and contact linking.
- HTTP contract test covers `/health` and contacts; signature test covers valid and invalid Twilio signatures.
- Electron visual smoke runs with the TypeScript backend utility process.
- Fresh unpacked package contains `backend-dist/` and no Python files.
- Packaged app launched with no Python or Node dependency and returned `{ "ok": true, "runtime": "node" }`.
- HTTP parity covers health, contacts, inbound SMS/MMS, delivery status, upload/media serving, signature rejection, file validation, and traversal rejection.
- A copy-on-first-launch migration preserves legacy SQLite and uploads without overwriting current Electron data.
- Python sources and stale repository references are removed; Voice and deferred product workflows remain tracked in their own work items.

## PR-002 onboarding evidence (closed 2026-06-15)

- Electron main owns credential persistence and passes secrets directly to the backend utility process.
- The auth token is encrypted with OS-backed `safeStorage` and omitted from preload and renderer responses.
- Host input is restricted to loopback and port input is bounded before the backend restarts.
- The renderer exposes connection configuration and local service start/stop controls through narrow IPC handlers.
- First-run and update flows validate the Twilio account and confirm the selected incoming number before saving.
- Stored credentials can be removed, and complete environment credentials require an explicit secure import before persistence.
- Eleven renderer tests and three onboarding tests cover the interaction and credential contracts; the unpacked package contains the onboarding module, no Python, and reports Node health under an isolated profile.
- Remaining risk: automated provider validation uses HTTP fixtures rather than operator-owned live Twilio credentials.

## PR-001A renderer evidence (closed 2026-06-14)

- Renderer source moved from a global imperative script to React 19 components with strict TypeScript contracts.
- API and preload bridge payloads have explicit interfaces; generated browser assets are excluded from source control.
- Nine Vitest and Testing Library cases cover navigation, search, modal focus/Escape behavior, sending and keyboard composition, uploads, media, pagination, contacts, linking, settings, and local service controls.
- The minified renderer bundle is approximately 206 KB and the Chromium visual smoke preserves the approved layout.
- The unpacked Windows package launches against isolated local data and returns `{ "ok": true, "runtime": "node" }`; ASAR includes only `app.js`, `index.html`, and `styles.css` under the renderer path.
- PR-001A is complete. Python removal remains gated only by backend parity and PR-001B evidence.

## PR-001B removal evidence (closed 2026-06-15)

- Six backend tests cover database behavior, legacy data import, HTTP contracts, webhook/status parity, uploads/media, and Twilio signatures.
- Repository scan finds no tracked Python implementation or runtime instructions; the local audit validator remains intentionally local tooling.
- Windows unpacked package contains the TypeScript backend and compiled React renderer only, launches with isolated data, and reports Node health.
- Legacy GTK/Linux services and Voice were not migration contracts; Voice remains explicitly deferred under PR-016.

## PR-003 local API evidence (closed 2026-06-15)

- Electron main generates a 256-bit credential once per launch and passes it to the utility backend without adding it to public status or logs.
- The backend returns `401` for missing and incorrect credentials on private routes and accepts the matching bearer credential.
- Twelve renderer tests run against a fetch harness that rejects requests without the launch credential, proving the desktop client supplies it consistently.
- Authenticated visual smoke passes, the unpacked Windows package launches, and an external unauthenticated package probe receives `401` from `/health`.
- Twilio webhooks continue to use signature validation; provider-fetchable MMS media remains outside bearer authentication by design.

## PR-004 data lifecycle evidence (closed 2026-06-15)

- SQLite schema version 2 upgrades version-zero legacy stores and explicit version-one fixtures, with a pre-migration copy for existing data.
- Online SQLite backups are integrity checked and bundled with uploads and a manifest; restore verifies the source and preserves a rollback copy.
- JSON export, bounded retention, automatic safety backup, empty-thread cleanup, and unreferenced upload deletion are available through authenticated local routes and Settings controls.
- Corrupt SQLite files are quarantined with their WAL sidecars and surfaced in Settings while a fresh recoverable store starts.
- Thirteen renderer tests and thirteen backend/onboarding tests pass; Settings visual inspection and an unpacked Windows schema-1 migration both pass.
- Remaining risk: lifecycle artifacts are documented sensitive plaintext, and managed backup rotation remains future operational work.

## PR-005 messaging reliability evidence (closed 2026-06-15)

- Schema version 3 adds provider SID mapping, attempt counts, redacted last errors, and per-thread drafts while preserving previous message IDs.
- Outbound rows persist as pending before Twilio calls; failure and interrupted shutdown become durable retryable states.
- Stable local IDs make duplicate local send requests harmless, and inbound MessageSid insertion prevents duplicate messages and unread inflation.
- Twilio status callbacks are attached to outbound requests and update local rows monotonically; duplicate and backward transitions are ignored.
- Fourteen renderer tests and sixteen backend/onboarding tests cover optimistic display, failure, retry, draft restart, receipt progression, provider rejection redaction, pagination, and duplicate webhook delivery.
- Visual smoke confirms date grouping, failed styling, retry placement, and restored drafts; the unpacked Windows package upgrades schema 2 to 3 and recovers pending rows.
- Remaining risk: live-provider failures are fixture-driven, and explicit retry after an ambiguous Twilio timeout can duplicate a provider-accepted message.

## Drift policy

Any implementation merged outside this plan must be added here if it changes priority, closes an item partially, or creates a new production risk.
