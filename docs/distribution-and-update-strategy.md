# Distribution and Update Strategy

> Status: defined (work item 017, OCX-020). This document defines the strategy;
> the desktop signing/feed work is tracked by work item 011 PR-014 and the Tauri
> path by work item 030 TAURI-006. It describes the intended distribution model
> for ForgeLink's expanded surface (operator cockpit plus the Tauri 2 mobile
> decision terminal) and the gates that must be satisfied before shipping the
> mobile surface (OCX-007/008) and the public demo (OCX-016).

ForgeLink is a local-first application that handles sensitive human communication
and governance state. Distribution and updates must preserve that trust: builds
are authenticated, updates are operator-controllable, and no release path moves
private data off the device.

## Surfaces in scope

1. **Desktop cockpit** — the current Electron desktop app and its eventual Tauri 2
   replacement (work item 030). Same product surface (Decisions, People, Agents,
   Channels), distributed as a signed installer with an auto-update channel.
2. **Mobile cockpit** — the Tauri 2 mobile app (work item 030,
   [decision 0017](../decisions/0017-mobile-is-a-full-cockpit.md)). A separate signed
   build/update path for iOS/Android that ships the shared cockpit in a mobile
   layout as a full operator surface, with the redacted decision terminal as a
   restricted mode. It reads the operator's data as an authenticated client of the
   local connection, never as a replicated private-data mirror.

## Desktop: code-signed releases and auto-update

The desktop release path is owned by work item 011 PR-014. Current state and
requirements:

- **Code signing (required, pending).** Windows installers must be Authenticode
  signed with an operator-provided certificate; macOS builds must be Developer-ID
  signed and notarized. Signing keys are operator-supplied and never committed.
- **Auto-update channel.** electron-updater publishes to and reads from the GitHub
  releases feed configured in [`Electron/builder.json`](../Electron/builder.json)
  (`publish.provider = github`, `ForgeWireLabs/ForgeLink`). Auto-update is gated
  by [`Electron/updates.js`](../Electron/updates.js) `shouldAutoUpdate`, which runs
  updates **only** in a packaged build and honors the `FORGELINK_DISABLE_UPDATES`
  operator opt-out.
- **Version metadata, release notes, checksums.** Versions are tracked in
  `VERSION` and `Electron/package.json`; release notes come from `CHANGELOG.md`;
  release artifacts publish checksums. (Landed under PR-014.)
- **Rollback.** The installer is non–one-click (`nsis.oneClick = false`) so an
  operator can reinstall a prior signed version; local data safety is handled
  separately by managed backups and the schema-migration ladder
  ([decision 0011](../decisions/0011-schema-migration-coordination.md)).

**Remaining desktop gate (PR-014):** a signing certificate, electron-updater asar
bundling verified by the packaging test, and a published update feed.

> **Signing is a public-distribution hardening gate, not a development blocker**
> ([decision 0018](../decisions/0018-signing-cert-is-a-distribution-gate-not-a-dev-blocker.md)).
> The signing certificate is an operator-supplied external dependency and may not
> arrive until late in the project. It gates **signed public distribution** only.
> An **unsigned/dev build path** (`npm run build`) already exists and remains the
> development and internal-distribution mechanism; it unblocks work item 030
> scaffolding and the 019–024 channel adapters, which do not wait on signing.

## Mobile: signed Tauri 2 build/update path

The mobile decision terminal is distributed separately and is owned jointly by
work item 030 TAURI-006 and this item. Requirements:

- **Signed builds.** iOS builds are signed and distributed through Apple's
  pipeline (TestFlight for pre-release, App Store for general availability);
  Android builds are signed with an upload/app-signing key and distributed through
  Play (internal/closed tracks for pre-release). Keys are operator/organization
  owned.
- **Update path.** Mobile updates ship through the platform stores rather than a
  self-hosted feed. Over-the-air content updates, if ever added, must not bypass
  store review for native capability changes and must keep the
  redacted-decision-only boundary.
- **Client, not replication.** The mobile cockpit reaches the operator's data over
  the authenticated local connection; no build, release, or update path turns it
  into a replicated on-device private database. Its restricted decision-terminal
  mode goes further, receiving only redacted decision cards and returning signed
  decision envelopes (OCX-007/008).

## Shipping gates

These gate **public/signed shipping** of the dependent work, not its development.
Building, scaffolding, internal/dev distribution, and validation proceed on the
unsigned/dev path (decision 0018). The following must be true before the dependent
work ships publicly:

- **Mobile surface (OCX-007/008):** a signed mobile build/update path exists and
  the shared-shell bridge boundary (OCX-021, work item 030) is in place.
- **Public demo (OCX-016):** desktop releases are code-signed with a working
  auto-update channel, and the demo uses synthetic data only (OCX-018) with no
  real telecom credentials.

## Coordination

- **011 PR-014** owns the concrete desktop signing, electron-updater bundling, and
  published-feed work. This document is the cockpit-side strategy that PR-014
  implements against.
- **030 TAURI-006** owns the Tauri 2 desktop/mobile distribution implementation and
  the Electron retirement gate (TAURI-005). The Tauri desktop path inherits the
  signed-release + auto-update model defined here; Electron is retired only after
  Tauri reaches parity.

## Tauri distribution/update contract

TAURI-006 records the concrete Tauri contract in
[`Tauri/distribution-plan.json`](../Tauri/distribution-plan.json) and
[`docs/tauri-distribution-update-strategy.md`](tauri-distribution-update-strategy.md).
The plan is intentionally stricter than a prose note:

- unsigned Tauri builds are allowed for scaffold, validation, and internal
  operator testing, but not as a public release channel;
- the desktop Tauri updater feed is held until signing and must not publish an
  unsigned manifest;
- mobile updates are owned by TestFlight/App Store and Play testing/production
  tracks, not a self-hosted native update feed;
- mobile stays an authenticated local API client and the release path cannot
  introduce private database replication.

`Electron/tauri-distribution.test.js` keeps these constraints wired into the
standard `npm test` gate.

## Security and privacy constraints

- Builds are authenticated (signed) before **public** distribution; unsigned builds
  are not a supported **public release** channel. Unsigned/dev builds remain a
  supported development and internal-distribution path (decision 0018) and are how
  030 scaffolding and the adapter roadmap proceed until the certificate arrives.
- Updates are operator-controllable (`FORGELINK_DISABLE_UPDATES`) and never silent
  on an unpackaged/dev build.
- No release or update path transmits private communication, contact, approval, or
  credential data off the device.
- Release artifacts and notes follow the documentation rule: only shipped behavior
  is described as shipping; pending signing/feed work stays marked pending here and
  in PR-014.
