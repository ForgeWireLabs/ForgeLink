---
id: 0005
title: Reconcile Work Item 011 (Production Readiness) with the 015-017 Roadmap
status: accepted
date: 2026-06-18
supersedes: []
---

# 0005: Reconcile Work Item 011 (Production Readiness) with the 015-017 Roadmap

## Context

Work item 011 is the original Twilio-Phone production-readiness plan (PR-001
through PR-016). PR-001-PR-005 shipped earlier; PR-006-PR-016 remained open with
no evidence. Since 011 was written the product evolved: RepoPact governance, and
a new roadmap in work items 015 (Communication Channels & Voice), 016
(Agent-Human Governance), and 017 (Operator Cockpit) that took ownership of
several areas 011 had only sketched.

The operator asked to "finish 011." It cannot be honestly marked complete today —
six of its open PRs are real, unstarted engineering, and INV-2/INV-3 forbid
closing criteria without satisfied state and linked evidence. This record
reconciles 011 against the current roadmap: close what is legitimately done,
waive what another work item now owns, and keep the genuine remaining baseline
explicit.

## Decision

Resolve 011's open criteria into three buckets:

**Waived — absorbed by the 015-017 roadmap** (work continues there, not in 011):
- **PR-007 contacts** -> 015 CLV-009/010/011 (rich contacts, contact points, policy).
- **PR-008 media** -> 015 (channel/media normalization model).
- **PR-009 notifications & deep links** -> 015 CLV-004 + 017 cockpit.
- **PR-012 accessibility** -> 017 (decision-surface accessibility).
- **PR-016 voice** -> 015 CLV-012/013. This also satisfies "decide voice scope":
  **Voice is accepted and owned by 015** (provider-neutral voice contract +
  Twilio Voice edge), rebuilt in TypeScript/Electron; the legacy SCOUT-2 iframe
  is explicitly rejected.

**Satisfied this session** (implemented with evidence):
- **PR-010 single-instance** — `app.requestSingleInstanceLock()` before app
  ready; a second launch focuses the first window and never forks a backend.
- **PR-015 support diagnostics** — authenticated `/api/diagnostics` returning
  versions and status with credential/message/contact/media values excluded
  (booleans only); unit-tested to not leak secrets.

**Remain genuine baseline in 011** (real, unstarted; 011 stays active):
- **PR-006** backend lifecycle (port-conflict detection, bounded restarts,
  diagnostics, clean shutdown).
- **PR-011** security verification suite (proxy-aware webhook tests, local API
  threat tests, secret/dependency scanning, redaction tests). Overlaps 016
  AGH-023.
- **PR-013** test pyramid (integration, lifecycle, installer, opt-in live).
- **PR-014** releases: real icon ✅ (002), installer ✅, checksums ✅ remain; code
  signing, auto-update, release notes, and a reproducible checklist are not done.
  Overlaps 017 OCX-020 (distribution/updates for the expanded surface).

## Alternatives considered

- **Mark 011 complete now.** Rejected: six PRs are unstarted; violates INV-2/INV-3
  and is exactly the drift this project guards against.
- **Implement all remaining PRs now.** Deferred: a large multi-iteration program
  (PR-014 also needs an operator-provided code-signing certificate).
- **Leave 011 untouched.** Rejected: it would keep claiming scope already owned by
  015/017 and hide what is genuinely left.

## Consequences

- 011 becomes a slimmer, accurate baseline-hardening item: PR-006/011/013/014
  pending, PR-010/015 done, PR-007/008/009/012/016 waived into 015/017.
- The voice decision is recorded; future voice work lives in 015.
- PR-014 and PR-011 explicitly cross-reference their 017/016 roadmap overlaps so
  the remaining work is not duplicated.
- 011 stays `active` until PR-006/011/013/014 are delivered with evidence.
