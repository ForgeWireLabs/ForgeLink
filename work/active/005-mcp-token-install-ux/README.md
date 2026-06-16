# 005 - MCP Token And Install UX

> **Status**: Active.
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

Close with an evidence run that includes:

- `cd Electron && npm test`
- `cd mcp/forgelink-human && npm test`
- local system audit
- RepoPact validation
- visual screenshot if Settings UI changes
- a redaction note confirming no token value appears in renderer snapshots or
  test output.
