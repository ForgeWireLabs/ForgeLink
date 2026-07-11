---
audience: maintainers and implementation agents
status: deferred
last_verified: 2026-07-10
source_of_truth: work/deferred/021-whatsapp-business-channel/README.md; work/deferred/021-whatsapp-business-channel/work-item.json
---

# Work Item 021: WhatsApp Business Channel

## Goal

Add WhatsApp Business as a later official business-channel adapter for opted-in contacts. It should support ForgeLink's local contact, policy, and audit model without making WhatsApp the primary private operator boundary.

## Deferred Status

This work item remains valid but is intentionally deferred as of 2026-07-10.

**Reason:** Implementation depends on real business-account/provider prerequisites and a concrete opted-in deployment that do not yet exist.

**Reactivation condition:** Reactivate when a real business account and provider prerequisites exist, templates and opt-in requirements are understood, and a concrete deployment requires WhatsApp Business.

No implementation is authorized while this item is deferred. Its acceptance criteria
remain pending, and its work-item ID remains permanently reserved.

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

