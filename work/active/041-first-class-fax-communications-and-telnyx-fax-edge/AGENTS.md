# WI041 Agent Contract — First-Class Fax Communications

Read the repository root `AGENTS.md` and this work item's `README.md` before changing any fax-related code or records.

## Scope

WI041 owns ForgeLink-native fax architecture and implementation: provider-neutral fax contracts, durable fax state, Telnyx Programmable Fax integration, fax webhooks, inbound/outbound document handling, human UI, retention/deletion, bounded API/MCP exposure, and integration with the managed document-acquisition path required by `local-artifacts/document-acquisition-scope-amendment.md`.

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
- WI042 owns ForgeLink-wide product identity and narrative alignment. WI041 does not depend on WI042 for fax architecture or implementation, but fax documentation and product copy must align with WI042's canonical rule that humans are first-class ForgeLink users and agents/applications are optional governed participants. Do not claim fax as shipped before WI041 acceptance evidence supports it.
- `local-artifacts/document-acquisition-scope-amendment.md` is binding for the human document-input path. Camera scan, local/native device selection, Google Drive, OneDrive/SharePoint, Dropbox, and future document providers must converge into a ForgeLink-owned managed local document before fax preparation/submission. Telnyx must never become the document-source authority.
- Do not persist cloud OAuth tokens, temporary authenticated cloud URLs, camera-library URIs, or provider-specific remote handles as the durable `FaxDocumentRef`. Import/materialize first, then operate on the managed local artifact.
- Camera support is a multi-page document-scanning workflow with page composition/preview, not merely a one-photo attachment. Basic fax must not require OCR, an LLM, or cloud document processing.
- A future cross-cutting Managed Document Acquisition work item may own reusable source-provider/camera/import infrastructure, but WI041 still owns proving the fax UI actually consumes that capability end to end. Do not close FAX-008/FAX-009 from subsystem existence alone.
- Do not claim HIPAA, PCI DSS, SOC 2, TCPA, privacy-law, or other compliance/certification from technical controls alone.

## Before implementation

1. Confirm the item has been explicitly activated; while it remains under `work/proposed/`, architecture may be refined but implementation is not authorized.
2. Re-read WI015, WI016, WI032, WI035, WI037, WI040, and WI042.
3. Read `local-artifacts/document-acquisition-scope-amendment.md` before implementing fax document input, preparation, preview, UI, Tauri/mobile, or cloud-provider integration.
4. Audit the current channel registry, Telnyx settings/storage, webhook queue, communications database, media handling, drafts/approvals, firewall, Tauri bridge, notifications, backup/export, MCP server, native picker/file handling, and any reusable document/import infrastructure before selecting insertion points.
5. Re-check current official Telnyx Programmable Fax API, webhook, connection/application, number, media, cancellation, and status semantics before freezing provider-specific contracts.
6. Preserve the provider-neutral and local-first boundaries recorded in the README and the document-acquisition scope amendment.

## Evidence rules

- Use synthetic phone numbers and synthetic fax documents in deterministic evidence.
- Never commit Telnyx API keys, signing keys, reusable authenticated media URLs, real private fax documents, cloud OAuth/access tokens, or unredacted regulated payloads.
- Live Telnyx evidence must be opt-in, use designated test resources, and record only the minimum redacted operational proof.
- Ambiguous outbound side effects must never be hidden by an automatic retry that could duplicate a fax.
- Document-acquisition evidence must use synthetic/test artifacts and must not rely on a user's private Google Drive, OneDrive, Dropbox, camera roll, or other real cloud content unless a separately opt-in acceptance step explicitly authorizes it.
- Derived RepoPact dashboard output must be regenerated whenever lifecycle records change.

## Closeout

Do not mark any criterion satisfied from compiling code, mocks alone, or UI stubs. Human end-to-end fax operation, durable lifecycle/restart behavior, provider/event correctness, inbound document handling, document acquisition from the required human source families, and governance boundaries require executable evidence appropriate to each criterion.
