# WI042 — ForgeLink Product Identity and Communications Platform Narrative

## Status

Proposed.

This work item establishes the canonical product definition of ForgeLink and reconciles current documentation, diagrams, UI copy, integration language, and agent-facing context with what the product has actually become.

It is intentionally separate from WI041. Fax exposed the product-definition problem, but fax did not create it. ForgeLink already contains first-class human-operated communications, contacts, channels, provider integrations, cross-device cockpit work, attention policy, decisions, approvals, audit, and agent/application integration. Describing the entire product primarily as an agent-to-human bridge now understates the product and can distort future architecture.

## Executive decision

ForgeLink is not merely an agent-to-human communications channel.

The canonical product definition for this work is:

> **ForgeLink is a local-first communications, coordination, and human-authority platform for people, agents, and applications. It gives humans a first-class communications cockpit while providing governed interfaces through which agents and software can communicate, request authority, and interact with external communication networks.**

The exact public wording may be polished during implementation, but its semantic content is binding unless a later explicit product decision supersedes it.

Three consequences follow:

1. **The human is a first-class ForgeLink user, not merely an endpoint.** A person can use ForgeLink directly to communicate, manage people and channels, place or receive supported calls/messages/faxes, review history, manage policy, and operate the product without any agent, ForgeWire runtime, MCP client, or LLM in the loop.
2. **Agents and applications are first-class participants, but not the definition of the whole product.** They access ForgeLink through governed local APIs, MCP, and future integration surfaces appropriate to their authority.
3. **Human authority remains a core differentiator.** Correcting the product identity must not erase the decision, approval, attention, consent, audit, and governance architecture that makes agentic use safe and useful.

A concise model is:

```text
                              ForgeLink

                    Human UI / shared cockpit
                              |
                 Communications + coordination core
                              |
        +---------------------+---------------------+
        |                     |                     |
     Messages               Voice                  Fax
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

The older mental model:

```text
Agent -> ForgeLink -> Human
```

remains a valid ForgeLink use case and a valid description of some agent-facing components, but it is not an adequate definition of ForgeLink itself.

## Why this work exists

ForgeLink began with a strong human-boundary and agent-to-human governance emphasis. That architecture remains valuable, but the product surface expanded.

Current ForgeLink already includes or owns architecture for:

- a human-operated desktop/shared cockpit;
- people and rich contacts;
- provider-neutral communications channels;
- SMS/MMS through provider adapters;
- voice and durable call state;
- email and push channel work;
- communication history and timelines;
- local-first persistence;
- provider onboarding and settings;
- attention policy and notification controls;
- external communication firewall and consent;
- human decisions and agent approvals;
- audit, replay, retention, backup, and export;
- mobile/full-cockpit direction;
- agent/API/MCP integration;
- ForgeWire/Fabric compatibility without ForgeWire ownership;
- WI041 first-class fax communication.

Several repository documents already point toward the broader reality. The root README opens by calling ForgeLink a "local-first communications and decision runtime for humans and agents," and prior cross-device work describes ForgeLink as a communications cockpit. At the same time, the same README, the public narrative, MCP persona text, diagrams, and other language repeatedly define ForgeLink itself as a private human boundary where a system asks and a human decides.

That mixed identity creates architectural risk. A future contributor can reasonably infer that direct human communication is secondary, that every feature should terminate in an agent approval flow, or that an MCP/ForgeWire caller is required for core product operation. WI041 made that problem obvious: a human should be able to open ForgeLink and send or receive a fax directly. The same principle already applies to messages, calls, contacts, policy, and other human-operated communication surfaces.

## Product model

### ForgeLink is a human-facing product

The operator cockpit is a first-class application surface, not merely a dashboard for agent requests.

A supported human-operated workflow may begin and end entirely inside ForgeLink:

```text
Human -> ForgeLink UI -> communication domain -> provider/local edge -> recipient/network
```

Examples include:

- send or receive a supported message;
- place or receive a supported call;
- send or receive a fax after WI041 lands;
- manage a person/contact and their communication points;
- inspect delivery/call/fax history;
- choose or configure a communications provider;
- manage quiet hours, attention, consent, retention, and data safety;
- review or act on a decision request.

No agentic runtime is a prerequisite for these product flows.

### ForgeLink is agentic-capable

Agents and applications can participate through governed surfaces:

```text
Agent/Application -> ForgeLink API or MCP -> policy/authority -> ForgeLink domain -> human/network
```

Examples include:

- send a human message;
- request human approval;
- create an external-message draft;
- create a fax draft after WI041;
- inspect bounded status;
- record outcomes;
- consume operator decisions.

The agent/application path must not bypass ForgeLink ownership of communication state, policy, credentials, external-send authority, or human decision records.

### ForgeLink is independently useful

ForgeWire is an important integration consumer, not a prerequisite and not ForgeLink's product identity.

ForgeLink must remain understandable and useful as a standalone product. Documentation must not imply that ForgeWire, Fabric, AgentRun, GraphRuntime, MCP, Claude, Codex, or an LLM must exist for ordinary human-operated ForgeLink capabilities.

### ForgeLink still owns the human-authority boundary

The reframe is additive, not destructive.

ForgeLink still provides the governed place where agents/applications can request attention, decisions, and authority from a human. The following remain first-class product concepts:

- operator authority;
- structured approval requests;
- evidence packs;
- attention policy;
- trust and identity;
- communication firewall;
- consent;
- decision records;
- replay;
- audit;
- redaction;
- retention and deletion.

The mistake to correct is using one of those use cases as the definition of the entire system.

## Terminology model

WI042 establishes three terminology levels.

### Level 1 — Product identity

Used when answering "What is ForgeLink?" or describing the whole product.

Preferred concepts:

- local-first communications platform/runtime;
- communications, coordination, and human authority;
- people, agents, and applications;
- human-facing communications cockpit;
- governed external communication edges;
- provider-neutral communications;
- direct human use plus governed programmatic use.

Product-level documentation must not define ForgeLink solely as:

- an agent-to-human bridge;
- a human endpoint for agents;
- a place only where systems ask and humans decide;
- a ForgeWire human interface;
- an MCP communications bridge;
- an approval application with telecom adapters.

Those statements may describe a subsystem or use case, but not the whole product.

### Level 2 — Product subsystems and use cases

Narrow descriptions remain correct when they describe the actual component.

Examples:

- `mcp/forgelink-human` may be described as an agent-facing human bridge;
- the agent-channel API may be described as an agent-to-human/governance surface;
- approval flows may be described as agent-human governance;
- the Human Card/authority model may use human-authority terminology;
- Fabric HITL integration may describe ForgeLink as Fabric's human-decision surface.

These documents should add enough context to avoid redefining the whole product accidentally. For example, an MCP persona may say it is exposing the human-authority portion of the broader ForgeLink communications platform rather than saying "ForgeLink is the private human boundary" without qualification.

### Level 3 — Historical records

Completed work items, evidence runs, historical reports, and decision records are durable history.

Do not rewrite historical facts merely to apply the new marketing/product vocabulary retroactively. Historical records may be annotated or linked to the new canonical definition where confusion would otherwise be material, but their original meaning and evidence must remain intact.

## Known alignment targets

The implementation must perform a repository-wide inventory rather than relying only on this initial list. Known targets include:

### Root README

The opening sentence is already broader than the legacy framing, but nearby prose immediately narrows ForgeLink back to a private boundary where trusted systems ask for human attention and decisions. The README's architecture diagram also flows primarily from coding/agent tools through MCP/API to the desktop app and then to the human operator.

Required direction:

- lead with the canonical multi-participant product identity;
- describe direct human operation before or alongside agentic integration;
- make communications domains and providers visible as first-class product capabilities;
- keep human governance/authority as a major differentiator;
- move MCP/ForgeWire into integration sections rather than allowing them to define the architecture diagram;
- add Fax as planned/proposed until WI041 implementation satisfies its own criteria rather than claiming it as shipped.

### `docs/public-narrative.md`

The current title and opening frame ForgeLink as "Human-Boundary Infrastructure" and define it mainly as the place where trusted systems ask for human authority.

Required direction:

- replace the product-level human-boundary-only narrative;
- retain governed human authority as one pillar;
- show the human-operated communications cockpit as first-class;
- describe people, agents, and applications as participants;
- clearly separate shipped capabilities from planned/proposed capabilities;
- update public diagrams/screenshots/captions where the old topology is embedded.

### MCP persona and MCP documentation

`mcp/forgelink-human` is intentionally an agent-facing integration and may keep narrow human-bridge language describing itself.

However, any text that defines **ForgeLink itself** as only the private human boundary must be qualified.

Required direction:

```text
ForgeLink product      != forgelink-human MCP component
ForgeLink product      >  agent-human bridge use case
forgelink-human MCP    =  governed agent-facing interface into ForgeLink
```

Do not rename the MCP package merely for cosmetic alignment unless implementation discovers a concrete reason and records that as a separate decision.

### Communications/runtime/provider docs

Audit SMS/MMS, voice, email, push, Telnyx, Twilio, local integrations, communication firewall, communications runtime, contacts, notifications, retention/export, and future fax documentation.

The docs should make clear whether an operation is:

- directly human-operated;
- agent/application-originated and governed;
- available to both;
- provider-specific;
- local-only;
- planned rather than shipped.

Provider docs should describe providers as communication edges, not as evidence that the product exists mainly to deliver agent messages.

### UI and onboarding copy

Audit current Electron/shared cockpit and Tauri/mobile copy for assumptions that every ForgeLink user is supervising an agent.

The application may prominently expose Decisions and Agents, but ordinary communications use must be intelligible without agent concepts.

Expected product-level navigation vocabulary remains compatible with concepts such as:

```text
Decisions
People
Agents
Channels
```

Within Channels, human-operated communication domains may include:

```text
Messages
Calls
Fax
Email
Notifications / other supported edges
```

This work item does not require a navigation redesign unless the audit proves one is necessary. It owns wording/identity alignment first; functional UI restructuring must be justified rather than smuggled into documentation work.

### Architecture diagrams

Product-level diagrams must stop presenting this as the sole topology:

```text
Agentic tool -> MCP -> ForgeLink -> Human
```

A canonical architecture diagram should show at least:

- human cockpit/UI;
- communication runtime/domains;
- people/contacts;
- policy/authority/audit;
- external communication/provider edges;
- API/MCP integration;
- agents and applications as optional participants;
- no ForgeWire prerequisite.

Narrow diagrams may still show only agent-human flows when that is the subject being documented.

## Relationship to WI041 — Fax

WI041 is the first work item that explicitly requires a substantial new communication domain to be directly usable by a human in ForgeLink.

The relationship is coordination, not dependency:

- WI041 owns fax architecture, state, provider contracts, Telnyx Fax, UI, and lifecycle.
- WI042 owns ForgeLink-wide product identity and documentation semantics.
- WI041 must not wait for WI042 to establish fax architecture.
- WI042 must not claim fax is shipped merely because WI041 exists.
- When fax documentation is implemented, it should consume the canonical product definition from WI042.

ForgeWire remains optional in both.

## Relationship to existing ForgeLink work

### WI016 — Agent-Human Governance

WI016 remains valid. Agent-human governance is a core ForgeLink subsystem, not the entire product definition.

### WI017 — Operator Cockpit and Native Experience

WI017 is foundational to this reframe because it established a first-class operator experience. WI042 uses that product reality as part of the canonical narrative.

### WI030 / WI032 — Shared shell and Tauri production parity

Desktop/mobile shell evolution must preserve the same broader product identity. Tauri is not an "agent approval client"; it is intended to carry the ForgeLink cockpit.

### WI035 / WI037 — Telnyx

Telnyx integration is a provider edge owned by ForgeLink. SMS/MMS, later Telnyx expansions, and fax should be documented as communication capabilities usable through ForgeLink's human and governed programmatic surfaces according to each capability's policy.

### WI040 — Regulated communications boundary

The broader product identity increases the importance of classification and channel/provider policy because humans, agents, and applications may all originate communications. WI042 does not define regulated-data behavior; it must use WI040's terminology and must not make compliance claims.

## Canonical "What ForgeLink Is" direction

The final documentation should communicate the following ideas in plain language:

> ForgeLink is a local-first communications, coordination, and human-authority platform for people, agents, and applications.
>
> Humans can use ForgeLink directly as a communications cockpit. Agents and applications can use governed local interfaces to communicate, request decisions, and interact with supported external communication networks without taking ownership of the operator's communication state or authority.
>
> Channels and telecom providers are edges. ForgeLink owns the communication state, people/contacts, policy, human authority, decision evidence, and local operational history that make those edges coherent.

This is semantic guidance, not required word-for-word marketing copy.

## Canonical "What ForgeLink Is Not" direction

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

It can expose an MCP server, integrate with ForgeWire, govern agent-human requests, and use telecom providers without being defined by any one of those integrations.

## Documentation architecture

Implementation should create or designate one canonical product-definition document rather than duplicating slightly different definitions indefinitely.

A likely shape is:

```text
docs/product-definition.md
```

The exact path may change after the audit, but there must be one clear authority for product identity. Other documents should either:

- use the canonical definition;
- summarize it accurately;
- explicitly identify themselves as narrower subsystem/use-case documents.

The root README and public narrative remain important public entry points, but they should not drift independently.

## Repo-wide narrative audit

Before edits, generate an inventory of current product-defining language including at least searches for:

```text
human boundary
human bridge
agent-human
agent to human
agent-to-human
systems ask
system asks
human decides
human operator
ForgeWire bridge
MCP bridge
communications cockpit
communications runtime
```

Classify each hit as:

```text
A. product-level and stale/misleading
B. subsystem-level and correct
C. historical record; preserve
D. technically descriptive boundary wording unrelated to product identity
E. ambiguous; requires human/product decision
```

Do not mechanically replace terms. "Boundary" remains correct in security/network contexts, and "human bridge" remains correct for some agent integrations.

## Documentation truthfulness rules

Narrative alignment must not turn into aspirational feature inflation.

Every updated product document must distinguish:

- shipped/current;
- active implementation;
- proposed/planned;
- conceptual/future.

For example, WI041 establishes fax architecture but does not make fax a current capability until WI041's implementation and acceptance evidence say so.

Likewise, Tauri/mobile direction should not be described as production-complete before WI032 proves it.

## Guardrail for future work

After WI042, new product-level ForgeLink documentation should satisfy this invariant:

> **No current product-level document may define the entire ForgeLink product solely in terms of an agent, system, or application reaching a human. Human-operated communications are a first-class product capability, and agent/application integration is a governed additional interface into the same platform.**

Implementation should decide whether this is best enforced by:

- a documented review invariant;
- a lightweight narrative validation/check;
- a canonical product-definition reference in authoring guidance;
- or a combination.

Avoid brittle lint that rejects legitimate subsystem or security-boundary wording.

## Scope

In scope:

- canonical ForgeLink product definition;
- root README product narrative;
- public narrative;
- product-level architecture diagrams and captions;
- current documentation that materially defines ForgeLink;
- communications/provider documentation alignment;
- direct-human vs agent/application path clarification;
- shared cockpit/Tauri/mobile narrative alignment;
- MCP persona/docs qualification where they accidentally define the whole product narrowly;
- onboarding/settings/help copy where product identity is materially affected;
- terminology guidance for future work;
- explicit standalone operation and ForgeWire-optional positioning;
- documentation for WI041 when fax reaches implementation, without prematurely claiming shipped capability;
- executable or reviewable evidence that stale current product-level framing has been reconciled.

Out of scope unless separately justified:

- changing communication runtime architecture merely to match prose;
- renaming ForgeLink;
- renaming `forgelink-human` solely for aesthetics;
- redesigning the entire UI/navigation;
- changing ForgeWire/Fabric architecture;
- implementing fax, SMS, voice, email, push, or other channel features;
- rewriting immutable historical records for modern terminology;
- marketing/legal compliance claims;
- hosted/SaaS architecture decisions.

## Sequencing

### Phase 0 — Narrative inventory and classification

1. Inventory current product-definition language across README, docs, MCP, UI/onboarding strings, diagrams/captions, active/proposed work, and relevant code comments.
2. Classify each occurrence as product-level stale, subsystem-correct, historical, technical boundary wording, or ambiguous.
3. Record the canonical terminology and explicit exceptions.
4. Confirm no current architecture contract requires the whole-product human-boundary-only framing.

### Phase 1 — Canonical definition

1. Create/designate the authoritative product-definition document.
2. Define product, participants, direct-human operation, agent/application integration, human authority, provider edges, and standalone operation.
3. Define "what ForgeLink is not."
4. Define current/planned truthfulness rules.

### Phase 2 — Public entry points

1. Reconcile the root README.
2. Reconcile `docs/public-narrative.md`.
3. Replace or update product-level architecture diagrams/captions.
4. Ensure the first-screen explanation makes sense to someone who does not use agents or ForgeWire.

### Phase 3 — Subsystem and integration alignment

1. Reconcile communications/runtime/provider docs.
2. Qualify MCP persona/docs without erasing their legitimate agent-facing scope.
3. Reconcile Tauri/mobile/shared cockpit language.
4. Reconcile relevant UI/onboarding/help copy.
5. Coordinate future WI041 fax docs.

### Phase 4 — Future-drift prevention

1. Add authoring guidance or a narrow validation mechanism.
2. Prove legitimate subsystem terms are not incorrectly rejected.
3. Prove the current product-level narrative no longer collapses ForgeLink into an agent-to-human-only product.

### Phase 5 — Evidence and closeout

1. Run RepoPact/system validation.
2. Run documentation/link/build checks affected by the edits.
3. Build/render any changed diagrams or screenshots.
4. Capture the narrative inventory and resolved classifications as durable evidence.
5. Review README/public narrative/MCP context together for semantic consistency.

## Acceptance criteria

The machine-readable criteria are canonical in `work-item.json`. In narrative form, closeout requires all of the following:

- a canonical product definition covering humans, agents, and applications;
- human-operated ForgeLink documented as first-class and standalone;
- agent/MCP/ForgeWire integration documented as optional governed interfaces rather than product prerequisites;
- human authority/governance preserved as a core differentiator;
- root README and public narrative aligned;
- product-level diagrams aligned;
- repo-wide narrative inventory classified rather than mechanically replaced;
- MCP/component language kept narrow where appropriate and qualified where it over-defines the product;
- current/planned capability distinctions preserved;
- Tauri/mobile/shared cockpit narrative aligned;
- current communications/provider docs aligned where materially necessary;
- a future-drift guardrail established;
- historical work/evidence/decisions preserved;
- documentation validation/evidence captured.

## Risks

### Risk: overcorrecting away from human authority

The goal is not to make ForgeLink a generic softphone or messaging client. Human authority, attention governance, consent, policy, and audit remain central differentiators.

### Risk: rewriting technically correct boundary language

Security, ingress, local API, trust, and MCP documents often use "boundary" precisely. Do not replace the word because it appears in a search result. Classify intent first.

### Risk: feature inflation

A broader product story can accidentally describe planned features as shipped. Every edited document must preserve maturity truth.

### Risk: ForgeWire recentering

The product should explain ForgeWire integration, but ForgeWire cannot become the assumed runtime behind ordinary ForgeLink use.

### Risk: marketing prose diverges from architecture

The canonical definition must remain grounded in actual ownership boundaries: ForgeLink owns local communication state, human/operator authority, policy, and supported provider edges. It is not a vague umbrella brand.

## Evidence expectations

Closeout evidence should include:

- the narrative inventory and classification;
- before/after excerpts for major public entry points;
- updated product architecture diagram evidence;
- proof that direct-human workflows are represented without agent prerequisites;
- proof that MCP/agent-specific docs still accurately describe their narrower scope;
- documentation/link/build validation as applicable;
- RepoPact validation;
- a final semantic consistency review across README, canonical product definition, public narrative, and MCP persona/resources.

## Closeout statement target

WI042 is complete only when a new reader can enter the repository through the README or public narrative and correctly understand this hierarchy:

```text
ForgeLink
  = local-first communications + coordination + human authority platform
  = directly usable by humans
  = usable by agents/applications through governed interfaces
  = provider-neutral at the communication-domain boundary
  != merely an agent-to-human bridge
  != dependent on ForgeWire
```

The result should make fax, messaging, calls, contacts, decisions, future channels, MCP, and ForgeWire integration all feel like coherent parts of one product rather than exceptions around an outdated definition.
