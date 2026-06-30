---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-06-30
source_of_truth: work/completed/018-email-channel-adapter/README.md; work/completed/018-email-channel-adapter/work-item.json
---

# Work Item 018: Email Channel Adapter

## Goal

Add email as a provider-neutral ForgeLink channel for durable, auditable, non-urgent communication. Email should be useful as a fallback and long-form channel, while preserving ForgeLink's local-first state, contact policy, attention policy, and diagnostics redaction.

## Scope

- Outbound email through a channel adapter, initially SMTP-compatible.
- Optional inbound email through a clearly gated path such as IMAP polling or provider webhooks.
- Contact email identities and contact-point resolution.
- Attachments with explicit bounds and storage behavior.
- Delivery/failure state mapped into ForgeLink-owned local records.
- Signed quick-action design only if anti-replay, expiration, and local pending-action checks are implemented.

## Non-Goals

- Do not make email the primary operator approval channel by default.
- Do not claim end-to-end encryption.
- Do not store or log credentials in plaintext.
- Do not expose message bodies, headers, addresses, or attachments in support diagnostics by default.
- Do not treat a mailbox sender as trusted without explicit contact policy.

## Evidence Expectations

Implementation evidence must include deterministic adapter tests, security/redaction tests, renderer tests for configuration and disabled states, backup/export/retention coverage, docs, and a visual smoke artifact if UI changes ship.

## Evidence log

| date | item | evidence | result |
| --- | --- | --- | --- |
| 2026-06-30 | EMAIL-002/004/006 complete | Secure credential storage (`Electron/emailSettings.js`): SMTP password + inbound/quick-action secrets stored OS-encrypted via safeStorage in the main process, never in the DB or the renderer; main injects decrypted values into the backend launch env, IPC `email-settings-get/save/remove` restart the backend to apply, and a renderer credential form (redacted, presence-only) saves/removes them. Inbound ingest (EMAIL-004): signed (`X-ForgeLink-Email-Signature` HMAC) `POST /webhooks/email`, disabled-by-default, normalizes + dedups by provider id + resolves contact + bounds body/attachments. Signed quick-actions (EMAIL-006): HMAC-signed tokens enforcing signature + expiry + valid-action + actionable-pending-request + agent trust + single-use anti-replay (schema v26 `consumed_email_actions`) before recording the operator decision via `POST /webhooks/email/action`. `docs/email-channel.md`; `emailSettings.test.js` (3), email unit tests (14), server tests, database tests, 39 renderer tests, full Electron suite, and RepoPact/local validation passed. | EMAIL-002, EMAIL-004, and EMAIL-006 satisfied (evidence 20260630-email-002-004-006-complete). All 8 EMAIL criteria are now satisfied. |
| 2026-06-29 | EMAIL-005/007 complete | Added the email-channel configuration UI (Settings → Email channel: redacted status from `GET /api/channels/email/status`, env-config guidance, "fallback, not the default approval loop, grants no approval privileges" note, and a pointer to contact email identities). Contact email identities already exist via contact points (kind: email). Data safety: schema v25 `email_messages` table records sent email as private comms data; `recordEmailMessage`, `POST /api/email/send` (launch-only, records on send), and inclusion in `exportData()` + `applyRetention()`; backup is whole-DB. Diagnostics expose only the `email_configured` boolean (no host/address/credentials). `docs/email-channel.md`; backend build, email/server/database tests (incl. export+retention participation, redacted status, launch-only routes), 38 renderer tests, full Electron suite, and RepoPact/local validation passed. | EMAIL-005 and EMAIL-007 satisfied (evidence 20260629-email-005-007-config-data-safety). Remaining: EMAIL-002 secure-storage UI, EMAIL-004 inbound ingest, EMAIL-006 quick-actions. |
| 2026-06-29 | EMAIL-001/003/008 complete | New provider-neutral email adapter (`Electron/backend/src/email.ts`): outbound/inbound contracts, attachment bounds, MIME assembly, redacted retryable/permanent failure classification, credential validation, and disabled state. Outbound `email_send` adapter registered in the channel registry when SMTP is configured (`FORGELINK_SMTP_*`), with a deterministic test matrix (`email.test.ts`, in `npm test`) for success, provider rejection, missing credentials, invalid recipient, attachment bounds, and retryable vs permanent failure — using an injected fake transport (the default `sendSmtpEmail` client is operator-verified live). `/api/diagnostics` reports `email_configured` as a boolean only (no host/address/credentials). Documented in `docs/email-channel.md` (operator setup, privacy limits, provider requirements, failure modes, testing strategy, shipped vs deferred). Backend build, email tests (12), server tests, full Electron suite, and RepoPact/local validation passed. | EMAIL-001, EMAIL-003, and EMAIL-008 satisfied (evidence 20260629-email-001-003-008-outbound-adapter). Remaining: EMAIL-002 secure-storage UI, EMAIL-004 inbound ingest, EMAIL-005 UI, EMAIL-006 quick-actions, EMAIL-007 full data-safety. |


## Closeout

Completed 2026-06-30. All 8 acceptance criteria (EMAIL-001 through EMAIL-008) are
satisfied; none waived.

**Delivered**

- Provider-neutral email contracts, outbound SMTP adapter behind the channel
  registry, and docs (EMAIL-001/003/008).
- Configuration UI + contact email identities, framed as a fallback that grants no
  approval privileges (EMAIL-005).
- Secure OS-encrypted credential storage (SMTP + inbound + quick-action secrets) in
  the main process, redacted from the renderer/logs/diagnostics/exports (EMAIL-002).
- Inbound ingest via a signed, disabled-by-default provider webhook with dedup,
  contact resolution, and bounded handling (EMAIL-004).
- Signed quick-action boundaries: signature + expiry + valid action + actionable
  pending request + agent trust + single-use anti-replay (EMAIL-006).
- Data safety: sent/received email recorded as private communication data that
  participates in backup/export/retention; diagnostics expose only a boolean
  (EMAIL-007).

**Evidence:** `evidence/runs/20260629-email-001-003-008-outbound-adapter.json`,
`…20260629-email-005-007-config-data-safety.json`, and
`…20260630-email-002-004-006-complete.json`.

**Commands:** `npm run backend:build`, `npm run renderer:build`, `npm test`
(full Electron suite, 173 pass / 0 fail / 1 skipped at closeout), and
`python .local/validate_system.py` — all green.

**Schema:** v25 `email_messages` (EMAIL-007) and v26 `consumed_email_actions`
(EMAIL-006), both additive (decision 0011).

**Limitations / remaining risks**

- The live SMTP transport (`sendSmtpEmail`) and the Electron main-process secure
  storage / IPC are operator-verified at runtime; all logic ForgeLink relies on
  (validation, MIME, error mapping, signatures, anti-replay, persistence,
  export/retention, redaction, and the store encrypt/redact path) is covered by
  deterministic tests with injected fakes.
- Inbound is a provider-webhook path; IMAP polling was not implemented (the webhook
  satisfies "an explicit inbound option such as IMAP polling or provider webhook").

**Rollback:** all additions are behind disabled-by-default config (email registers
only when SMTP is set; inbound and quick-actions only when their secrets are set);
reverting the commits removes the surfaces. Schema v25/v26 are additive tables with
no destructive migration to undo.
