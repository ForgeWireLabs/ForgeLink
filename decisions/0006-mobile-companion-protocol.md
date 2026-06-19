---
id: 0006
title: ForgeLink Mobile Companion Protocol (design)
status: accepted
date: 2026-06-18
supersedes: []
---

# 0006: ForgeLink Mobile Companion Protocol (design)

## Context

Work item 015 (CLV-005) calls for a first-party mobile companion as the native,
non-SaaS path for the primary human loop: an operator should be able to approve
or deny an agent request from their phone without routing private decisions
through SMS or a third-party chat provider. This record is the **design**; the
desktop ships only a disabled planning gate for it (CLV-006), and a full mobile
client is a later product.

## Decision

A LAN-first, end-to-end-authenticated companion where **the desktop is the source
of truth** and the phone is a **decision terminal**, not a data mirror.

### Identity & key exchange
- The desktop holds a long-lived device keypair (Ed25519) in OS-backed secure
  storage. Each paired phone generates its own Ed25519 keypair on-device.
- **Pairing (QR):** the desktop shows a QR encoding `{desktop_public_key,
  lan_address, pairing_nonce, expiry}`. The phone scans it, generates its keypair,
  and completes a short authenticated key exchange (X25519 ECDH for a session
  key, signed by both device keys) over the LAN. The pairing nonce is single-use
  and short-lived. The desktop records the phone as a `paired_device`
  (display name, device public key, pairing state, last seen).
- No account, no cloud, no shared secret typed by hand.

### Transport
- **LAN companion (v1):** the phone talks to the desktop's loopback/LAN service
  over TLS on the local network; messages are additionally signed with device
  keys. This is distinct from, and does not depend on, any relay.
- **Future relay (separate decision):** an optional store-and-forward relay for
  off-LAN reach would be its own design with its own threat model. It is **out of
  scope here** and must never be enabled implicitly. The protocol carries an
  explicit `transport: lan | relay` field so the two are never conflated.

### Decisions & redaction
- The desktop sends the phone an **approval card** carrying only what the
  operator's redaction profile allows (intent, risk, a short summary) — never raw
  evidence by default. Notifications use the mobile/lock-screen redaction profile.
- The phone returns a **signed decision** (`approve | deny | defer |
  request-more-info | short reply`) bound to the request hash and signed by the
  device key. The desktop verifies the signature before recording the decision in
  the local decision/audit trail. This works for agent approvals with no SMS and
  no external chat provider.

### Revocation & lost device
- The operator can revoke a paired device on the desktop (sets `revoked_at`);
  revoked device keys are rejected immediately.
- Lost-device handling: revoke + rotate the desktop device key (re-pair survivors).
  Pending requests targeted at a revoked device fall back to desktop approval.

## Alternatives considered
- **SMS/Push-only approvals.** Rejected as the primary loop: leaks decisions
  through a telecom/third-party provider and can't carry signed decisions.
- **Cloud-account companion.** Rejected for v1: contradicts ForgeLink's
  local-first, no-SaaS posture; a relay, if ever built, is opt-in and separate.
- **Full data mirror on mobile.** Rejected for v1: the phone is a decision
  terminal; mirroring the private database multiplies the attack surface.

## Consequences
- The desktop remains the source of truth; the phone never needs the full local
  database to make a decision.
- Agent approvals can be completed off the desktop without SMS or external chat.
- The desktop ships a disabled, authenticated companion planning gate (CLV-006);
  implementing the LAN client, pairing UI, and `paired_devices` storage is later
  work (017 covers the mobile decision UX). Signed decisions tie into the 016
  governance audit chain and its key management (AGH-025).
