---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-22
source_of_truth: README.md; work-item.json
---

# Work Item 036: Provider-Specific Communications Experience

## Goal

Make the shared ForgeLink cockpit represent Twilio and Telnyx as genuinely different
provider integrations. Share the local messaging contract, not provider credentials,
setup assumptions, capabilities, webhook models, or operator workflows.

## Shipped-state gap

Work item 035 made Telnyx securely configurable and selectable, but the broader
frontend remains Twilio-shaped:

- first-run setup offers only local-only or Twilio;
- the overview SMS readiness indicator checks Twilio credential fields directly;
- active-provider context is largely confined to Settings;
- Twilio has a provider-console action while Telnyx does not;
- capability differences such as Twilio Voice versus Telnyx SMS/MMS-only support in
  ForgeLink are not presented as an operator contract.

## Product contract

ForgeLink shares message composition, persistence, retry, approval, and audit behavior
across telecom edges. Provider setup and status remain separate:

- **Twilio:** Account SID, Auth Token, phone number, SMS/MMS webhooks, and the current
  ForgeLink Voice edge.
- **Telnyx:** API v2 key, messaging phone number, messaging profile, Ed25519 webhook
  public key, and SMS/MMS only in the current ForgeLink integration.
- **Local-only:** no telecom provider and no external SMS/MMS delivery.

## Scope

- Provider choice during first-run and later connection setup.
- Separate Twilio and Telnyx forms and help content.
- Provider-specific capability and readiness presentation.
- Correct active SMS/MMS health on overview and messaging surfaces.
- Explicit active-edge context in inbox/compose and reviewed-outbox workflows.
- Provider-specific console/help actions.
- Renderer tests, shared-shell compatibility, documentation, evidence, and closeout.

## Non-goals

- A generic provider credential schema or generic webhook configuration UI.
- New Telnyx Voice, SIP, RCS, number purchasing, regulatory registration, or billing.
- New Twilio products beyond ForgeLink's existing SMS/MMS and Voice integration.
- Backend provider API changes already completed by work item 035.
- Claiming Tauri secure-provider-storage or local-service parity before work item 032.

## Acceptance criteria

- [x] **PFX-001** Record the provider-specific frontend contract and shipped gaps.
- [x] **PFX-002** Add first-run provider choice with separate local, Twilio, and Telnyx paths.
- [x] **PFX-003** Present provider-specific configuration, help, actions, and capability boundaries.
- [x] **PFX-004** Make overview and messaging readiness use the selected provider rather than Twilio fields.
- [x] **PFX-005** Surface the active SMS/MMS edge and its capabilities in messaging and reviewed-outbox flows.
- [x] **PFX-006** Preserve shared-renderer/Tauri honesty, accessibility, secret redaction, and local-only behavior.
- [x] **PFX-007** Update documentation, tests, generated artifacts, evidence, and governed validation.

## Security and privacy

No credential values, real numbers, private messages, provider identifiers, or private
webhook URLs may enter renderer state returned by the shell, committed fixtures,
screenshots, diagnostics, logs, or evidence. Password fields may hold operator input
only until the shell call completes, then must clear. Provider errors remain redacted.

## Evidence log

| Evidence | Criteria | Result |
| --- | --- | --- |
| `20260722-provider-specific-communications-experience` | PFX-001 through PFX-007 | Passed provider-model, onboarding, selected-edge, accessibility, shared-shell, regression, secret-scan, visual, and governed validation. |

## Closeout

Completed on 2026-07-22. The shared cockpit now starts with an explicit local-only,
Twilio, or Telnyx choice. Twilio retains its Account SID/Auth Token, SMS/MMS, and Voice
contract; Telnyx uses its API v2 key, messaging profile, Ed25519 webhook key, and
SMS/MMS-only ForgeLink contract. Channels, inbox/compose, new-message, and reviewed
outbox surfaces derive their edge label and readiness from the selected provider.

The provider-neutral boundary remains message composition, persistence, retry,
approval, audit, and shell command semantics. Provider credentials, setup help,
capabilities, webhook model, health, and console actions remain provider-specific.

Visual QA passed at desktop and 740x900 widths with synthetic data. No live provider
credentials or private communications were used. Tauri proof remains limited to the
shared renderer and compiling bridge; work item 032 continues to own production
local-service and secure-storage parity.

## Rollback

Revert the renderer-only experience changes. Work item 035's secure settings,
provider selection, routing, webhook automation, and backend contracts remain intact.
