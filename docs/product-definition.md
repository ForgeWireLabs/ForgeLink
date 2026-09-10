---
audience: maintainers, integrating agents, and public readers
status: current
last_verified: 2026-09-10
source_of_truth: this document
---

# What ForgeLink Is (Canonical Product Definition)

This document is the single authority for "what is ForgeLink?" Other documents —
the root [`README.md`](../README.md), [`docs/public-narrative.md`](public-narrative.md),
MCP persona/resources, onboarding copy, and architecture diagrams — should use this
definition, summarize it accurately, or explicitly scope themselves as narrower
subsystem/use-case documents (see [Terminology levels](#terminology-levels) below).

This document is established by [work item 042](../work/completed/042-product-identity-and-communications-platform-narrative/README.md).

## The definition

> **ForgeLink is a local-first communications, coordination, and human-authority
> platform for people, agents, and applications.**
>
> Humans can use ForgeLink directly as a communications cockpit — no agent, no
> ForgeWire runtime, no MCP client, and no LLM required. Agents and applications
> can use governed local APIs and MCP to communicate, request human decisions, and
> interact with supported external communication networks, without taking
> ownership of the operator's communication state or authority.
>
> Channels and telecom providers are edges. ForgeLink owns the communication
> state, people/contacts, policy, human authority, decision evidence, and local
> operational history that make those edges coherent.

Three consequences follow from this, and they are binding unless a later explicit
product decision supersedes them:

1. **The human is a first-class ForgeLink user, not merely an endpoint.** A person
   can open ForgeLink and communicate, manage people and channels, place or
   receive supported calls/messages (and fax once [WI041](../work/active/041-first-class-fax-communications-and-telnyx-fax-edge/README.md)
   ships), review history, manage policy, and operate the product without any
   agent, ForgeWire runtime, MCP client, or LLM in the loop.
2. **Agents and applications are first-class participants, but not the definition
   of the whole product.** They access ForgeLink through governed local APIs,
   MCP, and future integration surfaces appropriate to their authority.
3. **Human authority remains a core differentiator.** Broadening the product
   identity does not erase the decision, approval, attention, consent, audit, and
   governance architecture that makes agentic use safe and useful.

## Topology

```text
                              ForgeLink

                    Human UI / shared cockpit
                              |
                 Communications + coordination core
                              |
        +---------------------+---------------------+
        |                     |                     |
     Messages               Voice                  Fax*
   SMS / MMS /             calls /               document
  email / push            call state           transmission
        |                     |                     |
        +---------------------+---------------------+
                              |
                   People / contacts / identity
                              |
             attention / policy / consent / authority
                              |
                 decisions / audit / retention
                              ^
                              |
                   API / MCP / integrations
                              |
                    +---------+---------+
                    |                   |
                  Agents            Applications
```

`*` Fax is proposed/in-progress under WI041 and is not a shipped capability until
that work item's acceptance evidence says so.

The older mental model:

```text
Agent -> ForgeLink -> Human
```

remains a valid description of some agent-facing components (notably the
`forgelink-human` MCP bridge) and a valid ForgeLink use case, but it is not an
adequate definition of ForgeLink itself.

## What ForgeLink is not

ForgeLink is not:

- only an agent-to-human bridge;
- only an approval queue;
- a ForgeWire UI;
- a ForgeWire/Fabric worker;
- an LLM or agent runtime;
- an MCP server with a desktop wrapper;
- a telecom provider;
- a social/engagement feed;
- a requirement that humans communicate through agents;
- proof of legal/regulatory compliance merely because governance controls exist.

It can expose an MCP server, integrate with ForgeWire, govern agent-human
requests, and use telecom providers without being defined by any one of those
integrations.

## Terminology levels

### Level 1 — Product identity

Used when answering "What is ForgeLink?" or describing the whole product. Use the
definition above. Do not define the whole product solely as an agent-to-human
bridge, a human endpoint for agents, a place where only systems ask and humans
decide, a ForgeWire human interface, an MCP communications bridge, or an approval
application with telecom adapters. Those statements may correctly describe a
subsystem or use case, but not the whole product.

### Level 2 — Product subsystems and use cases

Narrow descriptions remain correct when they describe the actual component. For
example, `mcp/forgelink-human` may be described as an agent-facing human bridge;
the agent-channel API may be described as an agent-to-human/governance surface;
approval flows may be described as agent-human governance. These documents should
add enough context that a reader does not accidentally redefine the whole product
from them — for example, by noting that the component exposes the human-authority
portion of the broader ForgeLink communications platform, rather than asserting
unqualified that "ForgeLink is the private human boundary."

### Level 3 — Historical records

Completed work items, evidence runs, historical reports, and decision records are
durable history. Do not rewrite historical facts to apply this vocabulary
retroactively. Historical records may be annotated or linked to this document
where confusion would otherwise be material, but their original meaning and
evidence must remain intact.

## Documentation truthfulness rule

Every product document must distinguish shipped/current, active implementation,
proposed/planned, and conceptual/future capabilities. Broader product positioning
must never be used to imply an unshipped capability (e.g. fax before WI041 lands,
or Tauri/mobile production maturity before WI032 proves it) is already available.

## Future-drift guardrail

> **No current product-level document may define the entire ForgeLink product
> solely in terms of an agent, system, or application reaching a human.
> Human-operated communications are a first-class product capability, and
> agent/application integration is a governed additional interface into the same
> platform.**

Apply this invariant when writing or reviewing product-level documentation
(README, public narrative, top-level architecture diagrams, onboarding). It does
not apply to, and must not be used to reject, legitimate subsystem, security,
ingress, or trust-boundary language (for example, "ingress boundary," "private
loopback API," or `mcp/forgelink-human` describing itself as a human bridge).
