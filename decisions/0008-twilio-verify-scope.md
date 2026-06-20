---
id: 0008
title: Twilio Verify Scope
status: accepted
date: 2026-06-20
supersedes: []
---

# 0008: Twilio Verify Scope

## Context

SCOUT-2 referenced Twilio Verify alongside SMS/MMS and Voice. ForgeLink now has
a provider-neutral channel model, rich contacts, contact points, and contact
policy. Work item 015 CLV-014 requires a durable decision about whether phone
verification is shipped, deferred as a provider capability, or out of scope, and
requires that verification never grants trust automatically.

## Decision

Twilio Verify is **deferred as a future provider capability**. It is not shipped
in the current ForgeLink runtime, settings UI, call UI, or contact policy.

If phone verification is later implemented, it must be provider-neutral at the
ForgeLink boundary:

- A future `phone_verify` capability may be added to a provider adapter.
- Provider-specific concepts such as Twilio Verify service IDs, verification
  SIDs, channels, and attempt payloads must stay inside the provider edge.
- ForgeLink-owned data may record only a local verification event or
  contact-point verification timestamp, with redacted provider metadata.
- Verification cannot create a contact, unblock a contact, allow approval
  requests, allow urgent interrupts, or raise trust level by itself.
- Any trust change must be an explicit operator policy decision recorded through
  ForgeLink contact policy.

## Alternatives considered

- **Ship Twilio Verify now.** Rejected: the current item already restored
  provider-neutral SMS/MMS and Voice; Verify needs its own provider-neutral
  contract, UX, abuse controls, and data-retention treatment.
- **Declare phone verification permanently out of scope.** Rejected: future
  deployments may need contact-point verification, but it should be designed as
  a generic capability rather than Twilio-specific product logic.
- **Treat successful verification as trusted contact proof.** Rejected: phone
  control is not the same as operator trust, and unknown inbound contacts must
  not gain approval or urgent-interrupt privileges implicitly.

## Consequences

- No Twilio Verify credentials, routes, UI, or live calls are added by CLV-014.
- The Twilio provider documentation names Verify as deferred, not shipped.
- Future verification work must add a provider-neutral capability, deterministic
  tests, privacy notes, and explicit operator-policy controls before it can
  affect contact state.
