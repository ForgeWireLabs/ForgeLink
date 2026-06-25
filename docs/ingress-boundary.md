---
audience: operators and reviewers
status: current
last_verified: 2026-06-24
---

# Public ingress boundary and residual attack surface

ForgeLink is local-first: the backend binds to loopback and the private API
requires a per-launch credential. The one place that boundary reaches the public
internet is the inbound webhook tunnel that lets a telecom provider deliver inbound
SMS/MMS and status callbacks. This document states exactly what is exposed, per
decision 0003, and is the boundary AGH-023 hardens and tests.

## What is public

- **Only `/webhooks/*`** (and provider-fetchable, entropy-named `/media/*`) are
  reachable through the tunnel. `/api/*`, `/health`, and every control route remain
  loopback-only and credential-gated, and are never served over the tunnel.
- **No tunnel in local-only mode.** When no telecom provider is configured, no
  tunnel starts and there is **zero** public surface.
- **Ephemeral, re-provisioned per launch** — quick-tunnel URLs rotate, so a stale
  URL is not a durable target.

## How the public routes are defended (AGH-023)

1. **Provider-signature authentication at the edge.** Every webhook request is
   provider-signature-validated (Twilio `X-Twilio-Signature`, proxy-aware against
   the configured public URL; Telnyx Ed25519 over `timestamp|body`) **before any
   handler logic runs**. Unsigned or invalid requests are rejected with `403` and
   no side effects.
2. **Rate limiting.** All `/webhooks/*` requests are bounded by a per-minute cap
   (120/min per process), enforced **before** signature handling, so a flood or a
   probing scan is shed with `429` rather than doing work.
3. **Route scoping.** Private routes are unreachable without the launch or MCP
   credential; an unauthenticated caller hitting `/api/*` over the tunnel gets
   `401`. The agent governance path (decision 0004) is local/loopback or via the
   agent channel — **not** this public ingress; the two ingress paths stay distinct.

## Residual attack surface

Enabling a telecom provider opens a **provider-only public ingress**: an internet
caller can reach `/webhooks/*` and provider-fetchable `/media/*`. They cannot pass
the signature check without the provider's secret, cannot reach `/api/*` or
`/health`, and are rate-limited. The practical residual risk is therefore limited
to (a) traffic that ForgeLink rejects at the signature gate (cost: a bounded amount
of work, mitigated by the rate limit) and (b) provider-fetchable media URLs, which
are entropy-named and carry no credentials. Operators who want zero public surface
can run local-only (no provider) or supply their own managed tunnel/`public_base_url`.

If a stable URL is ever required, a ForgeWire-hosted relay is the most likely
successor and would supersede decision 0003.
