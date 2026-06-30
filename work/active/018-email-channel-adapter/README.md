---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-29
source_of_truth: work/active/018-email-channel-adapter/README.md; work/active/018-email-channel-adapter/work-item.json
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
| 2026-06-29 | EMAIL-005/007 complete | Added the email-channel configuration UI (Settings → Email channel: redacted status from `GET /api/channels/email/status`, env-config guidance, "fallback, not the default approval loop, grants no approval privileges" note, and a pointer to contact email identities). Contact email identities already exist via contact points (kind: email). Data safety: schema v25 `email_messages` table records sent email as private comms data; `recordEmailMessage`, `POST /api/email/send` (launch-only, records on send), and inclusion in `exportData()` + `applyRetention()`; backup is whole-DB. Diagnostics expose only the `email_configured` boolean (no host/address/credentials). `docs/email-channel.md`; backend build, email/server/database tests (incl. export+retention participation, redacted status, launch-only routes), 38 renderer tests, full Electron suite, and RepoPact/local validation passed. | EMAIL-005 and EMAIL-007 satisfied (evidence 20260629-email-005-007-config-data-safety). Remaining: EMAIL-002 secure-storage UI, EMAIL-004 inbound ingest, EMAIL-006 quick-actions. |
| 2026-06-29 | EMAIL-001/003/008 complete | New provider-neutral email adapter (`Electron/backend/src/email.ts`): outbound/inbound contracts, attachment bounds, MIME assembly, redacted retryable/permanent failure classification, credential validation, and disabled state. Outbound `email_send` adapter registered in the channel registry when SMTP is configured (`FORGELINK_SMTP_*`), with a deterministic test matrix (`email.test.ts`, in `npm test`) for success, provider rejection, missing credentials, invalid recipient, attachment bounds, and retryable vs permanent failure — using an injected fake transport (the default `sendSmtpEmail` client is operator-verified live). `/api/diagnostics` reports `email_configured` as a boolean only (no host/address/credentials). Documented in `docs/email-channel.md` (operator setup, privacy limits, provider requirements, failure modes, testing strategy, shipped vs deferred). Backend build, email tests (12), server tests, full Electron suite, and RepoPact/local validation passed. | EMAIL-001, EMAIL-003, and EMAIL-008 satisfied (evidence 20260629-email-001-003-008-outbound-adapter). Remaining: EMAIL-002 secure-storage UI, EMAIL-004 inbound ingest, EMAIL-005 UI, EMAIL-006 quick-actions, EMAIL-007 full data-safety. |

