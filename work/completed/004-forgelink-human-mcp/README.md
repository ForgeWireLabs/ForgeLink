# 004 - ForgeLink Human MCP Bridge

> **Status**: Completed 2026-06-15.
> **Owners**: Backend Agent, Security Agent, Testing Agent, Docs Agent.
> **Depends on**: Work item `003`.

## Intent

Make ForgeLink installable as a human communication bridge for external
agentic apps without adding a Python runtime to this repository.

This work should match the ForgeWire Fabric baseline: MCP is a product surface,
not a one-off helper. The server must expose tools, resources, and prompts;
ship ready-to-edit app configs; and prove that an MCP tool call can create a
ForgeLink agent-channel message.

## Decisions

- Use Node and TypeScript for the MCP bridge.
- Do not access SQLite directly. The MCP server talks to the ForgeLink local
  API created in work item `003`.
- Treat prompts as skills/persona guidance for external agents.
- Keep the first server role as a human bridge, not a work runner.

## Target Shape

```text
Claude Code / Codex / VS Code Copilot / ForgeWire Fabric
        |
        v
forgelink-human MCP server
        |
        v
ForgeLink local API
        |
        v
ForgeLink Agents UI
        |
        v
Human response
```

## Closeout

Completed with:

- Node/TypeScript MCP server in `mcp/forgelink-human`.
- Tools for human messages, approval requests, message lookup, dismissal,
  action recording, and channel status.
- Resources for persona, channel contract, security boundary, and install
  guidance.
- Prompt/skill surface for asking humans, requesting approval, escalating
  concisely, and summarizing before interruption.
- Install templates for VS Code/Copilot, Claude Code, Codex, and
  ForgeWire/Fabric.
- PowerShell installer in `scripts/install/install-forgelink-mcp.ps1`.
- Protocol and template tests in `mcp/forgelink-human/test`.
- Evidence in `evidence/runs/20260615-forgelink-human-mcp.json`.

## Verification

- `cd mcp/forgelink-human && npm test`
- PowerShell installer syntax parse.
- `cd Electron && npm test`
