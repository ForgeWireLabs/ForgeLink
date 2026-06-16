# 007 - Per-Channel Credentials And Rate Limits

> **Status**: Completed 2026-06-15.
> **Owners**: Security Agent, Backend Agent, Data Agent, UI Agent.
> **Depends on**: Work items `003` and `005`.

## Intent

Harden agent-channel access so ForgeLink does not become a local spam pipe. The
current bridge can use the local launch token. That is acceptable for early
trusted local use, but durable external integrations need separate channel
credentials, revocation, and rate limits.

## In Scope

- Channel registry with stable channel ids and human-readable labels.
- Separate channel credentials for agent-channel message creation.
- Credential creation, rotation, revocation, and disable/enable flows.
- Per-channel rate limits.
- Urgency-aware limits so `urgent` cannot be abused.
- Backend rejection paths that are auditable without logging message bodies.
- Settings UI for channel administration.
- Data lifecycle behavior for channel metadata.

## Out Of Scope

- Public network exposure. The API remains loopback unless a future threat model
  says otherwise.
- OAuth or third-party hosted identity.
- RSS feed policy; that belongs to `008` and `009`.

## Design Questions

- Should credentials be stored in SQLite encrypted by OS storage, or in an
  operating-system credential store with SQLite metadata only?
- Should rate limits be token bucket, fixed window, or simple rolling window?
- Should revocation preserve a channel audit row forever, or follow retention?

## Closeout

Completed with:

- Schema version 6 agent-channel registry and channel event audit rows.
- Per-channel SHA-256 credential storage, desktop-written token files, enable,
  disable, rotate, and revoke flows.
- Channel-token authentication for agent-channel message creation, separate
  from renderer/session and MCP tokens.
- Per-channel urgency limits over a fixed 60-second window: `low=60`,
  `normal=30`, `high=10`, `urgent=3`.
- Settings channel administration with token-file paths, enabled/configured
  state, rejection counts, and rate-limit counts without rendering secrets.
- MCP bridge support for `FORGELINK_CHANNEL_TOKEN_FILE`.
- Evidence in
  `evidence/runs/20260615-per-channel-credentials-rate-limits.json`.

## Verification

- `cd Electron && npm test`
- `cd mcp/forgelink-human && npm test`
- `cd mcp/forgelink-human && npm run smoke:fabric`
- `cd Electron && npm run screenshot`
- `python .local/validate_system.py`

## Security Notes

Raw channel credentials are returned only once to launch-token-only desktop
admin calls and are written to local token files by the desktop process. SQLite
stores only hashes. JSON export includes channel metadata and counters, not
credential hashes or raw token values.
