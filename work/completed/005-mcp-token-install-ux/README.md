# 005 - MCP Token And Install UX

> **Status**: Completed 2026-06-15.
> **Owners**: Desktop Agent, UI Agent, Security Agent, Testing Agent.
> **Depends on**: Work item `004`.

## Intent

Turn the ForgeLink MCP bridge from "installable by a careful operator" into a
ForgeLink-managed integration path. Work item `004` shipped the TypeScript MCP
server, templates, and installer. This item closes the token-handoff and
operator UX gap.

External tools should not require spelunking through logs or process
environment to find a usable token. ForgeLink should own the local MCP token
file lifecycle and show the human exactly how to install the bridge into the
tools they use.

## In Scope

- Settings page section for **Agent apps / MCP**.
- MCP bridge build/status checks.
- Local API reachability checks using the same private boundary as the app.
- Create, rotate, and revoke a local MCP token file.
- Copyable install commands and config target paths for:
  - VS Code / Copilot MCP
  - Claude Code
  - Codex
  - ForgeWire / Fabric
- A safe "test MCP bridge" action that creates a clearly marked local test
  agent message without leaking secrets.
- Tests and evidence.

## Out Of Scope

- Per-channel credentials and rate limits; those belong to `007`.
- Live ForgeWire/Fabric capability advertisement; that belongs to `006`.
- RSS/signals work; that belongs to `008`.

## Security Notes

- The token file is a local secret. It must not be returned through preload as
  raw text unless the human explicitly requests copy/export behavior.
- Renderer status should be boolean or redacted: present, missing, rotated_at,
  revoked_at, path, and last test result are acceptable; token value is not.
- Generated config examples should reference `FORGELINK_API_TOKEN_FILE`, not
  inline `FORGELINK_API_TOKEN`, by default.
- Revocation must remove or invalidate the file-backed token and make the MCP
  bridge fail closed.

## Acceptance Evidence

Completed with:

- Settings page **Agent apps / MCP** controls for token-file state, bridge build
  state, local API state, install commands, token creation/rotation,
  revocation, and a test message.
- Desktop-owned MCP token lifecycle writing a local token file at the
  ForgeLink path and returning only redacted status to the renderer.
- Backend MCP token storage as a SHA-256 hash with revocation metadata and
  route gating limited to agent-channel-safe MCP routes.
- Built-in test message path for validating local MCP access without touching
  SMS, contacts, exports, uploads, or Twilio credentials.
- Evidence in `evidence/runs/20260615-mcp-token-install-ux.json`.

## Verification

- `cd Electron && npm test`
- `cd mcp/forgelink-human && npm test`
- `cd Electron && npm run screenshot`
- `python scripts/validate_repo.py --root .`
- `python .local/validate_system.py`

## Remaining Risk

The MCP bridge path is surfaced from the local checkout. Packaged installer
work may still need to decide whether the bridge ships inside the app bundle or
continues to install from the repository checkout.
