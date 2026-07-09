# Android Pairing and Trust Lifecycle Report - 2026-07-08

## Purpose

This report defines the Android pairing and trust lifecycle required before ForgeLink Android can safely expand beyond mobile-local runtime metadata.

This is a report-only slice.

No runtime behavior is changed by this report.

## Why This Exists

The Android private-data policy established that private messages, contacts, calls, trusted signals, and evidence packs must remain out of Android-local storage until pairing, revocation, wipe, retention, and rollback behavior are defined.

The Android capability matrix currently labels:

- Push notifications: requires pairing
- Device pairing: requires pairing
- Private messages: deferred pending policy
- Contacts: deferred pending policy

This report defines what pairing means and what it does not mean.

## Baseline

The slice starts after:

- 92683fe Define Android private-data policy
- 39d75b3 Close out Android runtime capability matrix
- 9a68f3a Show Android runtime capability matrix
- 8d5dbdf Record Android mobile-local parity gap ledger

Current Android mobile-local allowed state remains:

- attention policy;
- redacted agent-channel metadata;
- runtime preferences;
- capability status labels.

## Pairing Principles

Pairing is a trust relationship between the desktop/local ForgeLink authority and an Android cockpit device.

Pairing must be:

- explicit;
- operator-visible;
- revocable;
- bounded by capability;
- testable;
- safe under lost-device assumptions;
- safe under desktop service unavailability;
- separate from app installation;
- separate from operator consent for individual actions.

Installing the Android app is not pairing.

Launching the Android app is not pairing.

Being on the same network is not pairing.

Having a prior token or stale local file is not pairing.

## Pairing States

### State 001 - Unpaired

Meaning:

- Android app is installed or running.
- No trusted pairing has been established.

Allowed:

- local UI shell;
- mobile-local runtime status;
- attention policy local defaults;
- redacted agent-channel metadata if already allowed by mobile-local runtime policy;
- capability matrix;
- onboarding or pairing instructions.

Forbidden:

- private messages;
- contacts;
- call history;
- trusted signal content;
- evidence packs;
- approval authority;
- unredacted notifications;
- desktop database reads;
- background sync.

### State 002 - Pairing requested

Meaning:

- Android has initiated a pairing request or is waiting for a desktop/operator action.

Allowed:

- request id;
- device label;
- bounded timestamp;
- public device capability summary;
- operator-visible pending state.

Forbidden:

- granting access before desktop/operator approval;
- storing private data;
- allowing push approval actions;
- treating pending as trusted.

### State 003 - Paired limited

Meaning:

- Desktop/operator has approved the Android device for a narrow capability set.

Allowed:

- pairing status display;
- device identity display;
- redacted push notification routing;
- capability-gated requests selected by policy;
- future derived private-data views only if separately implemented.

Forbidden:

- full private database replication;
- approval authority by default;
- raw message/contact/call/signal storage;
- unbounded sync;
- acting outside granted capability set.

### State 004 - Paired full cockpit candidate

Meaning:

- Android may be eligible for broader cockpit capabilities, but only after separate implementation slices define each category.

Allowed:

- capability-by-capability expansion;
- explicit tests per expanded category;
- operator-visible scope labels;
- revocation and wipe behavior.

Forbidden:

- treating this state as automatic full parity;
- bypassing private-data policy;
- bypassing action authority policy;
- hiding degraded/unavailable categories.

### State 005 - Revoked

Meaning:

- Desktop/operator has revoked trust for the Android device.

Required behavior:

- Android must lose paired capabilities.
- Future private local data must be wiped or quarantined according to policy.
- Push routing to the device must stop.
- UI must show revoked/untrusted state.
- Re-pairing must require a new explicit pairing flow.

Forbidden:

- retaining private cached data;
- silently restoring trust;
- using old tokens;
- continuing notification routing;
- showing stale private derived views.

### State 006 - Lost device

Meaning:

- Operator marks the Android device lost, stolen, or no longer controlled.

Required behavior:

- Treat as revoked or stronger.
- Disable push routing.
- Invalidate device trust.
- Require fresh pairing for any future access.
- Prefer wipe-on-next-contact if future private local data exists.

Forbidden:

- any continued paired capability;
- background reactivation;
- trust reuse after reinstall.

### State 007 - Expired / stale pairing

Meaning:

- Pairing has exceeded a defined age, missed refresh window, or failed trust renewal.

Required behavior:

- Degrade to limited or unpaired behavior.
- Require operator-visible renewal.
- Disable private-data categories until renewed.

Forbidden:

- indefinite trust without review;
- silent renewal;
- using stale pairing for private-data access.

## What Pairing Grants

Pairing may grant only explicitly listed capabilities.

Allowed candidate grants:

- show paired status;
- receive redacted push notifications;
- request mobile-local runtime diagnostics;
- request derived private-data views in future slices;
- route notification taps into cockpit views;
- request desktop-mediated actions that still require explicit operator review.

Pairing may support future capability groups, but each group needs its own implementation slice and tests.

## What Pairing Does Not Grant

Pairing does not grant:

- full private database replication;
- raw message history;
- raw contact database;
- call recordings or transcripts;
- trusted signal archive;
- evidence pack archive;
- provider credentials;
- MCP or agent-channel token values;
- approval authority;
- send authority;
- bypass of reviewed outbox;
- bypass of communication firewall;
- silent background sync;
- lock-screen private content.

Pairing proves device trust, not operator intent.

Operator intent must still be captured by explicit cockpit action where required.

## Lost-Device Assumptions

ForgeLink must assume an Android device can be:

- lost;
- stolen;
- rooted;
- inspected physically;
- left unlocked;
- backed up by platform tooling;
- downgraded;
- reinstalled;
- network-isolated from the desktop;
- holding stale local files.

Therefore, private-data expansion must be conservative.

## Revocation Rules

Revocation must be desktop-authoritative.

When a device is revoked:

- paired capability status must become unavailable;
- push routing must stop;
- future private Android caches must wipe or quarantine;
- Android UI must stop presenting private derived views;
- stale trust files must not re-enable access;
- re-pairing must require an explicit new flow.

## Android Runtime Behavior by State

### Unpaired

Show:

- Android mobile-local runtime active;
- capability matrix;
- pairing unavailable/unpaired;
- private categories deferred or unavailable.

Do not show:

- private messages;
- contacts;
- calls;
- signals;
- approval queues sourced from private desktop data.

### Pairing requested

Show:

- pending pairing state;
- request instructions;
- no private data.

Do not show:

- private cockpit categories.

### Paired limited

Show:

- paired state;
- permitted capability groups;
- redacted notification status;
- mobile-local diagnostics.

Do not show:

- categories not granted by pairing scope.

### Revoked / lost / stale

Show:

- trust unavailable;
- re-pair required;
- private categories unavailable.

Do not show:

- cached private data;
- stale private derived views.

## Minimum Implementation Requirements

Before implementing Android pairing state in runtime code, tests must prove:

- unpaired Android sees no private categories;
- pairing requested grants no private categories;
- paired limited shows only granted capabilities;
- revoked device loses paired capabilities;
- lost-device state disables push routing;
- stale pairing does not silently renew;
- app reinstall does not restore trust automatically;
- unavailable desktop API is labeled clearly;
- capability matrix updates by trust state.

## Recommended First Implementation Slice

Recommended next slice:

Android Runtime Slice 010 - Android pairing status surface

Why:

- This is the first real meat after the policy gates.
- It is implementation, not just reporting.
- It can be done without private database replication.
- It creates the UI/runtime place where later private-data capabilities will attach.
- It keeps the Android cockpit moving toward real use while preserving the safety boundary.

Acceptance target:

- renderer or Tauri shell exposes a pairing status model;
- Settings or Android runtime status shows one of:
  - unpaired;
  - pairing requested;
  - paired limited;
  - revoked;
  - lost;
  - stale;
- capability matrix reflects pairing status for push notifications and device pairing;
- tests cover unpaired and paired-limited states at minimum;
- no private messages or contacts are stored on Android;
- no approval authority is granted.

## Closeout Criteria for This Report

This report is complete when:

- it is committed under reports/;
- repo validation passes;
- no runtime files are changed;
- Android Runtime Slice 010 is selected as implementation work.