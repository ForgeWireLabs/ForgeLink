# 006 - ForgeWire Fabric Live Integration

> **Status**: Completed 2026-06-15.
> **Owners**: Backend Agent, Testing Agent, Security Agent.
> **Depends on**: Work items `004` and `005`.

## Intent

Prove ForgeLink is not merely MCP-compatible in isolation. It must work as a
human bridge inside the ForgeWire/Fabric ecosystem, where tools, prompts, and
resources are advertised as capabilities and routed by agents.

## In Scope

- Install or load `forgelink-human` in a ForgeWire/Fabric MCP-capable context.
- Capture the advertised MCP manifest: tools, resources, prompts/skills.
- Run a request from ForgeWire/Fabric through `request_human_approval`.
- Verify ForgeLink stores and shows the message in the Agents view.
- Record a human action in ForgeLink and verify the originating side can poll or
  otherwise observe the outcome.
- Record evidence from a live local run, or a high-fidelity smoke if the Fabric
  live environment is unavailable.

## Out Of Scope

- Building a ForgeLink work runner. ForgeLink remains the human bridge.
- Reworking Fabric's routing model.
- Per-channel credentials and rate limits; those are owned by `007`.

## Risks

- Fabric's install and manifest conventions may expect Python-shaped servers.
  This item must prove the TypeScript bridge is acceptable or document the exact
  compatibility gap without adding Python by default.
- Human approval evidence must not commit message bodies containing sensitive
  personal data.

## Closeout Evidence

Completed with:

- High-fidelity local ForgeWire/Fabric smoke in
  `scripts/smoke/forgewire-fabric-smoke.js`.
- `npm run smoke:fabric` on the `mcp/forgelink-human` package.
- Fabric-style `mcp_manifest` evidence in
  `evidence/artifacts/20260615-forgewire-fabric-smoke.json`.
- Capability rows for ForgeLink tools, resources, and prompts, including
  `request_human_approval`, `record_human_action`, `forgelink://persona`, and
  `forgelink_request_approval`.
- Redacted transcript proving approval creation, action recording, and outcome
  observation from the originating MCP/Fabric side.
- Evidence run in
  `evidence/runs/20260615-forgewire-fabric-live-integration.json`.

## Verification

- `cd mcp/forgelink-human && npm test`
- `cd mcp/forgelink-human && npm run smoke:fabric`
- `cd Electron && npm test`

## Remaining Risk

This item proves the ForgeLink side using Fabric's manifest and capability-index
shape without adding Python to this repository. Live registration into a running
ForgeWire Fabric hub remains an operator-environment exercise because the hub
runtime and credentials live outside ForgeLink.
