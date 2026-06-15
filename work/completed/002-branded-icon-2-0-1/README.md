# 002 — Ship Branded ForgeLink Icon In 2.0.1

> **Status**: Complete. Evidence `20260615-forgelink-2-0-1-icon-release`.
> **Owners**: desktop-agent lead, UI Agent supporting.
> **Depends on**: Work item `001`.

## Intent

Replace the default Electron icon with a branded ForgeLink icon before the app is
treated as a polished release artifact.

## Decisions

The icon follows the ForgeWire family: dark rounded tile, amber graph nodes,
cyan wiring, and a blue-violet ForgeLink hub. The source lives as SVG, with
generated PNG and ICO assets committed for packaging.

## Scope

`Electron/assets/icon.svg`, `Electron/assets/icon.png`,
`Electron/assets/icon.ico`, `Electron/builder.json`, and version metadata.

## Closeout

Closed by `v2.0.1`, which published a branded Windows installer and verified the
icon through the packaged executable.
