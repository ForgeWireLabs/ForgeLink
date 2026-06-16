# 006 - ForgeWire Fabric Live Integration

> **Status**: Deferred.
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

Evidence should include:

- Fabric-visible manifest or capability list.
- Tool-call transcript with sensitive values redacted.
- ForgeLink stored message id and action outcome.
- Commands used to reproduce the integration.
