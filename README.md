# ForgeLink

**A locally owned communications cockpit for people, agents, and applications.**

ForgeLink is a **local-first communications, coordination, and human-authority platform**. Humans can use it directly to communicate, manage people and channels, review history, and control communication policy. Agents and applications can participate through governed local interfaces without taking ownership of the operator's communication state, attention, or authority.

> **Humans are first-class participants. Software enters through governed boundaries. Providers are edges, not the product.**

[Canonical product definition](docs/product-definition.md) · [Operator cockpit](docs/operator-cockpit.md) · [Communications runtime](docs/communications-runtime.md) · [Agent governance](docs/agent-governance-contract.md) · [Work ledger](work/README.md)

**Latest packaged release:** [v2.0.1](https://github.com/ForgeWireLabs/ForgeLink/releases/tag/v2.0.1) · **repository version:** `2.0.3`

> `main` is ahead of the latest packaged release. Features described as current on `main` are not necessarily present in the v2.0.1 installer. Active work is called out explicitly below rather than presented as shipped.

<!-- README VISUAL SLOT: add one synthetic-data cockpit screenshot here once the current shared-cockpit visual baseline is refreshed. Prefer the real Decisions / People / Agents / Channels UI over an architecture illustration. -->

## Why ForgeLink exists

Communication software was built around people talking to people. Agent systems were largely built around software talking to software. Once those worlds meet, neither model is enough.

A person may want to send a message, place a call, manage a contact, or review communication history with no AI involved at all. At the same time, an agent may need to ask for approval, draft an external message, report an outcome, or request human attention. Those interactions should not require the human to surrender control of their inbox, credentials, communication history, or decision authority to the agent runtime.

ForgeLink puts those paths in one locally owned product.

```text
                         Human operator
                               |
                      ForgeLink cockpit
                               |
       +-----------------------+-----------------------+
       |                       |                       |
     People                 Channels               Decisions
  identity/trust       messages / voice /       authority / evidence /
  contact policy        external providers       approval / audit
       |                       |                       |
       +-----------------------+-----------------------+
                               |
                communications + coordination core
                               ^
                               |
                   governed API / MCP surfaces
                               |
                    +----------+----------+
                    |                     |
                  Agents              Applications
```

The older model of `Agent -> ForgeLink -> Human` is still an important ForgeLink use case. It is no longer an adequate definition of the product.

## The cockpit

ForgeLink organizes the operator experience around four first-class surfaces:

| Surface | Purpose |
| --- | --- |
| **Decisions** | Action-required requests, evidence, approvals, outcomes, replay, and operator authority. |
| **People** | Human contacts, relationship/trust context, communication points, policy, and history. |
| **Agents** | Agent identity, trust state, channel health, and advisory reputation without automatic authority. |
| **Channels** | Human and governed programmatic communication through supported message, voice, signal, and external-provider edges. |

This separation matters. A contact is not a provider. An agent is not an approval queue. A decision is not an ordinary chat message. A telecom service is not the center of the product.

Desktop and mobile work target the same shared cockpit model. Mobile is not intended to become a separate approval-only product; see [decision 0017](decisions/0017-mobile-is-a-full-cockpit.md).

## What makes ForgeLink different

### Local-first ownership

Private communication and decision state is owned locally. ForgeLink can operate without a telecom provider configured, and provider integrations do not become alternate owners of the local communication model.

### Human authority is a product primitive

Agentic systems can request attention or authority, but ForgeLink keeps the decision boundary with the operator. Structured requests can carry intent, risk, required authority, affected resources, evidence, expiration behavior, and explicit decision options.

Decision history is designed to be reviewable and replayable. Current guarantees are intentionally scoped: ForgeLink provides local tamper-evident audit linkage; it does not claim cryptographic non-repudiation merely because an audit chain exists.

### Attention is governed, not harvested

ForgeLink treats interruption as policy. Quiet hours, urgency, redaction, mute/block behavior, source policy, trust, and channel limits determine what is allowed to demand the operator's attention.

The goal is not to make agents more effective at interrupting people. The goal is to make human attention an explicit governed resource.

### Providers are replaceable edges

Twilio, Telnyx, MCP clients, ForgeWire, and other integrations connect to ForgeLink; they do not define it. The product owns the communication state, people, policy, authority, evidence, and local operational history that make those edges coherent.

### Standalone first, ecosystem-aware second

ForgeLink does not require ForgeWire, Fabric, RepoPact, an MCP client, or an LLM for ordinary human-operated communication. Those systems can integrate with ForgeLink when present, but they are not prerequisites.

## Current `main`

The current repository contains a substantial working product surface, including:

| Area | Current state on `main` |
| --- | --- |
| Desktop cockpit | Human-operated Decisions, People, Agents, Channels, setup, and settings surfaces. |
| Messaging | Provider-neutral channel architecture with Twilio and Telnyx SMS/MMS edges. |
| Voice | Twilio Voice integration with durable call history and reconciliation. |
| People | Rich contacts, contact points, channel identities, per-contact policy, and communication timelines. |
| Local data | SQLite-backed local persistence, drafts, delivery state, backup, restore, export, and retention tooling. |
| Attention policy | Quiet hours, urgency handling, redacted notifications, source/channel controls, and interruption policy. |
| Agent/application access | Authenticated local agent-channel API plus the `forgelink-human` MCP bridge. |
| Human authority | Structured approvals, evidence, risk tiers, authority scopes, trust state, decision records, replay, and audit linkage. |
| External-send governance | Communication firewall, consent ledger, redaction profiles, and draft-before-send behavior for governed agent-originated communication. |
| ForgeWire/Fabric | Optional human-in-the-loop integration; ForgeLink remains a separate product and does not execute distributed work. |

The exact packaged-release surface may lag `main`; use the relevant [release notes](https://github.com/ForgeWireLabs/ForgeLink/releases) when evaluating an installer.

## Active development

Two current transitions are especially important to the public product story.

**Tauri 2 production parity and Electron retirement — [WI032](work/active/032-tauri-production-parity-and-electron-retirement/README.md).** The current packaged desktop lineage is Electron-based, while ForgeLink is proving the Tauri shared shell, release paths, security boundaries, data-safety behavior, and platform parity before Electron is removed. Tauri is not treated as production-complete until the work item's acceptance evidence says so.

**First-class fax communications — [WI041](work/active/041-first-class-fax-communications-and-telnyx-fax-edge/README.md).** The provider-neutral fax domain, durable lifecycle, Telnyx outbound edge, authenticated webhook processing, inbound reception, and managed document acquisition are under active implementation. Fax is not presented here as a completed shipped capability until WI041 closes its remaining acceptance gates.

Precise project state belongs to the [RepoPact work ledger](work/README.md), not to a manually duplicated roadmap in this README.

## 30-second start

### Use the packaged Windows build

Download the current installer from [GitHub Releases](https://github.com/ForgeWireLabs/ForgeLink/releases/latest).

The latest packaged release is currently v2.0.1. Because `main` has moved significantly beyond that release, read its release notes for the exact feature set before comparing it with current repository documentation.

### Run current `main` from source

The currently supported desktop runtime remains under `Electron/` while WI032 completes the Tauri parity and retirement gate.

```powershell
cd Electron
npm install
npm start
```

Development requires Node.js 22 or newer.

ForgeLink can start local-only. Twilio and Telnyx accounts are optional communication-provider edges, not product prerequisites.

## Human communication and agent communication share one owner

A direct human workflow can begin and end entirely inside ForgeLink:

```text
Human -> ForgeLink -> communication domain -> provider/local edge -> recipient
```

A governed software workflow enters through an integration boundary:

```text
Agent/Application -> ForgeLink API or MCP -> policy/authority -> ForgeLink -> human/network
```

Both paths terminate in the same product model. Agents do not write directly to ForgeLink's private database and do not become alternate owners of human attention or operator decisions.

That gives ForgeLink a useful property: software can participate in communication without requiring communication to become software-owned.

## Agentic apps and MCP

The `forgelink-human` MCP package exposes the human-authority portion of ForgeLink to MCP-capable software including Claude Code, Codex, VS Code/Copilot, ForgeWire/Fabric, and other compatible clients.

It supports governed human messages, approval requests, action recording, bounded lookup/status flows, and file-backed credentials managed from ForgeLink. The MCP bridge is an integration surface into ForgeLink, not the definition of ForgeLink itself.

See [`mcp/forgelink-human/`](mcp/forgelink-human/) and [`install/mcp-configs/`](install/mcp-configs/) for integration details.

## Security and data ownership

ForgeLink assumes communications, identities, credentials, approvals, and decision evidence are sensitive.

The design therefore keeps private control routes authenticated and local, constrains public provider ingress, encrypts supported provider credentials through the desktop secure-storage boundary, hashes agent-channel credentials, redacts renderer and notification surfaces, treats agent-supplied content as untrusted, and records decision/audit state locally.

Public network exposure should remain narrow and intentional. Provider webhook/media ingress is separate from private control APIs, and local-only operation does not require a public tunnel.

Read the deeper contracts before deploying or integrating ForgeLink in a sensitive environment:

- [Ingress boundary](docs/ingress-boundary.md)
- [Communication firewall](docs/communication-firewall.md)
- [Agent governance contract](docs/agent-governance-contract.md)
- [Local integrations](docs/local-integrations.md)
- [Distribution and update strategy](docs/distribution-and-update-strategy.md)

Governance controls are not, by themselves, proof of legal or regulatory compliance.

## What ForgeLink is not

ForgeLink is not only an agent-to-human bridge, only an approval queue, a ForgeWire UI, a ForgeWire/Fabric worker, an LLM or agent runtime, an MCP server with a desktop wrapper, a telecom provider, a public social feed, or a requirement that humans communicate through agents.

It can expose MCP, integrate with ForgeWire, govern agent-human requests, and use telecom providers without being defined by any one of those integrations.

The binding product definition lives in [`docs/product-definition.md`](docs/product-definition.md).

## Development

For the current Electron runtime:

```powershell
cd Electron
npm test
npm run dev
```

The shared-cockpit/Tauri transition is governed by [WI032](work/active/032-tauri-production-parity-and-electron-retirement/README.md). Do not remove or bypass the Electron runtime merely because Tauri scaffolding launches; the recorded retirement gate requires production-parity evidence first.

Repository-wide validation and current work-state commands are documented in the [work ledger](work/README.md) and project-local governance files.

## Deeper technical references

- [`docs/product-definition.md`](docs/product-definition.md) — canonical answer to “What is ForgeLink?”
- [`docs/operator-cockpit.md`](docs/operator-cockpit.md) — operator model and cockpit behavior
- [`docs/communications-runtime.md`](docs/communications-runtime.md) — communications runtime and ownership boundaries
- [`docs/agent-governance-contract.md`](docs/agent-governance-contract.md) — governed agent/application behavior
- [`docs/approval-requests.md`](docs/approval-requests.md) — structured human approval model
- [`docs/communication-firewall.md`](docs/communication-firewall.md) — external-communication authority boundary
- [`docs/human-cards.md`](docs/human-cards.md) — local operator authority model
- [`docs/agent-identity.md`](docs/agent-identity.md) — agent identity and trust
- [`docs/killer-demo.md`](docs/killer-demo.md) — reproducible agent-governance demonstration
- [`docs/distribution-and-update-strategy.md`](docs/distribution-and-update-strategy.md) — packaging/update direction
- [`work/README.md`](work/README.md) — current RepoPact work state and evidence
- [`decisions/`](decisions/) — durable architectural and product decisions

## ForgeWire Labs

ForgeLink is independently useful, but it composes with the wider ForgeWire Labs ecosystem:

```text
ForgeWire / Fabric     executes and coordinates governed work
RepoPact               preserves engineering intent, authority, and evidence
ForgeLink              owns communications, coordination, and human authority
```

The systems are complementary rather than prerequisites for one another.

ForgeLink's job is the human and communications side of that boundary: give people a useful communications product of their own, then let software participate without quietly taking it over.
