---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-07-22
source_of_truth: work/active/035-first-class-telnyx-integration/README.md; work/active/035-first-class-telnyx-integration/work-item.json
---

# Work Item 035: First-Class Telnyx Integration

## Goal

Make Telnyx a first-class SMS/MMS telecom edge in ForgeLink: securely configurable,
actually validated, explicitly selectable, visible in provider health, automatically
wired for inbound/status webhooks, and usable from the same shared operator cockpit as
the rest of ForgeLink.

## Shipped-state gap

Work item 015 added a sound Telnyx adapter and provider conformance coverage, but the
operator integration is incomplete:

- Telnyx credentials are environment-only while the app UI remains Twilio-specific.
- The Settings claim recorded by CLV-007 is not true in the current cockpit.
- Telnyx credential validation checks only for non-empty strings.
- When Twilio and Telnyx are both configured, sends implicitly use registry order
  instead of an operator-selected provider.
- Automatic tunnel/webhook configuration only updates Twilio.
- Runtime status does not provide a coherent redacted Telnyx configuration and health
  view.

The adapter is therefore implemented, but Telnyx is not yet a first-class operator
workflow.

## Scope

- A secure Telnyx settings store with stored/environment source reporting.
- Real Telnyx validation against the messaging phone-number/profile contracts.
- Explicit preferred SMS/MMS provider selection used by sends, retries, and approved
  outbound drafts.
- Shared Settings UI for configure, test, select, inspect, and remove.
- Automatic Telnyx messaging-profile webhook setup at `/webhooks/telnyx` when the
  operator saves a configuration with a public HTTPS base URL.
- Redacted provider status and diagnostics.
- Deterministic tests, operator docs, migration/rollback notes, and evidence.
- Shared Tauri bridge contract updates coordinated with work item 032; real Tauri
  secure-storage and service parity remain owned and gated there.

## Non-goals

- Telnyx Voice, SIP, number purchasing, porting, 10DLC registration, toll-free
  verification, campaign management, billing, or emergency calling.
- Automatic creation or reassignment of messaging profiles or phone numbers.
- Silent mutation of Telnyx account settings during a connection test.
- Removing Twilio or changing provider-neutral channel semantics.
- Claiming Tauri production parity before work item 032 proves it.

## Acceptance criteria

- [x] **TEL-001** Record the shipped gaps and first-class provider contract.
- [x] **TEL-002** Add secure, redacted Telnyx credential lifecycle handling.
- [x] **TEL-003** Validate API key, number, messaging capability/profile, and public key.
- [x] **TEL-004** Add shared cockpit configuration, selection, status, and removal UX.
- [x] **TEL-005** Route all outbound SMS/MMS paths through the selected provider.
- [x] **TEL-006** Add bounded automatic Telnyx webhook profile configuration.
- [x] **TEL-007** Keep the shared Tauri bridge posture explicit and coordinated.
- [x] **TEL-008** Document, test, validate, and record evidence and remaining risks.

## Security and rollback

Secrets never cross the shell bridge. Connection tests are read-only. Saving may update
only the configured messaging profile's primary webhook URL after validation and only
when a public HTTPS URL is available. Removing stored Telnyx settings falls back to a
complete environment configuration if present; otherwise Telnyx becomes unavailable
and ForgeLink falls back only when the operator has selected an available provider.

Rollback is removal of the new stored Telnyx settings and restoration of the previous
provider preference. Existing Twilio settings, messages, contacts, and local-only state
remain intact.

## Evidence log

`20260722-first-class-telnyx-integration` records the secure-store tests, Telnyx
API/profile fixtures, selected-provider HTTP routing, shared cockpit interaction test,
Tauri bridge test/check, complete Electron regression, secret scan, canonical dashboard
generation, and governed validation.

## Closeout

Telnyx is now an operator-visible, explicitly selected SMS/MMS edge rather than an
environment-only adapter. The desktop shell owns encrypted credential lifecycle and
automatic webhook recovery; the backend owns provider-neutral routing and redacted
status; the shared cockpit owns configuration and selection without receiving secrets.

No live Telnyx account was used in deterministic CI evidence, so real-account number
eligibility, regulatory state, provider reachability, and carrier delivery remain
operator-environment checks. Telnyx Voice remains out of scope. Work item 032 still
owns real Tauri local-service and secure-provider-storage parity; this item adds an
honest shared bridge posture and does not claim that gate is complete.
