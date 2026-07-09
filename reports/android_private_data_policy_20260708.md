# Android Private-Data Policy Report - 2026-07-08

## Purpose

This report defines the private-data boundary for ForgeLink Android before any Android message, contact, call, signal, or private database parity work begins.

This is a report-only slice.

No runtime behavior is changed by this report.

## Baseline

The current Android runtime baseline is:

- 39d75b3 Close out Android runtime capability matrix
- 9a68f3a Show Android runtime capability matrix
- 8d5dbdf Record Android mobile-local parity gap ledger

The Android capability matrix currently labels private messages and contacts as:

- Private messages: deferred pending policy
- Contacts: deferred pending policy

This report is the policy gate required before those categories can move from deferred to implemented.

## Policy Principles

ForgeLink Android is a full cockpit target, but full cockpit does not mean unrestricted local private-data replication.

Android private-data expansion must be:

- explicit;
- operator-visible;
- testable;
- reversible;
- scoped by data category;
- safe under lost-device assumptions;
- safe under revoked pairing;
- safe under app reinstall or downgrade;
- safe when the desktop local service is unavailable.

## Definitions

### Source of truth

A source-of-truth store is authoritative. Losing it or corrupting it can lose real user data.

Current policy:

- Android must not become source of truth for private desktop data in the next implementation slice.
- Desktop/local service remains source of truth for private messages, contacts, calls, trusted signals, governance records, and backups unless a later report explicitly changes this.

### Cache

A cache is a bounded local copy that can be deleted and rebuilt from an authoritative source.

Current policy:

- Android private-data caches are deferred until pairing, encryption, retention, wipe, and rollback rules are implemented and tested.

### Derived view

A derived view is a minimal, redacted, non-authoritative representation used for status or routing.

Current policy:

- Derived views may be considered before full caches.
- Derived views must not contain raw message bodies, full contact records, provider credentials, tokens, attachment contents, or unredacted evidence packs.

### Runtime metadata

Runtime metadata is non-secret state needed to operate the mobile runtime safely.

Current policy:

- Android may persist limited runtime metadata when it is redacted and non-authoritative.

Current allowed examples:

- attention policy;
- agent-channel redacted metadata;
- capability status labels;
- local runtime preferences.

## Data Category Policy

### Category 001 - Attention policy

Status:

- Allowed mobile-local runtime metadata.

Storage class:

- Runtime metadata.

Source of truth:

- Mobile-local copy is acceptable for the Android runtime.
- It does not make Android authoritative for private message history or contacts.

Allowed:

- operator mode;
- notification preferences;
- quiet hours;
- redaction preferences;
- local presence preference flags;
- muted source identifiers.

Forbidden:

- provider credentials;
- raw private message content;
- contact database replication;
- hidden surveillance or location collection.

### Category 002 - Agent-channel metadata

Status:

- Allowed mobile-local runtime metadata when redacted.

Storage class:

- Runtime metadata.

Source of truth:

- Mobile-local redacted metadata may exist.
- Token values and secrets remain forbidden.

Allowed:

- channel id;
- label;
- enabled/disabled state;
- configured flag;
- token file presence flag;
- rotation timestamp;
- rejection/rate-limit counters.

Forbidden:

- token values;
- credential contents;
- private agent message bodies unless governed by a later private-data policy slice;
- raw evidence packs.

### Category 003 - Private messages

Status:

- Deferred pending future implementation.

Storage class:

- Private data.

Source of truth:

- Desktop/local service remains source of truth.

Allowed now:

- capability label that private messages are deferred pending policy;
- redacted notification category text;
- empty/unavailable offline states.

Forbidden now:

- copying the desktop message database to Android;
- storing raw SMS/MMS/email/agent message bodies on Android;
- storing attachments or media on Android;
- offline draft source-of-truth records;
- local message search indexes;
- provider delivery payload archives.

Future implementation prerequisites:

- pairing trust lifecycle;
- encryption-at-rest decision;
- retention policy;
- wipe behavior;
- rollback behavior;
- export behavior;
- tests proving revoked pairing blocks access;
- tests proving uninstall/reinstall behavior is safe.

### Category 004 - Contacts and people

Status:

- Deferred pending future implementation.

Storage class:

- Private data.

Source of truth:

- Desktop/local service remains source of truth.

Allowed now:

- capability label that contacts are deferred pending policy;
- redacted relationship/status summaries if a future slice explicitly adds derived views.

Forbidden now:

- copying the contact database to Android;
- storing phone numbers, email addresses, names, contact notes, policy flags, relationship metadata, or identity links on Android;
- creating Android-local contact records;
- using Android contacts as implicit ForgeLink identities.

Future implementation prerequisites:

- identity boundary report;
- pairing trust lifecycle;
- per-field redaction policy;
- retention and wipe behavior;
- conflict handling;
- tests proving unknown/revoked devices cannot read contacts.

### Category 005 - Calls

Status:

- Desktop-only for current Android runtime.

Storage class:

- Private data.

Source of truth:

- Desktop/local service remains source of truth.

Allowed now:

- capability label that calls are desktop-only;
- future redacted call-status derived view after explicit policy.

Forbidden now:

- storing call history on Android;
- storing numbers, call participants, recordings, transcripts, or provider callbacks on Android;
- initiating voice actions from Android without an explicit future authority gate.

### Category 006 - Trusted signals

Status:

- Desktop-only for current Android runtime.

Storage class:

- Private data / advisory data depending on source.

Source of truth:

- Desktop/local service remains source of truth.

Allowed now:

- capability label that signals are desktop-only.

Forbidden now:

- storing signal feed content on Android;
- caching signal summaries on Android;
- using Android-local signals to grant authority.

Future implementation prerequisites:

- advisory-only signal policy;
- retention and source labeling;
- prompt-injection sanitation tests;
- offline behavior rules.

### Category 007 - Push notifications

Status:

- Requires pairing.

Storage class:

- Notification metadata.

Source of truth:

- Desktop/local service remains source of truth.

Allowed now:

- lock-screen-safe category text;
- redacted notification payloads;
- notification tap routing into cockpit when supported by a future slice.

Forbidden now:

- approval, deny, defer, or send actions directly from notification actions;
- unredacted private content on lock screen by default;
- push payloads containing full message bodies, contact names, phone numbers, email addresses, amounts, or evidence excerpts unless a later explicit policy changes the default.

### Category 008 - Device pairing

Status:

- Requires pairing.

Storage class:

- Trust metadata.

Source of truth:

- Desktop/local service should remain authoritative for paired-device trust.

Allowed now:

- capability label;
- future pairing status display.

Forbidden now:

- treating app install as pairing;
- treating device identity as operator consent;
- granting Android approval authority without explicit pairing and authority rules;
- bypassing revoked-device checks.

## Retention Rules

Current rule:

- Android mobile-local private-data retention is not enabled.

Allowed retained Android-local state:

- attention policy;
- redacted agent-channel metadata;
- runtime preferences;
- capability labels/status.

Deferred retained state:

- private messages;
- contacts;
- calls;
- trusted signal content;
- evidence packs;
- raw notification payload history;
- attachments.

Future private-data retention must define:

- maximum retention duration;
- per-category deletion behavior;
- operator-triggered wipe;
- automatic wipe after revoked pairing;
- downgrade and rollback behavior;
- backup/export participation.

## Export Rules

Current rule:

- Android private-data export is not enabled.

Allowed export now:

- none for Android private data.

Deferred export:

- Android local messages;
- Android local contacts;
- Android local calls;
- Android local signals;
- Android local evidence.

Future export must define:

- redacted default export;
- full export only by explicit operator action;
- provenance labels;
- pairing status included in export metadata;
- exclusion of secrets.

## Wipe Rules

Current rule:

- Android mobile-local wipe behavior must be simple because allowed state is narrow.

Allowed wipe target:

- mobile-local attention policy;
- mobile-local agent-channel redacted metadata;
- runtime preferences.

Required future wipe behavior before private-data parity:

- wipe on revoked pairing;
- wipe on operator command;
- wipe or quarantine on incompatible schema;
- wipe or block on downgrade if data safety cannot be guaranteed;
- clear operator-visible status after wipe.

## Rollback and Reinstall Rules

Current rule:

- Reinstall and rollback must not be assumed safe for private data because private Android data is not enabled.

Allowed behavior now:

- rebuild mobile-local runtime defaults;
- show degraded/unavailable status;
- require re-pairing before any paired capability.

Forbidden behavior now:

- resurrecting old private Android data after reinstall;
- silently reusing stale pairing trust;
- keeping private caches across downgrade.

Future implementation must test:

- app reinstall;
- app downgrade;
- revoked pairing;
- schema mismatch;
- missing desktop service;
- wiped mobile-local state.

## Minimum Test Requirements Before Android Private-Data Implementation

Before private messages, contacts, calls, or signal content may be persisted on Android, tests must prove:

- unavailable desktop API is clearly labeled;
- unpaired device cannot read private categories;
- revoked pairing cannot read private categories;
- wiped device cannot recover private categories;
- downgraded app blocks or quarantines incompatible private data;
- lock-screen notifications remain redacted by default;
- private data is excluded from logs and diagnostics;
- source-of-truth rules are visible in operator-facing UI;
- retention and export rules are enforced.

## Current Decision

Android may continue implementing cockpit clarity and safe runtime metadata.

Android must not implement local private-data parity yet.

Private messages and contacts remain:

- deferred pending implementation slice;
- blocked from mobile-local storage;
- visible as unavailable/deferred in the capability matrix.

## Recommended Next Slice

Recommended next slice:

Android Runtime Slice 009 - Android pairing and trust lifecycle report

Why:

- Private-data policy now depends on pairing and revocation semantics.
- Push notifications and device pairing are already labeled as requires pairing in the matrix.
- Pairing must be defined before private data or approval authority can safely expand.

Acceptance target:

- report-only slice;
- define pairing states;
- define revoke behavior;
- define lost-device assumptions;
- define what paired Android may request;
- define what pairing does not grant;
- select the first implementation slice that can safely follow pairing policy.