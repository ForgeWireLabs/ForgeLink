# Android Mobile-Local Runtime Parity Gap Ledger — 2026-07-08

## Purpose

This ledger identifies the remaining gaps between the current Android mobile-local runtime and the intended ForgeLink Android cockpit.

This is a planning and evidence slice only.

No runtime behavior is changed by this report.

## Current Baseline

The current Android mobile-local baseline is:

- Android is a first-class cockpit target.
- The restricted decision terminal remains a mode/profile, not the whole Android product.
- Tauri Android APK builds are enabled.
- A physical Android APK install/launch smoke has been recorded.
- Android mobile-local attention policy persistence exists.
- Android mobile-local agent-channel redacted metadata persistence exists.
- Settings surfaces Android mobile-local runtime status when the desktop API is unavailable.
- Settings explicitly states that private desktop database replication is not active.

Latest baseline commit:

- abab6f9 Close out Android mobile-local runtime sequence

## Boundary Model

Android mobile-local runtime must preserve ForgeLink's safety posture:

- Do not silently copy the desktop private database to Android.
- Do not imply SMS/contact/message parity until an explicit private-data policy exists.
- Do not give push notifications approval authority.
- Do not treat the decision terminal as the entire Android product.
- Do not persist token values or secrets in mobile-local metadata.
- Do not add background sync before pairing, trust, retention, and rollback rules are defined.
- Keep all Android private-data expansion explicit, testable, and reversible.

## Gap Ledger

### Gap 001 — Android local service / bridge availability

Current state:

- The renderer can enter a Tauri Android path.
- The desktop local API can be unavailable on Android.
- The UI now surfaces that as Android mobile-local runtime behavior rather than hiding it.

Gap:

- The Android cockpit still lacks a complete Android-native service bridge for private cockpit functions.

Allowed next work:

- Add diagnostics that explain which bridge capabilities are mobile-local, unavailable, or desktop-only.
- Add tests that prove unavailable desktop routes fail safely.
- Add visible operator-facing status for bridge capability groups.

Forbidden next work:

- Do not fake desktop API availability.
- Do not silently fall back to empty data without labeling it.
- Do not replicate private data as a shortcut.

Recommended implementation priority:

- High.

### Gap 002 — Mobile-local private-data policy

Current state:

- Attention policy and agent-channel redacted metadata persist locally on Android.
- Private messages, contacts, calls, uploads, and database exports remain outside the Android-local slice.

Gap:

- There is no committed Android private-data policy that defines what may live on device, for how long, under what encryption boundary, and how rollback works.

Allowed next work:

- Write a private-data policy before implementing private local Android storage.
- Define allowed, forbidden, and deferred categories.
- Define retention, backup, export, and wipe rules.
- Define whether data is source-of-truth, cache, or derived view.

Forbidden next work:

- Do not copy the desktop SQLite database to Android.
- Do not implement message/contact sync before policy.
- Do not store raw agent evidence packs on Android.

Recommended implementation priority:

- Highest before any private-data Android parity work.

### Gap 003 — Device pairing and key trust

Current state:

- The restricted mobile terminal references paired-device signing concepts.
- Existing governance/device-key tests cover decision/audit key handling in the broader app.

Gap:

- Android cockpit pairing and runtime trust are not yet hardened as a full mobile-control-plane boundary.

Allowed next work:

- Define pairing lifecycle states.
- Define revoke behavior.
- Define what a paired Android device may request.
- Define operator-visible trust status.
- Add tests for revoked or unknown device behavior.

Forbidden next work:

- Do not grant Android device authority merely because the app launches.
- Do not allow notification actions to bypass cockpit review.
- Do not treat device identity as equivalent to operator consent.

Recommended implementation priority:

- High.

### Gap 004 — Runtime diagnostics

Current state:

- Settings shows that Android mobile-local runtime is active.
- Android device health panel exists for advisory status.

Gap:

- There is not yet a consolidated Android runtime diagnostics surface showing all cockpit capability groups.

Allowed next work:

- Add a capability matrix for Android runtime:
  - available;
  - mobile-local;
  - unavailable;
  - desktop-only;
  - requires pairing;
  - requires private-data policy.
- Keep status labels operator-readable.
- Add tests that verify the labels.

Forbidden next work:

- Do not hide degraded states.
- Do not call unavailable features "ready".

Recommended implementation priority:

- High and safe as next implementation slice.

### Gap 005 — APK install, update, and distribution posture

Current state:

- Unsigned/internal APK build, signing, install, and launch smoke succeeded.
- Distribution posture report exists.

Gap:

- Production signing, release channel, update semantics, and rollback procedure remain intentionally unresolved.

Allowed next work:

- Keep unsigned APKs internal.
- Document release signing requirements.
- Document store-owned update path for mobile.
- Add rollback notes for local test APKs.

Forbidden next work:

- Do not publish unsigned builds.
- Do not use desktop auto-update assumptions for Android.
- Do not bypass Android platform signing expectations.

Recommended implementation priority:

- Medium.

### Gap 006 — Android notification path

Current state:

- Push channel exists as a notification-only path.
- Push grants no approval authority.
- Attention policy controls notification behavior.

Gap:

- Android-native notification delivery and mobile-local notification posture are not yet a complete runtime path.

Allowed next work:

- Define Android notification categories.
- Keep lock-screen-safe redaction as default.
- Route notification taps into cockpit views.
- Require explicit cockpit action for approval.

Forbidden next work:

- Do not approve, deny, or defer from notification actions unless separately governed and tested.
- Do not expose private content on lock screen by default.

Recommended implementation priority:

- Medium.

### Gap 007 — Offline cockpit behavior

Current state:

- Android can visibly enter mobile-local mode when desktop API is unavailable.
- Limited local metadata can still be loaded.

Gap:

- Offline behavior is not yet defined for every cockpit area.

Allowed next work:

- Define offline states per view:
  - Decisions;
  - Channels;
  - People;
  - Signals;
  - Settings;
  - Mobile terminal.
- Prefer explicit "unavailable offline" states over empty screens.

Forbidden next work:

- Do not imply synced data exists when it does not.
- Do not create local shadow records without source-of-truth rules.

Recommended implementation priority:

- High after diagnostics.

### Gap 008 — Rollback and data-safety rules

Current state:

- Desktop data safety features exist.
- Android mobile-local state is intentionally narrow.

Gap:

- Android-specific rollback and wipe behavior is not defined for future expanded local data.

Allowed next work:

- Define wipe behavior for mobile-local metadata.
- Define what happens on app reinstall, downgrade, or revoked pairing.
- Define whether mobile-local reports are exportable.
- Define minimum evidence required before enabling private local data.

Forbidden next work:

- Do not create unrecoverable or unreviewed mobile data stores.
- Do not mix desktop rollback rules with Android storage assumptions without testing.

Recommended implementation priority:

- High before private-data parity.

## Recommended Next Implementation Slice

Recommended next implementation slice:

Android Runtime Slice 006 — Android runtime diagnostics capability matrix

Why:

- It is safe.
- It does not require private-data replication.
- It improves operator clarity.
- It turns current degraded/mobile-local behavior into an explicit capability model.
- It prepares the repo for future private-data and bridge work without prematurely implementing either.

Acceptance target:

- Settings or mobile cockpit status shows Android runtime capability groups.
- Capability groups include at least:
  - Shell bridge;
  - Desktop local API;
  - Attention policy;
  - Agent-channel metadata;
  - Private messages;
  - Contacts;
  - Calls;
  - Signals;
  - Push notifications;
  - Device pairing.
- Each group is labeled as one of:
  - available;
  - mobile-local;
  - unavailable;
  - desktop-only;
  - deferred pending policy;
  - requires pairing.
- Tests confirm Android mobile-local fallback renders the matrix.
- No private desktop database replication is implemented.

## Closeout Criteria for This Ledger

This ledger is complete when:

- it is committed under reports/;
- repo validation passes;
- no runtime files are changed;
- next implementation slice is selected from the ledger.