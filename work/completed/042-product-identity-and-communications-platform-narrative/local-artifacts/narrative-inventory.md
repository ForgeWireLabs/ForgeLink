# WI042 narrative inventory and classification

Search performed 2026-09-10 across the repository (excluding
`work/completed/**`) for the terms called out in the WI042 README:

```text
human boundary | human bridge | agent-human | agent-to-human | agent to human |
systems ask | system asks | human decides | ForgeWire bridge | MCP bridge |
private boundary
```

49 files matched. Each is classified below using the WI042 taxonomy:

```text
A. product-level and stale/misleading
B. subsystem-level and correct
C. historical record; preserve
D. technically descriptive boundary wording unrelated to product identity
E. ambiguous; requires human/product decision
```

## A — product-level and stale/misleading (edited)

| File | Finding | Resolution |
| --- | --- | --- |
| `README.md` | Opening defined ForgeLink as "the private boundary where trusted systems ask..."; architecture diagram showed only `agent tools -> MCP -> API -> desktop -> human`. | Rewrote opening to lead with the canonical definition, reordered "What ForgeLink Is" intro, added ForgeWire-optional language to "What ForgeLink Is Not", replaced the architecture diagram with one showing both the direct human path and the MCP path terminating in the same owner (the desktop app), added WI041/042 to Project Status, reframed the closing ForgeWire Labs paragraph. |
| `docs/public-narrative.md` | Title was "ForgeLink: Human-Boundary Infrastructure"; opening defined ForgeLink solely as the human-boundary product. | Rewrote title and opening to the canonical definition; added a "Standalone" positioning bullet. |
| `docs/killer-demo.md` | Opening line said the demo shows "what ForgeLink is" and defined that as "the governed place where a system asks, a human decides." | Reframed as "ForgeLink's agent-governance loop" specifically (the demo is genuinely agent/MCP-path-specific), with a pointer to `docs/product-definition.md` for the full product definition. |
| `mcp/forgelink-human/src/server.ts` (persona string) | `"ForgeLink is the private human boundary for ForgeWire-style agentic apps."` — defines the whole product from inside a component persona. | Rewrote to describe `forgelink-human` as "the governed agent-facing bridge into ForgeLink's human-authority surface," explicitly naming ForgeLink as a broader platform people also use directly. Updated the matching assertion in `mcp/forgelink-human/test/server.test.js`. |
| `install/mcp-configs/README.md` | "wiring agentic apps into the ForgeLink human bridge" — implies ForgeLink itself is the human bridge. | Reworded to name `forgelink-human` as the governed agent-facing bridge, not ForgeLink itself. |

## B — subsystem-level and correct (left unchanged, or lightly qualified)

| File | Finding | Disposition |
| --- | --- | --- |
| `mcp/forgelink-human/README.md` | "is the MCP bridge for agents that need to communicate with a person through ForgeLink" — accurately describes the component itself. | Left the sentence, added one clarifying sentence that this is one governed interface into a broader platform, with a link to `docs/product-definition.md`. |
| `docs/communications-runtime.md` | "agent messages / approvals (`agent_messages`): agent-to-human requests..." describes one specific database table. | Left unchanged — accurate subsystem description. |
| `work/active/037-telnyx-production-hardening-and-expansion/work-item.json` | Contains "agent-human" in criterion text describing the MCP/Fabric approval boundary. | Left unchanged — describes WI037's actual governance scope, not the whole product. |

## C — historical record; preserve (left unchanged)

| File(s) | Finding | Disposition |
| --- | --- | --- |
| `decisions/0004-agent-facing-governance-contract-and-fabric-hitl.md` | Historical decision record using period-accurate "agent-human" framing. | Left unchanged. |
| `evidence/runs/20260615-*.json` through `20260624-agh0*.json` (29 files) | Formal evidence runs for completed work item 016 (Agent-Human Governance) and related items; several `environment.process_note` fields use "agent-human" phrasing accurate to what was being tested at the time. | Left unchanged — durable evidence, not narrative. |
| `work/README.md`'s prior "Current Active Work" narrative for WI016 | Describes the (completed) agent-human governance arc. | Left unchanged; WI016 remains correctly described as a subsystem, not the whole product (see [decisions/0004](../../../../decisions/0004-agent-facing-governance-contract-and-fabric-hitl.md)). |

## D — technically descriptive boundary wording unrelated to product identity (left unchanged)

| File | Finding | Disposition |
| --- | --- | --- |
| `governance/charter.md` | "agent-human transcripts are treated as sensitive data" — a data-sensitivity classification, not a product definition. | Left unchanged. |
| `governance/invariants.json` (INV-4) | "no secrets, tokens, phone numbers, message bodies, personal media, or agent-human transcripts are committed or logged" — same data-sensitivity classification; this file is also a frozen governance surface and out of WI042's scope to edit without a separate governance decision. | Left unchanged. |
| `governance/frozen-surface.json` | "Invariants are the pact for ForgeLink's private communications and agent-human boundary" — describes what INV-4 protects, not the product itself. | Left unchanged. |
| `Electron/backend/src/server.ts`, `Electron/renderer/src/App.tsx` | Literal references to "MCP bridge" as the name of the actual bridge component/UI button/test label. | Left unchanged — accurate component naming, not product-identity language. |

## E — ambiguous; requires human/product decision

None found. Every hit resolved cleanly into A, B, C, or D.

## Terms searched but not separately tabulated

`communications cockpit` and `communications runtime` (also listed in the WI042
README's search list) return matches only in files already covered above
(README.md, docs/public-narrative.md, docs/communications-runtime.md,
work/README.md) and were reviewed as part of those files' classification; no
additional product-level drift was found under those terms.

## UI/onboarding copy spot-check (FPI-009)

Reviewed `Electron/renderer/src/App.tsx` first-run/onboarding strings ("Welcome
to ForgeLink", "Start local-only", provider choice cards). The local-only choice
card text ("No telecom credentials. Agent decisions and local workflows remain
available.") is accurate to what local-only mode actually offers — without a
telecom provider there is no SMS/voice, so describing agent decisions and local
workflows is not an overclaim, and it does not define the whole product. No
change made; no functional navigation redesign was found necessary.
