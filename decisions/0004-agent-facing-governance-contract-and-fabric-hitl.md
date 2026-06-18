---
id: 0004
title: Agent-Facing Governance Contract and ForgeLink as Fabric's HITL Surface
status: accepted
date: 2026-06-18
supersedes: []
---

# 0004: Agent-Facing Governance Contract and ForgeLink as Fabric's HITL Surface

## Context

Work item 016 specifies a rich human side of the governance loop (Human Cards,
evidence packs, risk tiers, decision records, audit, redaction). The agent side
was thin: there was no concrete contract for how an agent submits an approval
request, awaits a decision, and receives the outcome (AGH-026).

ForgeWire Fabric already has a human-in-the-loop (HITL) approval pane. Agents
dispatching work through Fabric (`dispatch_prompt` / `dispatch_skill` /
`dispatch_tool` then `await_result`) hit that pane when human approval is needed.
ForgeLink is a purpose-built governed human boundary — evidence packs, audit
trail, redaction profiles, attention policy, and a mobile decision terminal — and
should be the superior surface for those approvals when it is present. The
operator's requirement: **Fabric's HITL approval should optionally pipe through
ForgeLink, and if ForgeLink is installed it should be automatic.**

## Decision

1. **Define one agent-facing approval contract** over ForgeLink's authenticated
   local API and MCP bridge: submit a structured approval request (AGH-006) with
   an evidence pack (AGH-007), await a decision, and receive a signed outcome
   (AGH-013/AGH-015). The contract specifies request shape, decision options,
   timeout/deferral behavior, and outcome reporting, and maps cleanly onto
   Fabric's `dispatch` / `await_result` lifecycle.

2. **ForgeLink becomes Fabric's HITL surface by auto-detection.** When ForgeLink
   is installed and reachable, Fabric routes HITL approvals to ForgeLink by
   default (its pane defers to ForgeLink's governed decision surface). This is
   automatic, not manual configuration.

3. **Optional with graceful fallback.** The operator can opt out (keep Fabric's
   built-in pane), and when ForgeLink is absent or unreachable Fabric falls back
   to its own pane with no loss of function. ForgeLink is an enhancement, never a
   hard dependency of Fabric.

4. **Decisions are governed and auditable.** Approvals routed through ForgeLink
   get evidence packs, risk classification, redaction profiles, the audit chain
   (AGH-016), replay (AGH-017), and mobile-companion delivery (017) — capabilities
   Fabric's built-in pane does not provide.

This is tracked in work item 016 as AGH-026 (the contract) and AGH-028 (the Fabric
HITL auto-pipe), and it depends on the untrusted-content handling in AGH-024 and
the key management in AGH-025.

## Alternatives considered

- **Keep HITL only in Fabric's pane.** Rejected: it forgoes ForgeLink's evidence,
  audit, redaction, and mobile decisioning — the whole point of 016/017.
- **Require manual configuration to route to ForgeLink.** Rejected: the operator
  asked for automatic behavior when ForgeLink is installed.
- **Make ForgeLink a hard dependency of Fabric HITL.** Rejected: Fabric must keep
  working standalone; ForgeLink is opt-in/optional with fallback.
- **A ForgeLink-defined protocol unrelated to Fabric.** Rejected: it would
  duplicate Fabric's dispatch/await lifecycle; the contract maps onto it instead.

## Consequences

- Agents get a concrete, documented approval contract instead of ad hoc prompts.
- With ForgeLink present, humans approve Fabric work in a governed, audited,
  mobile-reachable surface automatically; without it, Fabric is unchanged.
- Implementation spans two repositories: ForgeLink (the contract endpoints, MCP
  resources, decision/outcome flow) and forgewire-fabric (auto-detection and
  routing of its HITL pane to ForgeLink). The cross-repo coordination is part of
  AGH-026/AGH-028.
- Inbound to ForgeLink for this path is local/loopback or via the agent channel,
  not the public webhook ingress of decision 0003; the two ingress paths stay
  distinct.
