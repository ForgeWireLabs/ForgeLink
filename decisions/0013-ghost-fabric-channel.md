---
id: 0013
title: Ghost Fabric Channel — Provider-Less Peer Communication Across the Cluster
status: deferred
date: 2026-06-23
supersedes: []
---

# 0013: Ghost Fabric Channel — Provider-Less Peer Communication Across the Cluster

## Disposition: deferred — not on the roadmap (2026-06-23)

This record is `deferred` (the status added by decision
[0014](0014-deferred-decision-status.md)): kept for its reasoning rather than
adopted as roadmap. The motivation — a
provider-less peer lane where no third party holds plaintext — is sound, and the
ingress-class analysis below stands. It is **deferred** rather than pursued for
three reasons:

1. **It builds on an unbuilt foundation.** The design makes **AGH-025** key
   management load-bearing, but AGH-025 is still pending. Peer authentication and
   key exchange cannot be designed concretely until that lands.
2. **As written it is a transport/crypto project, not a channel adapter.**
   Provider-less, end-to-end-encrypted, NAT-traversing peer messaging with a blind
   relay is Signal/Matrix/WireGuard/libp2p territory — key exchange, NAT traversal,
   forward secrecy, replay protection, and a relay to operate. That is
   disproportionate to ForgeLink's product center (local-first human/agent
   governance), where channels are explicitly *edges*, and it invites the worst
   failure mode: home-rolled end-to-end crypto.
3. **The viable kernel is much smaller.** ForgeLink already rides the operator's
   ForgeWire mesh (`forgewire-fabric` routing, `forgewire-loom` host reach). If the
   peer lane **rides that existing authenticated transport** instead of building a
   relay and a bespoke key-exchange scheme — and leans on an established library
   (Noise / libsodium / WireGuard) for any encryption rather than a custom
   protocol — the scope collapses from "build a messaging network" to "define an
   ingress class over transport we already operate."

### Reactivation criteria

Reopen this (as a new active work item, not by editing a shipped step) when **all**
hold: AGH-025 key management has shipped; there is a concrete operator need for
cross-host peer comms that the existing agent-channel and Fabric-HITL paths do not
meet; and the design is re-scoped to ride existing ForgeWire transport with a
vetted crypto library, with no bespoke relay or handshake built in-house. The
design below is the shape to start from **if** those hold — not a commitment to
build it.

## Context

Every channel on the [0009](0009-channel-roadmap-and-matrix-exclusion.md) roadmap
routes through a third party that carries the packets — Twilio/Telnyx for SMS/MMS,
a mail provider for email, a bot platform for Telegram/Discord. Each one adds a
provider that can see message bodies and metadata, plus provider credentials,
policy, and outage as failure modes. The product invariant has always been that
external services *carry* packets but do not *own* the model.

The operator wants a channel with **no provider in the path at all**: no 10DLC
number, no Twilio, no telecom or SaaS intermediary. The transport is the
ForgeWire mesh itself (`forgewire-fabric` task/notes routing, `forgewire-loom`
host reach). Peers are ForgeLink instances and the agents/runners on the cluster.
"Ghost" here means *provider-less* — it does not mean ephemeral. ForgeLink's
durable, audited local state is preserved.

A hard requirement sharpens the design: **this must work outside the local
network.** Peers communicate across the public internet, not just a LAN. That
removes "nothing leaves your hardware / leak surface is the LAN" as the privacy
story. Packets cross a public wire between machines the operator owns, so privacy
must come from **end-to-end encryption and mutual peer authentication**, not
network isolation. This is precisely the end-to-end verification surface that
[0009](0009-channel-roadmap-and-matrix-exclusion.md) cited when it excluded
Matrix — but the threat model here is smaller, because there is no provider to
trust, only the wire and a blind relay.

This crosses existing boundaries. [0003](0003-public-webhook-ingress-boundary.md)
defines a narrow, provider-signature-validated *webhook* ingress and explicitly
**defers** a "ForgeWire-hosted relay with a stable URL" as the likely successor
when a stable public URL is needed. [0004](0004-agent-facing-governance-contract-and-fabric-hitl.md)
keeps agent inbound *loopback-or-agent-channel*, distinct from public webhook
ingress. A peer channel spanning remote hosts is neither path — it is a third
ingress class that must be defined, not left implicit, or it becomes an
undocumented hole in the model (INV-1, INV-5).

## Proposed shape (deferred — see Disposition above)

If reactivated under the criteria above, the channel would take this shape: a
**ghost fabric channel**, a provider-less, end-to-end-encrypted peer communication
lane where ForgeLink instances (and the cluster's agents/runners) are the peers,
and the "provider" is the operator's own ForgeWire mesh. The re-scope note in
Status applies — ride existing ForgeWire transport and a vetted crypto library
rather than build a relay or handshake in-house.

1. **A new, explicit ingress class: the peer channel.** It is distinct from the
   provider-webhook ingress (0003) and the loopback/agent path (0004). 0003 and
   0004 are updated to name it so the three ingress paths stay documented and
   distinct. Like 0003, it is **off by default**: a local-only deployment opens
   zero peer surface.

2. **End-to-end encryption is mandatory; reachability is a blind relay.** Bodies
   are encrypted between named peers. Cross-NAT / public-internet reachability is
   provided by a ForgeWire relay (the successor 0003 deferred), but the relay is
   **blind** — it brokers connectivity and sees only routing metadata, never
   plaintext. A relay that could read content would reintroduce exactly the
   provider this channel exists to remove.

3. **Peers are first-class identities under the existing trust model.** Each peer
   reuses the [agent identity registry](../docs/agent-identity.md): a stable id,
   `owner`, `signing_key_ref`, and a `trust_state`. No peer joins trusted; unknown
   is the default. This cashes the **AGH-025** key management that the identity
   registry has been deferring — peer authentication makes real keys load-bearing.
   Messages carry identity, intent, urgency, and an audit trail, satisfying INV-5.

4. **Private-first audit, not body logging.** Consistent with INV-4, the channel
   records routing/governance metadata and decisions, never message bodies, in the
   clear. "Ghost" removes the provider; it does not remove the audit trail, but the
   audit trail follows the same redaction posture as every other channel.

5. **Quick actions / approvals are gated, not ambient.** A peer channel may carry
   Fabric HITL approvals (the 0004 path), but only as signed actions bound to a
   local pending action, time-bounded, and only from a `trusted` peer — the same
   stance 0009 takes for every channel's quick actions. Peer membership grants no
   approval authority by itself.

## Alternatives considered

- **Reuse the 0003 public webhook ingress.** Rejected: that ingress is a single,
  provider-signature-validated, request/response webhook route. Peer comms is
  bidirectional, persistent, and authenticated by operator-held keys, not a
  provider signature; folding it into the webhook path would blur a boundary 0003
  deliberately drew narrow.
- **LAN-only peer channel.** Rejected: the explicit requirement is to work outside
  the local network. A LAN-only channel does not meet it.
- **Direct peer-to-peer with no relay (port forwarding / static IPs).** Rejected:
  brittle across NAT and dynamic IPs, and it forces operator network changes and a
  persistent listening surface — the same reasons 0003 rejected an always-on public
  server.
- **Trust the relay with plaintext (provider-style hub).** Rejected: this
  reintroduces a third party that holds message content. It is Twilio by another
  name and defeats the entire premise. The relay must be blind by construction.
- **A bespoke peer trust model separate from agent identities.** Rejected:
  duplicates the registry, trust states, and key references already built for
  AGH-003/AGH-004/AGH-025. Peers reuse that model; only the ingress boundary is new.

## Consequences

- ForgeLink gains the most private channel on its roadmap: no third party ever
  holds plaintext, because there is no third party. It out-local-firsts the
  local-first channels by removing the provider entirely.
- AGH-025 key management becomes load-bearing rather than deferred. Real peer
  authentication and key exchange are now prerequisites, not nice-to-haves.
- A third ingress class exists. 0003 and 0004 must be amended to reference it, and
  the residual attack surface of the relay must be documented the way 0003
  documents the tunnel (INV-1).
- End-to-end encryption + mutual auth is a genuine verification surface — the cost
  0009 warned about. "Private" cannot be claimed until conformance/E2E tests defend
  it (INV-3, INV-4). This is the gate before the channel ships.
- A blind relay is new ForgeWire infrastructure with its own availability and abuse
  considerations, but by construction it cannot read content, so a relay compromise
  exposes routing metadata, not messages.
- Off by default; local-only deployments keep zero peer surface, mirroring 0003.
- Likely follow-up work items: peer transport + key exchange, the blind relay /
  reachability broker, the peer identity/trust extension, end-to-end conformance
  tests, and operator setup docs. None of these is shipped until it has an
  implementation, key validation, conformance tests, and operator setup — the same
  bar 0009 sets for every channel.
