# Tauri Native Integration (TPR-004)

This slice closes the Tauri native integration boundary for notifications,
deep links, navigation restoration, single-instance activation, and safe
external opening. Electron remains available as the compatibility shell.

## Event flow

```text
OS deep link / second launch
        -> Tauri deep-link + single-instance plugins
        -> Rust NavigationCoordinator
        -> strict forgelink://open/<surface>/<local-id> validation
        -> forgelink://navigation-intent event
        -> shared shell.onNavigationIntent()
        -> React surface + optional bounded selection hint
```

The same `NavigationCoordinator` receives mobile notification action events.
The only registered mobile notification action is **Open ForgeLink**. It
validates the notification's navigation metadata and emits the same event; it
cannot approve, deny, send, call, or mutate private data.

## Native contracts

- `Tauri/src-tauri/src/navigation.rs` accepts only the five top-level cockpit
  surfaces. IDs are optional, ASCII-bounded selection hints. Query strings,
  fragments, percent-encoding, path traversal, extra route segments, and
  unknown surfaces are rejected before the renderer sees them.
- Startup links use Tauri `get_current`; running-app links use the native
  `on_open_url` callback. The single-instance plugin is registered first, as
  required by Tauri's deep-link integration, so a second launch activates the
  existing window instead of starting another backend.
- The renderer persists only the last top-level surface in local storage. It
  restores `decisions`, `people`, `agents`, `channels`, or `settings`; invalid
  values fall back to `decisions`. Deep links and notification activations
  never invoke a decision, messaging, calling, or provider action.
- `Tauri/src-tauri/src/notifications.rs` evaluates the existing attention
  policy shape, applies quiet hours, operator mode, presence, muted-source,
  kind-policy, emergency-policy, and redaction semantics, then checks the OS
  permission state. A denied permission is not continuously re-prompted in a
  process. Notification extras contain only a validated navigation hint.
- `Tauri/src-tauri/src/desktop_integration.rs` allows only credential-free,
  bounded HTTPS URLs through the Tauri opener plugin. The Electron fallback
  applies the same URL constraints.
- `tauri-plugin-window-state` restores the desktop window's size and position;
  deep-link and second-instance callbacks show, unminimize, and focus the main
  window.

## Platform matrix and limits

| Platform | Native implementation | Validation / limit |
| --- | --- | --- |
| Windows | Static `forgelink` scheme, single-instance forwarding, window activation, OS notification plugin, window state | Rust compile/unit/static coverage is complete. Tauri notifications require an installed app for the real AppUserModel identity; installed Windows smoke belongs to TPR-007. |
| Linux | Static scheme, single-instance forwarding, window activation, notify-rust-backed notifications, window state | Rust compile/unit/static coverage is complete. Packaged desktop registration and distro notification smoke belong to TPR-008. |
| macOS | Static scheme, single-instance forwarding, `on_open_url`, window activation, native notifications, window state | Rust compile/unit/static coverage is complete. Signed bundle and Universal Link/App Store posture belong to TPR-008. |
| Android | Static `forgelink` custom scheme, Tauri mobile deep-link callback, notification permission flow, navigation-only **Open ForgeLink** action | Mobile source is configured and guarded; packaged APK/emulator notification and deep-link smoke remains a later packaged-mobile gate. No private desktop database or secret material is copied. |
| iOS | Static `forgelink` custom scheme, Tauri mobile deep-link callback, notification permission flow, navigation-only **Open ForgeLink** action | Mobile source is configured and guarded; packaged IPA/simulator/device and signing smoke remains a later packaged-mobile gate. |

These limits are deliberate: unsigned development artifacts and uninstalled
Windows development runs are not treated as public distribution evidence, and
the native shell does not invent a desktop database migration or a mobile
secret-replication path.

## Verification

- `cargo check --manifest-path Tauri/src-tauri/Cargo.toml`
- `cargo test --manifest-path Tauri/src-tauri/Cargo.toml` — 49 passed
- `npm run renderer:build` from `Electron`
- `npx vitest run renderer/src/App.test.tsx` from `Electron` — 232 passed
- `node --test tauri-desktop-integration.test.js` from `Electron`
- `python .local/validate_system.py`

Tauri's plugin configuration follows the official deep-link, notification,
opener, single-instance, and window-state APIs. See the [Tauri deep-linking
guide](https://v2.tauri.app/plugin/deep-linking/), [notification
guide](https://v2.tauri.app/plugin/notification/), and [opener
guide](https://v2.tauri.app/plugin/opener/) for the platform behavior that
drives the limits above.
