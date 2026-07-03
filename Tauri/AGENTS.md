# ForgeLink Tauri Shell Agent

## Scope

- Own the Tauri 2 desktop/mobile shell scaffold under `Tauri/`.
- Reuse the shared React renderer from `Electron/renderer`; do not fork the
  cockpit UI into a second product.
- Keep Electron available until the retirement gate in work item 030 is
  satisfied with evidence.

## Checks

- Run `cargo check --manifest-path Tauri/src-tauri/Cargo.toml` after Rust or
  Tauri config changes.
- Run `npm run renderer:build` from `Electron/` after bridge or renderer changes.
- Run `python .local/validate_system.py` after work, evidence, ownership, or
  documentation changes.

## Security Rules

- Tauri commands must expose the ForgeLink shell bridge only; no raw filesystem,
  shell, private database, provider credential, or device shell access.
- Mobile remains an authenticated client of the operator's local connection and
  must not replicate the private desktop database.
