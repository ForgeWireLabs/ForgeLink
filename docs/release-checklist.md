# ForgeLink release checklist

A reproducible, top-to-bottom procedure for cutting a ForgeLink release (PR-014).
Steps marked **[blocked: signing]** require a code-signing certificate and stay
pending until one is provisioned.

## 1. Pre-flight
- [ ] Working tree clean on `main`; `python scripts/validate_repo.py` and
      `python scripts/repopact_cli.py doctor` are green.
- [ ] Decide the new version (semver). Update **both** `VERSION` and
      `Electron/package.json` `version` so they match (the dashboard and
      diagnostics read these).
- [ ] Move the `## [Unreleased]` notes in `CHANGELOG.md` under the new version
      heading with today's date.

## 2. Verify
- [ ] `cd Electron && npm ci`
- [ ] `npm test` (renderer + node suites + checks; the live-Twilio test stays
      skipped unless `FORGELINK_LIVE_TWILIO=1`).
- [ ] `npm run scan:secrets` (repo is clean of committed secrets).
- [ ] `npm run scan:deps` (production dependencies audit clean at high severity).

## 3. Build
- [ ] `npm run build` produces `Electron/dist/ForgeLink_<version>_x64-setup.exe`
      plus its `.blockmap` (used for differential auto-updates).
- [ ] Confirm `packaging.test.js` passed in step 2 (every required module is
      packaged; no test files or source maps shipped).

## 4. Sign **[blocked: signing]**
- [ ] Provide the code-signing certificate to electron-builder
      (`CSC_LINK` / `CSC_KEY_PASSWORD`) and rebuild so the installer and
      `ForgeLink.exe` are signed. Until this is done, Windows SmartScreen warns
      on first run and auto-update is not trust-anchored.

## 5. Checksums
- [ ] Generate and record SHA-256 for the installer:
      `Get-FileHash dist/ForgeLink_<version>_x64-setup.exe -Algorithm SHA256`.
- [ ] Write/refresh `dist/SHA256SUMS.txt`.

## 6. Publish + auto-update feed

> **Note:** GitHub Releases publishing is currently **payment-locked** for this
> account, so the steps below (and any `latest.yml` auto-update feed) are blocked.
> Until that is resolved, distribute the locally built
> `ForgeLink_<version>_x64-setup.exe` + `SHA256SUMS.txt` directly, or use an
> alternative host.

- [x] `electron-updater` is bundled into the asar (the `builder.json` `files`
      config uses `**/*` + negations so production `node_modules` are included).
      Confirm with
      `npx @electron/asar list dist/win-unpacked/resources/app.asar | findstr electron-updater`.
- [ ] **[hold until signing]** Publish `latest.yml` (the auto-update feed) only
      after the build is signed, so installed clients are never on an
      unauthenticated update channel. Until then, publish the installer for
      **manual download** without `latest.yml`.
- [ ] Tag the release and publish with the GitHub provider so electron-builder
      uploads the installer, `.blockmap`, and `latest.yml`:
      `GH_TOKEN=… npm run build -- --publish always` (publish config in
      `builder.json`). `latest.yml` is what installed clients read to auto-update.
- [ ] Attach the CHANGELOG section as the GitHub release notes.

## 7. Verify the released artifact
- [ ] Fresh-machine install of the published `…_x64-setup.exe`; confirm the
      desktop icon launches a working app (setup wizard appears).
- [ ] With a prior version installed, confirm auto-update detects and applies the
      new release (requires step 6 done; trust requires step 4).

## 8. Rollback
- [ ] If a release is bad, publish the previous good version as the latest GitHub
      release so `latest.yml` points clients back; users can also reinstall the
      prior `…_x64-setup.exe`. Record the rollback in `CHANGELOG.md`.
