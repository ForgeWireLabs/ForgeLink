---
audience: maintainers and implementation agents
status: active
last_verified: 2026-06-20
source_of_truth: work/active/024-local-webhook-lan-integrations/README.md; work/active/024-local-webhook-lan-integrations/work-item.json
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
