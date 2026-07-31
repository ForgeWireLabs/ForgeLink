---
id: 0013
title: Ghost Fabric Channel — Provider-Less Peer Communication Across the Cluster
status: deferred
date: 2026-06-23
supersedes: []
---

# 0013: Ghost Fabric Channel — Provider-Less Peer Communication Across the Cluster

## Disposition: still deferred — need affirmed, direction settled, sequenced behind 031/032 (2026-07-31)

**The need is confirmed and the design direction is settled. The timing is not.**

On 2026-07-31 the operator confirmed the operator-need case below, and added a
binding constraint: build it in-product, add **no new dependency for the operator or
for potential customers**, and have ForgeLink and ForgeWire Fabric work *the same
way* — potentially via a shared Rust crate released on its own.

A ledger review the same day found that starting that work now conflicts with the
project's own sequencing discipline:

- All five active items (011, 024, 031, 032, 037) are production-hardening and
  shell-retirement work. None is a new external-facing capability.
- Work items 020, 021, and 022 (Telegram, WhatsApp, Discord) were deferred on
  2026-07-10 for the reason *"higher-priority local-first adapter, linked-node
  hardening, and Tauri retirement work should complete before adding another external
  provider."* A cross-repo networking layer is a substantially larger commitment than
  any of those adapters.
- Work item 031's first criterion (LNH-001) is six implementation slices deep and
  still pending; 037 has one of fourteen criteria satisfied; Electron is not yet
  removed and the public signing gate is still open.

The lane therefore **remains deferred**, and the groundwork it depends on is split
into work item
[039](../work/active/039-shared-node-identity-and-transport-contract/README.md)
(shared node identity + transport contract), which is useful on its own merits
regardless of whether this lane is ever built.

### What the 2026-07-31 review settled (so it need not be re-derived)

1. **Topology: client→server, not a mesh.** Both products are already
   client/server — Fabric's `fabric-client` is a *"Typed HTTP client for the
   ForgeWire Fabric hub API"*, and ForgeLink's cockpit is a client of its authority
   node's backend. Only one side must be reachable, which removes NAT hole-punching,
   STUN/TURN, and peer discovery from the problem entirely. This is **not** a VPN
   requirement, and building mesh/IP-layer semantics would be wasted work.
2. **A rendezvous point is unavoidable.** Two hosts behind NAT cannot connect
   unaided. Every option — cloudflared quick tunnel (zero setup, already ships per
   work item 014), an operator-run relay, or hole punching — requires some publicly
   reachable point, and hole punching still needs relay fallback. Tailscale ships
   DERP for exactly this reason. Any design claiming otherwise is hiding its relay.
3. **Adopt connectivity, do not build it.** If the lane is reactivated, evaluate an
   established Rust library (for example `iroh`: QUIC, ed25519 node identities,
   hole punching with relay fallback) rather than implementing traversal and a relay
   protocol in-house. Writing that layer is specialist, multi-month work where a
   subtle bug is a silent security failure. Sealing must use a vetted library
   (Noise/libsodium/QUIC-TLS), never a custom construction.
4. **ForgeLink is not a cluster.** Work item 031 states plainly that linked nodes are
   *"not a cluster, distributed database, failover topology, or automatic trust
   relationship."* Fabric **is** a cluster (hub, runners, `fabric-store-rqlite`). Any
   shared crate must serve both without importing Fabric's cluster assumptions into
   ForgeLink.
5. **The private-data gate already specifies the transport.** The WI019 private-data
   sync policy gate requires authenticated encryption, link-scoped key material,
   replay protection, stale/revoked-link rejection, wipe support, and rollback support
   before any private data moves. The lane is therefore genuinely on the critical path
   for cross-device private data — it is a sequencing question, not a dead end.

### Reactivation criteria (revised 2026-07-31)

Reopen as a new active work item when **all** hold:

- work item 032's Electron retirement gate is satisfied and 031's threat review
  (LNH-012) has landed;
- work item 039 has delivered shared node identity and the transport contract, so the
  remaining question is backend selection rather than protocol design;
- the connectivity backend is an adopted, vetted library rather than an in-house
  traversal/relay implementation;
- work item 031's LNH-013 private-data readiness decision is recorded with evidence
  before any private communication content rides the lane.

The original 2026-06-23 deferral rationale and reactivation criteria are preserved
below for lineage; the criteria above supersede them.

## Reachability options (recorded 2026-07-31, not selected)

Retained as analysis for a future reactivation. **No option is selected**, and no
connectivity backend is authorized by this record.

Under the operator's no-new-dependency constraint the candidates are:

- **cloudflared quick tunnel** — zero setup and already shipped in-product for
  webhooks (work item 014), no account required; but it is a free service with no
  SLA, HTTP-only, its URL rotates per launch, and Cloudflare terminates TLS, so it is
  only acceptable if payloads are sealed end-to-end so the tunnel carries ciphertext
  and routing metadata only.
- **An operator-run relay** — stable and fully controlled, blind by construction, but
  it is infrastructure to operate, and shipping it to customers turns it into a
  hosted service commitment.
- **Adopted P2P with relay fallback** — direct connection where NAT allows, relay
  otherwise; the best fit for "from anywhere," and the reason to adopt rather than
  build.

Whatever is chosen, three constraints hold: end-to-end sealing is mandatory (the
relay must be blind by construction, never by promise); enabling the lane must be
explicit opt-in, since it would start public surface for operators who currently have
none; and decision [0003](0003-public-webhook-ingress-boundary.md)'s rule that
`/api/*`, `/health`, and control routes are never served over the tunnel must not be
weakened.

## Disposition: deferred — not on the roadmap (2026-06-23, superseded)

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

### Update (2026-07-31): the substrate now exists; the original criteria are met

Since the 2026-06-23 deferral, the foundation this record was waiting on has been
built — under a different name. It is worth re-reading the three reasons above
against today's tree:

- **Reason 1 (unbuilt foundation) is resolved.** AGH-025 key management shipped as
  [0016](0016-decision-audit-key-management.md): a `device_keys` registry, Ed25519
  in OS-backed secure storage, and honest rotation/revocation/recovery semantics.
  Active work item
  [031](../work/active/031-linked-node-metadata-transport-and-trust-hardening/README.md)
  is extending that into full **production node identity** (LNH-001) with a
  generation-scoped encrypted local vault.
- **Reason 2 (a transport/crypto project) is largely resolved.** 031 is building
  exactly the piece this record feared having to home-roll: canonical signed
  envelopes (LNH-002/003, Ed25519), durable replay protection (LNH-004),
  metadata checkpoints (LNH-005), a **bounded authenticated metadata transport**
  (LNH-007), quarantine/change-set handling (LNH-008), and operator trust/revoke/
  relink surfaces (LNH-009) — with a full threat review (LNH-012) as a gate. The
  "blind relay + bespoke handshake" this record described is **superseded**: the
  ghost lane should ride 031's authenticated transport, not invent its own. That is
  precisely what reactivation criterion 3 demanded.
- **Reason 3 (smaller kernel) is now literally true.** With 031 owning identity,
  crypto, and transport, the ghost channel is no longer "build a messaging network."
  It collapses to one question: **may a *private-communication* data class ride the
  linked-node transport?**

That question already has a home. 031 is **metadata-only by constitution** — its
non-goals forbid message bodies, and **LNH-013** requires *"a separate evidence-based
private-data readiness decision"* before any private communication data moves;
closing 031 must not enable it automatically. **This record is that decision's
subject.** The ghost fabric channel, reactivated, is not a standalone build — it is
the LNH-013 private-data readiness decision, argued and gated.

Scorecard against the reactivation criteria:

| Criterion | Status (2026-07-31) |
| --- | --- |
| AGH-025 key management shipped | **Met** — [0016](0016-decision-audit-key-management.md); extended by 031/LNH-001 |
| Re-scope onto existing transport + vetted crypto, no bespoke relay/handshake | **Met** — ride 031's authenticated Ed25519 metadata transport |
| Concrete operator need the agent-channel and Fabric-HITL paths do not meet | **Met** — operator confirmed 2026-07-31 |

This update does **not** flip the status. The original three criteria are met, but
the 2026-07-31 ledger review added sequencing as the binding constraint — see the
revised reactivation criteria in the disposition at the top of this record. What
changed here is that the remaining blocker is priority and groundwork, not missing
infrastructure or an unproven need.

## The operator-need case (criterion 3)

Criterion 3 asks for a concrete operator need that the existing provider-less paths
do not already meet. Here it is, stated as an argument the operator can accept or
reject — not as a need already asserted.

**The gap: no path carries private communication *content* between the operator's
own nodes without a third party.** Every channel that carries bodies is a provider;
every provider-less cross-host path is content-free by design. The intersection is
empty:

| Path | Carries real content? | Provider-less? | Cross-host / off-LAN? |
| --- | --- | --- | --- |
| SMS/MMS, email, Telnyx/Twilio | Yes | **No** — third party holds plaintext | Yes |
| Agent-channel / Fabric-HITL ([0004](0004-agent-facing-governance-contract-and-fabric-hitl.md)) | Approval-shaped only | Yes | Loopback/local |
| Push ([019](../work/completed/019-push-notification-channel/README.md)) | **No** — redacted by design | Yes | Yes |
| Linked-node transport ([031](../work/active/031-linked-node-metadata-transport-and-trust-hardening/README.md)) | **No** — metadata-only by non-goal | Yes | Yes |
| **Ghost fabric channel** | **Yes** | **Yes** | **Yes** |

Why the provider-less paths genuinely fall short:

1. **Fabric-HITL is a governance lane, not a comms lane.** It is request → decision
   → outcome. An operator cannot use it to send a paragraph, an artifact, or a
   context note to their own other machine, and it is machine→human, not
   human↔human or free-form human↔agent.
2. **Push is intentionally content-free.** [019](../work/completed/019-push-notification-channel/README.md)
   redacts by design; it is an attention ping, not a message.
3. **Linked-node is metadata-only by constitution.** 031 moves identity, lifecycle,
   and status — never bodies — and holds that line behind LNH-013.

**The concrete need is created by a decision the team already made.**
[0017](0017-mobile-is-a-full-cockpit.md) commits to mobile as a *full operator
cockpit* and, in §4, forbids a private-data mirror: mobile is a **client** of the
operator's local data over an authenticated connection, not a replicated database.
Today that authenticated connection is the *local* one. The unanswered question:
**when the phone is off-LAN, how does the full cockpit reach its own backend's
content — privately, without a telco?** There is no answer in the current tree. The
ghost lane is that answer: the provider-less, authenticated, cross-internet
transport that makes "full mobile cockpit, anywhere, no provider" actually true.
0017 §6's future "remote operator control surface" needs the same lane.

**The framing that keeps this inside existing boundaries.** This must be transport
for a **live client session reaching the operator's own backend**, not
node-to-node content *replication*. Framed as "sync my messages to my phone," it
collides head-on with the 030/0017 no-replication boundary. Framed as "the
authenticated pipe the off-LAN full-cockpit client uses to reach its single
source-of-truth backend," it is complementary and violates nothing.

**The honest counter-argument the operator must weigh.** The operator could instead
run a WireGuard/Tailscale mesh between their nodes and expose the local
authenticated backend over it — no product feature required. That is a real
alternative and it is cheaper. The case for building it into ForgeLink rests on two
claims: (a) it removes operator network setup, the same friction
[0003](0003-public-webhook-ingress-boundary.md)/013/014 worked to eliminate; and
(b) a VPN grants *network reach*, whereas the ghost lane grants *governed,
per-peer-trusted, revocable, audited* reach tied to the identity registry — a pipe
versus a policy. If neither claim matters to the operator, a VPN is the right answer
and this record should stay deferred. That judgment is criterion 3's real content.

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
