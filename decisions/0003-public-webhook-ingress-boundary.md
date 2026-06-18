---
id: 0003
title: Public Webhook Ingress Boundary for Inbound Messaging
status: accepted
date: 2026-06-18
supersedes: []
---

# 0003: Public Webhook Ingress Boundary for Inbound Messaging

## Context

ForgeLink is local-first: the service binds to loopback and the private API
requires a per-launch credential (INV-3-era posture). But inbound SMS/MMS from a
telecom provider (Twilio today) requires a publicly reachable HTTPS endpoint.
Work item 014 made this automatic by starting a cloudflared quick-tunnel on
connect and pointing the provider's webhook at `<tunnel>/webhooks/sms`.

That tunnel is the one place the "local boundary" leaks to the public internet.
Without an explicit boundary decision, the privacy framing across items 015-017
("private-first", "local-first") is contradicted by an undocumented public
ingress, and it is unclear what an arbitrary internet caller can reach. Work item
016 (AGH-023) tracks the hardening; this record fixes the boundary itself.

## Decision

Keep automatic inbound provisioning, but treat the tunnel as a **narrow,
provider-only ingress**, not general public exposure:

- **Only inbound webhook routes are public.** `/webhooks/*` (and provider-fetchable
  entropy-named media) are the sole routes reachable through the tunnel. `/api/*`,
  `/health`, and any control routes remain loopback-only and credential-gated and
  must not be served over the tunnel.
- **Authenticate at the edge by provider signature.** Every public webhook request
  is provider-signature-validated before any handler logic runs; unsigned or
  invalid requests are rejected without side effects.
- **Rate-limit and bound the public routes** against floods and probing.
- **No tunnel in local-only mode.** When no telecom provider is configured
  (the local-only path from CLV-020), no tunnel is started and there is zero
  public surface.
- **Ephemeral and re-provisioned per launch** (quick-tunnel URLs rotate), so a
  stale URL does not remain a target.
- **Document the residual attack surface** so operators understand that enabling a
  telecom provider opens a provider-only public ingress.

## Alternatives considered

- **Outbound-only (no inbound).** Rejected: inbound replies are core to a
  communications console.
- **User-managed tunnel only (manual webhook URL).** Kept as an override (manual
  `public_base_url` still wins), but rejected as the default because it
  reintroduces the setup friction items 013/014 removed.
- **ForgeWire-hosted relay with a stable URL.** Deferred (it needs that service
  and a trust/relay decision); revisit as a first-party option, see decision 0004
  for the related agent path.
- **Always-on public server / port forwarding.** Rejected: larger, persistent
  attack surface and operator network changes.

## Consequences

- Inbound works with zero configuration when a provider is enabled, while the
  public surface is limited to signature-validated webhook routes.
- Local-only ForgeLink has no public ingress at all.
- AGH-023 implements and tests the route scoping, signature gate, and rate limits;
  this record is the binding boundary those tests defend.
- If a stable URL is ever required, a ForgeWire-hosted relay is the most likely
  successor and would supersede this record.
