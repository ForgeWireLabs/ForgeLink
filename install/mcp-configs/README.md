# ForgeLink MCP Configs

Reference configs for wiring agentic apps into the ForgeLink human bridge.

The server is `forgelink-human` and lives at:

```text
mcp/forgelink-human/dist/server.js
```

Build it before installing:

```powershell
cd mcp/forgelink-human
npm run build
```

## Environment

Every template uses:

- `FORGELINK_BASE_URL`: ForgeLink local API, usually `http://127.0.0.1:5055`.
- `FORGELINK_API_TOKEN_FILE`: file containing the ForgeLink local API token.
- `FORGELINK_CHANNEL_ID`: channel id, usually `forgewire`.
- `FORGELINK_SOURCE`: source app identity, such as `claude-code`, `codex`, or
  `vscode-copilot`.

Use `FORGELINK_API_TOKEN` only for short-lived development sessions. Prefer a
token file with local-user-only permissions for app configs.

## Templates

| Template | Target |
| --- | --- |
| `vscode/mcp.json` | VS Code MCP / Copilot user or workspace config |
| `claude/forgelink-human.json` | Claude Code MCP config |
| `codex/config.toml` | Codex MCP config snippet |
| `forgewire/forgelink-human.json` | ForgeWire/Fabric MCP server entry |

Replace `C:\\Projects\\TWL_phone` with this checkout path if different.

## ForgeWire/Fabric capability surface

ForgeWire Fabric runners introspect connected MCP servers into an
`mcp_manifest` shaped as:

```json
{
  "schema_version": 1,
  "servers": [
    {
      "server_id": "forgelink-human",
      "tools": [],
      "resources": [],
      "prompts": []
    }
  ]
}
```

`forgelink-human` is expected to advertise the `request_human_approval` and
`record_human_action` tools, `forgelink://persona` and security resources, and
ForgeLink prompts for concise human interruption. The high-fidelity local smoke
is:

```powershell
cd mcp/forgelink-human
npm run smoke:fabric
```

The smoke starts a temporary ForgeLink backend, creates a local MCP token file,
loads the MCP bridge through stdio, converts the advertised server surface into
Fabric's manifest shape, sends an approval request, records a human action, and
writes redacted evidence to `evidence/artifacts/`.
