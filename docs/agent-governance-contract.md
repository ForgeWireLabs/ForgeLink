---
audience: integrating agents and ForgeWire Fabric
status: current
last_verified: 2026-06-24
---

# Agent-facing governance contract (v1)

This is the concrete contract an agent uses to ask a human for a decision through
ForgeLink and learn the outcome — the agent side of work item 016. It maps cleanly
onto ForgeWire Fabric's `dispatch` / `await_result` lifecycle (decision 0004), so
Fabric can route its human-in-the-loop (HITL) approvals here (AGH-028). The
contract id is `agent-governance-v1`.

## Capability discovery (AGH-028)

Agents (and Fabric) detect that ForgeLink is present and can serve as the governed
HITL surface:

```http
GET /api/governance/capabilities          # MCP-safe (agent MCP token)
```

It returns `{ forgelink: true, governance: true, contract: "agent-governance-v1",
hitl_surface: true, features: [...], endpoints: { submit, await, outcome } }`. When
ForgeLink is absent or unreachable, Fabric falls back to its built-in approval pane
with no loss of function — ForgeLink is an enhancement, never a hard dependency.

## The loop: submit → await → outcome

### 1. Submit (AGH-006/007)

The agent submits a structured approval request with an evidence pack over its
agent-channel credential:

```http
POST /api/agent-channels/<channel_id>/messages
X-ForgeLink-Channel-Token: <channel credential>
{ "kind": "approval_request", "source": "<agent id>", "title": "...",
  "intent": "...", "requested_action": "...", "reason_for_interrupt": "...",
  "risk": "normal", "required_authority": "release_approval",
  "affected_resources": ["repo:ForgeLink"], "decision_options": [...],
  "evidence_pack": { "summary": "...", "diff_summary": "...", ... } }
```

ForgeLink ties the request to an agent identity (AGH-003), enforces trust
(AGH-004) and authority (AGH-002), classifies risk and routing (AGH-010..012),
and commits the request and evidence to the audit chain (AGH-016). Malformed
requests are rejected with actionable validation errors. Before interrupting, an
agent may **dry-run** with `POST /api/approval-requests/dry-run` to learn whether
approval is required, the estimated risk, missing evidence, and the preferred
channel.

All agent-supplied text is treated as **untrusted** (AGH-024): it is labeled
`provenance: "agent_unverified"`, sanitized for display, and never executed or
auto-trusted.

### 2. Await (AGH-013)

The agent polls its request's status over its MCP token. The view is **redacted**
by design — the agent learns whether a decision was made, the chosen option,
whether authority was granted, and the latest outcome, but never the operator's
identity, comment, or any evidence detail:

```http
GET /api/agent-messages/<id>/status       # MCP-safe
-> { id, status, decided, decision, authority_granted, outcome_state, final_state }
```

Timeout/deferral behavior is the request's own declared `timeout_behavior` /
`no_response_behavior` (AGH-011): an unanswered request expires and is audited; the
agent observes `status: "expired"` and `final_state` accordingly.

### 3. Outcome (AGH-015)

After acting on an approval, the agent reports what happened so dangling approvals
are visible and scope mismatches are flagged:

```http
POST /api/agent-messages/<id>/outcome     # MCP-safe
{ "outcome_state": "action_succeeded", "reported_resources": ["repo:ForgeLink"] }
```

The outcome is committed to the audit chain and the full lifecycle becomes
replayable by the operator (AGH-017).

## Why route Fabric HITL through ForgeLink

Approvals routed through ForgeLink gain evidence packs, risk classification,
redaction profiles (AGH-022), the tamper-evident audit chain, replay, the
communication firewall and consent gates for any external messages (AGH-019..021),
and mobile-companion delivery (017) — capabilities Fabric's built-in pane does not
provide. The two ingress paths stay distinct: this agent path is local/loopback or
via the agent channel, never the public webhook ingress of decision 0003.

## Cross-repo status

The ForgeLink side of this contract (the endpoints above, the capability
discovery, and the redacted await view) ships in this repository. The Fabric side —
auto-detecting ForgeLink and routing its HITL pane here with graceful fallback —
lives in `forgewire-fabric` and consumes `GET /api/governance/capabilities` plus
the submit/await/outcome endpoints. That cross-repo wiring is the remaining part of
AGH-028 and is coordinated through decision 0004.
