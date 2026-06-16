# ForgeLink Human MCP

`forgelink-human` is the MCP bridge for agents that need to communicate with a
person through ForgeLink. It is Node/TypeScript and talks only to the local
ForgeLink API.

## Environment

- `FORGELINK_BASE_URL`: ForgeLink local API, default `http://127.0.0.1:5055`.
- `FORGELINK_API_TOKEN`: per-launch local API token.
- `FORGELINK_API_TOKEN_FILE`: file containing the token, used when the token is
  not placed directly in environment.
- `FORGELINK_CHANNEL_TOKEN`: per-channel credential for creating messages.
- `FORGELINK_CHANNEL_TOKEN_FILE`: file containing the channel credential, used
  when it is not placed directly in environment.
- `FORGELINK_CHANNEL_ID`: channel id for outgoing agent messages, default
  `forgewire`.
- `FORGELINK_SOURCE`: source identity, default `forgelink-mcp`.

## Tools

- `send_human_message`
- `request_human_approval`
- `list_human_messages`
- `get_human_message`
- `dismiss_human_message`
- `record_human_action`
- `channel_status`

## Resources

- `forgelink://persona`
- `forgelink://channel-contract`
- `forgelink://security-boundary`
- `forgelink://install`

## Prompts / Skills

- `forgelink_ask_human`
- `forgelink_request_approval`
- `forgelink_escalate_concisely`
- `forgelink_summarize_before_interrupting`

## Run

```powershell
cd mcp/forgelink-human
npm run build
$env:FORGELINK_API_TOKEN = "<token from ForgeLink desktop session>"
node dist/server.js
```
