# WI042 Agent Contract — ForgeLink Product Identity

Read the repository root `AGENTS.md` and this work item's `README.md` before changing any documentation, product narrative, diagrams, UI copy, MCP persona/resources, or product-definition language under WI042.

## Scope

WI042 owns current ForgeLink product-definition and narrative alignment. It does not own communication runtime implementation, fax implementation, ForgeWire architecture, or wholesale UI redesign.

## Binding product identity

For WI042, treat this semantic definition as authoritative unless a later explicit product decision supersedes it:

> ForgeLink is a local-first communications, coordination, and human-authority platform for people, agents, and applications. Humans use ForgeLink directly through its communications cockpit; agents and applications may use governed API/MCP/integration surfaces into the same platform.

The human is a first-class ForgeLink user, not merely an endpoint.

## Required distinctions

- Product identity is broader than the `forgelink-human` MCP component.
- Agent-human communication and approval remain core ForgeLink capabilities, but they are not the whole product definition.
- `forgelink-human` may continue to use narrow agent-facing human-bridge language when describing itself.
- Security/ingress/trust documents may continue to use technically precise boundary language.
- ForgeWire/Fabric integration is optional and must not be described as a prerequisite for direct ForgeLink use.
- Human-operated communications must not be routed through MCP or an agent merely to fit legacy narrative.
- Provider adapters are external communication edges; they do not define the product.
- Human authority, attention policy, consent, decision records, audit, redaction, and retention remain first-class differentiators after the reframe.

## Historical integrity

Do not mechanically rewrite completed work items, evidence runs, decisions, or historically accurate reports to apply modern product vocabulary retroactively.

Classify narrative occurrences before editing:

```text
A. product-level and stale/misleading
B. subsystem-level and correct
C. historical record; preserve
D. technical boundary wording unrelated to product identity
E. ambiguous; requires explicit review
```

Search-and-replace across the repository is forbidden for terms such as `human boundary`, `human bridge`, `agent-human`, `boundary`, or similar phrases.

## Truthfulness

Do not turn broader positioning into roadmap inflation.

- Fax remains proposed/planned until WI041 proves implementation.
- Tauri/mobile production maturity remains governed by WI032.
- Provider/channel features must be labeled according to actual current maturity.
- Do not imply ForgeLink is a hosted SaaS product unless a separate architecture decision establishes that.
- Do not make HIPAA, PCI DSS, SOC 2, privacy, communications-law, or other certification/compliance claims from narrative cleanup.

## Before implementation

1. Confirm WI042 has been explicitly activated. While it remains under `work/proposed/`, refine planning only.
2. Inventory product-defining language across README, docs, diagrams/captions, current UI/onboarding/help strings, MCP persona/resources/docs, and relevant active/proposed work.
3. Classify every material hit before editing it.
4. Identify or create the canonical product-definition authority.
5. Reconcile public entry points first, then narrower subsystem documentation.
6. Keep direct-human and agent/application paths visible as separate valid entry paths into the same ForgeLink domains.

## Architecture guardrails

Do not use WI042 to:

- redesign communication state ownership;
- move provider credentials into ForgeWire or Fabric;
- implement fax or other channels;
- make GraphRuntime/AgentRun a ForgeLink dependency;
- rename ForgeLink;
- rename `forgelink-human` solely for narrative consistency;
- silently restructure the entire cockpit navigation;
- erase the human-authority model.

If narrative review discovers a real architecture problem, record it separately rather than hiding implementation inside documentation alignment.

## Evidence

Closeout evidence must include the narrative inventory/classification and demonstrate semantic consistency across at least:

- root `README.md`;
- the canonical product-definition document;
- `docs/public-narrative.md`;
- major product-level architecture diagrams/captions;
- MCP persona/resources that mention ForgeLink identity;
- representative direct-human and agent/application descriptions;
- applicable UI/onboarding copy;
- RepoPact and documentation/build validation.

A passing spellcheck or link check is not sufficient evidence for product-definition acceptance criteria.
