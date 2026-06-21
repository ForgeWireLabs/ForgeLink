---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
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

