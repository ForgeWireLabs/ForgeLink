# WI041 Agent Contract — First-Class Fax Communications

Read the repository root `AGENTS.md` and this work item's `README.md` before changing any fax-related code or records.

## Scope

WI041 owns ForgeLink-native fax architecture and implementation: provider-neutral fax contracts, durable fax state, Telnyx Programmable Fax integration, fax webhooks, inbound/outbound document handling, human UI, retention/deletion, and bounded API/MCP exposure.

## Binding boundaries

- ForgeLink is the fax lifecycle, credential, provider, document-reference, policy, and send-authority owner.
- Human-operated fax must work directly in ForgeLink without ForgeWire, AgentRun, GraphRuntime, JobService, Fabric, MCP, or an LLM.
- ForgeWire and other agentic systems may consume fax only through ForgeLink's governed API/MCP surfaces.
- Fabric must not receive Telnyx fax credentials, become a Telnyx fax client, store fax documents, or own fax lifecycle state.
- Fax is a distinct document-transmission domain. Do not force it into the SMS/MMS `OutboundMessage` shape.
- Telnyx Programmable Fax remains separate from Telnyx SMS/MMS, Voice, and ForgeWire Telnyx inference configuration.
- Reuse shared Telnyx cryptographic/error primitives only when the contract is genuinely shared. Fax lifecycle parsing stays fax-specific.
- Agent-originated fax defaults to draft-don't-send and passes ForgeLink communication authority. Human operator sends remain a direct authenticated ForgeLink action.
- WI040 owns regulated-data classification/provider eligibility/retention policy. WI041 consumes those contracts and must not invent a competing compliance model.
- Do not claim HIPAA, PCI DSS, SOC 2, TCPA, privacy-law, or other compliance/certification from technical controls alone.

## Before implementation

1. Confirm the item has been explicitly activated; while it remains under `work/proposed/`, architecture may be refined but implementation is not authorized.
2. Re-read WI015, WI016, WI032, WI035, WI037, and WI040.
3. Audit the current channel registry, Telnyx settings/storage, webhook queue, communications database, media handling, drafts/approvals, firewall, Tauri bridge, notifications, backup/export, and MCP server before selecting insertion points.
4. Re-check current official Telnyx Programmable Fax API, webhook, connection/application, number, media, cancellation, and status semantics before freezing provider-specific contracts.
5. Preserve the provider-neutral and local-first boundaries recorded in the README.

## Evidence rules

- Use synthetic phone numbers and synthetic fax documents in deterministic evidence.
- Never commit Telnyx API keys, signing keys, reusable authenticated media URLs, real private fax documents, or unredacted regulated payloads.
- Live Telnyx evidence must be opt-in, use designated test resources, and record only the minimum redacted operational proof.
- Ambiguous outbound side effects must never be hidden by an automatic retry that could duplicate a fax.
- Derived RepoPact dashboard output must be regenerated whenever lifecycle records change.

## Closeout

Do not mark any criterion satisfied from compiling code, mocks alone, or UI stubs. Human end-to-end fax operation, durable lifecycle/restart behavior, provider/event correctness, inbound document handling, and governance boundaries require executable evidence appropriate to each criterion.
