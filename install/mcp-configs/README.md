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
