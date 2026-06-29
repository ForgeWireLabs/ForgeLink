# Email Channel

Email is a provider-neutral ForgeLink channel for durable, auditable, **non-urgent**
communication — a fallback and long-form channel. It is never the default
human-approval loop, and a mailbox sender is never trusted without explicit contact
policy.

## Shipped vs deferred (work item 018)

**Shipped (this slice):**
- Provider-neutral email contracts (EMAIL-001): outbound message, inbound
  normalization, attachment bounds, delivery/failure classification, credential
  validation, and disabled state — SMTP-compatible, not coupled to one provider.
- Outbound sending behind the channel registry (EMAIL-003): an `email_send` adapter
  with a deterministic test matrix (success, provider rejection, missing
  credentials, invalid recipient, attachment bounds, retryable vs permanent
  failure). Registered only when SMTP is configured.
- Diagnostics redaction (part of EMAIL-007): `/api/diagnostics` reports
  `email_configured` as a boolean only — never the host, address, or credentials.

**Deferred (tracked in work item 018):**
- EMAIL-002 secure credential storage UI (safeStorage) — today SMTP config comes
  from environment variables (below).
- EMAIL-004 inbound email (IMAP poll / provider webhook) — the normalization
  contract (`parseInboundEmail`) exists and is tested; the polling/ingest loop,
  duplicate detection, and contact resolution are not wired yet.
- EMAIL-005 configuration and contact-email-identity UI.
- EMAIL-006 signed quick-action boundaries (anti-replay, expiration, contact
  policy, local pending-action verification).
- EMAIL-007 full backup/export/retention participation for stored email.

## Operator setup

Configure SMTP submission via environment variables (provider-neutral; the
defaults assume implicit TLS on 465):

```text
FORGELINK_SMTP_HOST=smtp.your-provider.example
FORGELINK_SMTP_PORT=465            # 465 = implicit TLS; 587 = STARTTLS
FORGELINK_SMTP_SECURE=1            # optional; defaults to true on port 465
FORGELINK_SMTP_USER=ops@your-domain.example
FORGELINK_SMTP_PASS=<app password or SMTP token>
FORGELINK_SMTP_FROM=ForgeLink <ops@your-domain.example>
```

The email channel is **disabled by default** and registers only when host, user,
password, and from address are all present. With it unset, `email_configured` is
`false` and no email is sent.

## Likely provider requirements

- An SMTP submission endpoint (465 implicit TLS, or 587 with STARTTLS) and
  `AUTH LOGIN` credentials — typically an app password or a dedicated SMTP token,
  not the account's primary password.
- A `From` address the provider authorizes for submission. SPF/DKIM/DMARC alignment
  is the operator's responsibility for deliverability.

## Privacy limits

- ForgeLink does **not** claim end-to-end encryption; transport is TLS to the SMTP
  provider, which can see message contents.
- Credentials are never logged or exposed to the renderer; support diagnostics
  exclude bodies, addresses, headers, attachments, and provider IDs by default.
- Outbound headers are sanitized (CR/LF stripped from subject and filenames) to
  prevent header injection.

## Failure modes

- **Not configured** → the adapter reports invalid credentials and refuses to send.
- **Transient** (SMTP 4xx, connection reset/timeout/DNS) → classified `retriable`.
- **Permanent** (SMTP 5xx, invalid recipient, attachment-bound violation) →
  classified non-retriable; bound violations are rejected before any send.
- Provider response bodies are never surfaced; callers get a redacted message.

## Testing strategy

- Deterministic unit tests (`backend/src/email.test.ts`, in `npm test`) exercise
  address/attachment validation, MIME assembly, error classification, inbound
  normalization, and the adapter send matrix using an **injected fake transport** —
  no SMTP server is contacted.
- The default SMTP transport (`sendSmtpEmail`) is a minimal submission client whose
  live behavior is **operator-verified** against a real provider (analogous to the
  opt-in live-Twilio test); the logic ForgeLink relies on is covered by the unit
  tests above.

## Bounds

- Subject ≤ 998 chars (CR/LF stripped); body ≤ 256 KB.
- Attachments: ≤ 10 files, ≤ 20 MB each, ≤ 25 MB total.
