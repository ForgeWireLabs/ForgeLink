---
audience: maintainers and implementation agents
status: completed
last_verified: 2026-08-02
source_of_truth: work/completed/024-local-webhook-lan-integrations/README.md; work/completed/024-local-webhook-lan-integrations/work-item.json
---

# Work Item 024: Local Webhook and LAN Integrations

## Goal

Add authenticated local webhook and LAN integration paths for operator-controlled systems without turning ForgeLink into a public remote-control API.

## Scope

- Local integration contracts.
- Per-integration credentials and least-privilege scope.
- Authenticated inbound event normalization.
- Optional outbound local callbacks or quick actions with signed local pending-action checks.
- UI for credential lifecycle and health.
- Clear distinction from public telecom/provider webhooks.

## Non-Goals

- Do not expose unauthenticated local routes.
- Do not make LAN routes public by default.
- Do not let local integrations bypass agent/contact policy.
- Do not accept arbitrary JSON as trusted commands.
- Do not weaken existing MCP or provider webhook boundaries.

## Evidence Expectations

Evidence must include route auth tests, replay/rate-limit tests, credential lifecycle tests, redaction checks, UI tests for credential management, and docs.

## Acceptance criteria

- [x] **LAN-001** Define local webhook/LAN adapter contracts for authenticated inbound events, outbound local delivery, capability discovery, disabled states, replay prevention, and diagnostics health.
- [x] **LAN-002** Keep all local webhook/LAN routes loopback or LAN-gated by default with explicit opt-in, origin/host checks, token or signature authentication, rate limits, and bounded payloads.
- [x] **LAN-003** Implement per-integration credential lifecycle and least privilege.
- [x] **LAN-004** Normalize authenticated inbound events through explicit schemas and policy gates.
- [x] **LAN-005** Implement signed, expiring, replay-safe outbound callbacks or quick actions if shipped.
- [x] **LAN-006** Add operator credential, state, counters, and health UI.
- [x] **LAN-007** Complete the remaining deterministic credential lifecycle, normalization, policy, and diagnostics coverage.
- [x] **LAN-008** Complete operator setup and failure-mode documentation for the shipped integration workflow.

LAN-003 adds hash-only credentials returned once on create/rotation, explicit
`agent_message` and `actions` scopes, enable/disable/revoke state, and redacted
counters. LAN-004 accepts only schema-v1 low/normal `agent_message` events and
normalizes them to local notices after identity/contact policy and durable event-ID
replay checks. LAN-005 adds operator-created, integration-bound pending actions
whose signed token, expiry, current credential, and single-use durable outcome are
all verified. None of these paths grant approval or arbitrary command authority.

## Evidence log

| Criteria | Evidence | Result |
| --- | --- | --- |
| LAN-001, LAN-002 | `evidence/runs/20260802-lan001-lan002-local-integration-boundary.json` | Contract, HTTP, network-scope, Host/Origin, token/HMAC, replay, rate-limit, payload-bound, redaction, full regression, secret scan, and governed validation passed. |
| LAN-003, LAN-004, LAN-005 | `evidence/runs/20260802-lan003-lan005-local-integration-lifecycle.json` | Hash-only credential lifecycle, scope and policy rejection, event normalization/replay, signed pending-action expiry/replay/outcomes, persistence, full regression, secret scan, and governed validation passed. |
| LAN-006, LAN-007, LAN-008 | `evidence/runs/20260802-lan006-lan008-local-integration-operator-workflow.json` | Desktop token-file lifecycle UI, visible redacted state/scopes/counters/health, synthetic test events, expanded lifecycle/policy/diagnostics coverage, operator setup/risk/failure documentation, full regression, and governed validation passed. |

## Rollback and remaining limits

Rollback is disabling or revoking every managed integration, then removing the
registry/routes; provider and private API paths are independent. Managed metadata
and action outcomes live in `local-integrations.json` under the ForgeLink data
directory and contain credential hashes, never plaintext credentials. The desktop
main process owns protected token files; the shared renderer sees only redacted
metadata and reports the capability unavailable on Tauri until its local-service
parity gate is implemented under work item 032.

## Closeout

All eight criteria are satisfied. The shipped workflow remains local-first,
disabled until the operator creates an integration, loopback-only unless LAN is
explicitly enabled, least-privilege by scope, and incapable of granting approval,
urgent interruption, provider-send, or arbitrary command authority.
