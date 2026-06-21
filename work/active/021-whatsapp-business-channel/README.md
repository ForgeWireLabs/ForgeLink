---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/021-whatsapp-business-channel/README.md; work/active/021-whatsapp-business-channel/work-item.json
---

# Work Item 021: WhatsApp Business Channel

## Goal

Add WhatsApp Business as a later official business-channel adapter for opted-in contacts. It should support ForgeLink's local contact, policy, and audit model without making WhatsApp the primary private operator boundary.

## Scope

- Provider prerequisites and setup documentation.
- Secure credentials and webhook validation.
- Outbound/inbound text and delivery status normalization.
- Template and quality-limit awareness.
- Explicit contact linking and policy gates.
- Optional interactive quick actions only with signed local action verification.

## Non-Goals

- Do not bypass WhatsApp Business policy or opt-in requirements.
- Do not imply consumer WhatsApp support.
- Do not grant trust from a WhatsApp profile or phone number alone.
- Do not ship media before bounds, storage, retention, and diagnostics behavior are defined.

## Evidence Expectations

Evidence must include provider prerequisite docs, deterministic fixtures, signature validation, contact policy tests, UI disabled states, diagnostics redaction, and clear shipped/deferred docs.

