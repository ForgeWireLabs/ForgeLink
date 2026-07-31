# Work Item 037 Agent Contract

This item owns the next Telnyx production-hardening and product-expansion arc.
Read the repository root `AGENTS.md` before changing anything in this directory.

## Binding boundaries

- ForgeLink remains the authority for communications state, credentials, contact
  policy, reviewed drafts, human approval, provider sends, and delivery evidence.
- Telnyx remains an edge adapter. Do not move provider semantics into the local
  communication core or flatten Telnyx, Twilio, RCS, Voice, Verify, and WhatsApp
  into one generic payload.
- ForgeWire Fabric may discover and invoke bounded ForgeLink MCP capabilities, but
  it must not receive Telnyx secret values or gain implicit send authority.
- Agent-initiated external communication creates a reviewed draft by default.
  Sending requires the existing ForgeLink approval and communication-firewall path.
- Do not mutate a Telnyx messaging profile, number assignment, registration,
  opt-out configuration, spend limit, or webhook without an explicit preview,
  operator confirmation, durable before/after evidence, and a rollback path.
- No real credentials, phone numbers, message content, media, provider account IDs,
  private webhook URLs, or secret values in commits, fixtures, screenshots, logs,
  diagnostics, Fabric tasks, MCP manifests, evidence, or audit records.

## Required engineering posture

- Verify Telnyx webhooks over the exact raw body and enforce a bounded timestamp
  freshness window before durable ingestion.
- Persist webhook event identity and occurrence time so retries and out-of-order
  delivery are handled from evidence, not arrival order.
- Download inbound Telnyx MMS media through an authenticated, bounded, validated
  local ingestion path; never leave expiring provider URLs as the durable record.
- Keep provider error bodies redacted while retaining stable error categories,
  provider codes where safe, retryability, and operator remediation.
- Add live-provider tests only as explicit opt-in gates against designated test
  resources. Deterministic suites must remain credential-free.
- Treat Tauri parity as real only after its local-service and secure-storage gates
  pass; do not replace an honest unavailable state with a stubbed success.
- Any client-visible Fabric change requires a companion governed item in the
  canonical `forgewire/forgewire-fabric` subtree and its own validation/evidence.

## Required checks

Run the focused tests named by the milestone being closed, then at minimum:

```text
npm test
npm run scan:secrets
cargo check --manifest-path Tauri/src-tauri/Cargo.toml
python -m repopact_cli dashboard --root .
python .local/validate_system.py
git diff --check
```

Before closing any live-provider criterion, record the opt-in command and a
redacted result that proves the designated Telnyx test profile, number, webhooks,
and rollback behaved as claimed.
