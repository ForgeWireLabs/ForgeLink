# Tauri Production Parity and Electron Retirement Agent

## Scope

- Own the Electron-only inventory, Tauri production parity, secure-storage and desktop
  integration parity, release artifacts, packaged-platform validation, actual Electron
  removal, post-removal regression, rollback, and closeout documentation.
- Coordinate PR-014 release/signing constraints with work item 011 and preserve the
  architecture established by completed work item 030.

## Safety Rules

- Do not remove Electron until the explicit parity gate is satisfied with evidence.
- Do not expose credentials, messages, contacts, media, provider IDs, or private
  diagnostics in tests, screenshots, reports, or release artifacts.
- Do not replicate the private desktop database to mobile.
- Do not deepen Electron-only code while this item is active except for bounded
  maintenance required to keep the current operator baseline safe.
- Unsigned development/test artifacts are valid internal evidence; public distribution
  remains certificate-gated and must use authenticated update channels.

## Required Checks

- Read root and nested `AGENTS.md` files before mutation.
- Run targeted renderer/backend/Tauri Rust tests for each parity slice.
- Run `python .local/validate_system.py` after ledger, docs, release, or implementation
  changes.
- Before Electron removal, prove packaged Windows parity and record rollback.
- After removal, run full regression, repository scans, packaged-runtime checks, data
  migration/restore checks, and clean-install validation.

## Definition of Done

Electron is removed only after parity, release, data-safety, platform, regression, and
rollback evidence is durable in the repository. A launchable scaffold alone is not
completion.
