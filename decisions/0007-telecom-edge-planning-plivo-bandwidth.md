---
id: 0007
title: Telecom Edge Planning Gates — Plivo and Bandwidth
status: accepted
date: 2026-06-18
supersedes: []
---

# 0007: Telecom Edge Planning Gates — Plivo and Bandwidth

## Context

Work item 015 (CLV-008) requires planning gates for Plivo and Bandwidth as
additional SMS/MMS telecom edges, without presenting them as shipped until they
have adapters, contract tests, and docs. The channel registry already models
capabilities per provider; this records the intended mapping and the gate.

## Decision

Plivo and Bandwidth are **planned**, not shipped. They are surfaced as
`planned_channels` in `/api/diagnostics` (provider + kind + `status: "planned"`)
so the UI can show them as planned without registering broken adapters. A
provider is only registered as an active adapter once its adapter, contract
tests, and docs exist (as done for Twilio, and for Telnyx in CLV-007).

### Plivo (planned)
- **Send:** `POST https://api.plivo.com/v1/Account/{auth_id}/Message/`, HTTP Basic
  (auth_id / auth_token), JSON `{src, dst, text, media_urls?}`.
- **Credentials:** `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, a Plivo number.
- **Webhook validation:** `X-Plivo-Signature-V3` (HMAC-SHA256 over the URL + nonce),
  validated against the auth token.
- **Inbound/MMS:** form-encoded inbound (`From`, `To`, `Text`, `Media*`); MMS via
  media URLs. Delivery status via message-status callbacks.
- **Test fixtures:** deterministic send success/reject, inbound SMS/MMS, duplicate
  inbound, status update + backward/duplicate transition, invalid signature,
  missing credentials.

### Bandwidth (planned)
- **Send:** `POST https://messaging.bandwidth.com/api/v2/users/{accountId}/messages`,
  HTTP Basic, JSON `{from, to, text, media?, applicationId}`.
- **Credentials:** `BANDWIDTH_ACCOUNT_ID`, username/password, application ID, number.
- **Webhook validation:** Bandwidth callback authentication (basic auth or a
  shared secret on the callback URL), validated per Bandwidth's scheme.
- **Inbound/MMS:** JSON inbound events (array of message events); MMS via `media`.
  Delivery status via message delivered/failed events.
- **Test fixtures:** same matrix as Plivo.

## Alternatives considered
- **Implement all providers now.** Rejected: each carrier edge needs its own
  signature scheme, webhook shape, and test matrix; ship them one at a time
  behind the channel contract (Twilio shipped, Telnyx next).
- **Hide planned providers entirely.** Rejected: surfacing them as `planned`
  lets the operator see the roadmap without exposing half-built adapters.

## Consequences
- The registry/diagnostics represent Plivo and Bandwidth as planned; no broken
  adapter is registered.
- When implemented, each follows the Twilio/Telnyx pattern: a `ChannelAdapter`
  with send + inbound/status normalization + provider signature validation, a
  full contract test suite, and a `docs/<provider>.md`.
