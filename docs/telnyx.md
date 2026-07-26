# Telnyx SMS/MMS provider (work item 035)

Telnyx is a first-class ForgeLink SMS/MMS telecom edge behind the same
provider-neutral channel contract as Twilio. Operators can configure, validate,
select, inspect, and remove it from **Settings → Telnyx SMS/MMS**. Telnyx does not
replace the local communication model, and it does not provide ForgeLink voice.

## Prerequisites

In the Telnyx Mission Control Portal, prepare:

- an API v2 key;
- an SMS-capable E.164 phone number;
- an enabled messaging profile assigned to that number; and
- the account Ed25519 webhook public key from **Keys & Credentials**.

Telnyx documents that messaging numbers must be assigned to a messaging profile
before they can send or receive, and that the profile owns the webhook URL:

- <https://developers.telnyx.com/docs/messaging/messages/phone-number-configuration>
- <https://developers.telnyx.com/docs/messaging/messages/messaging-profiles-overview>
- <https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks>

Regulatory registration, toll-free verification, campaign management, number
purchasing/porting, billing, and voice/SIP are outside this integration.

## Configure in ForgeLink

1. During first-run choose **Configure Telnyx**, or later open
   **Settings → Telnyx SMS/MMS**. The Telnyx path is separate from Twilio setup and
   explains the messaging-profile and Ed25519 webhook model before asking for input.
2. Enter the API key, phone number, messaging profile ID, and base64 Ed25519
   webhook public key.
3. Choose **Test connection**. This performs read-only `GET` calls for the
   messaging phone number and profile. It verifies the exact number/profile
   relationship, SMS capability when Telnyx reports it, profile availability,
   and public-key shape. It does not mutate the Telnyx account.
4. Choose **Save and use Telnyx**. Secrets are stored with operating-system
   encryption, Telnyx becomes the selected SMS/MMS edge, and the local service
   restarts.
5. ForgeLink configures the selected messaging profile's primary webhook as
   `<public HTTPS base>/webhooks/telnyx` using Telnyx webhook API version 2. If no
   manual public base exists, ForgeLink starts its bounded automatic tunnel first.

Saving does not create, enable, or reassign profiles or phone numbers. The only
Telnyx account mutation is the primary webhook URL/version on the exact profile
the operator supplied and validated.

The renderer sees only redacted status: credential source, phone number, profile
ID, selection, and secret-presence booleans. It never receives the API key or
public key. Provider response bodies are not surfaced in errors.

## Select a provider

Saving Telnyx selects it for SMS/MMS. When both providers are configured, Settings
shows the active edge and offers **Use Twilio for SMS/MMS**. The selection applies
consistently to ordinary sends, retries, and approved outbound drafts. ForgeLink
does not silently choose the first registered adapter.

The provider-neutral Settings overview also offers **Use local-only mode**. This
sets the selection to `none` without deleting stored Twilio or Telnyx credentials.
The shared cockpit then reports that no telecom provider is selected and disables
external SMS/MMS sends until a configured provider is chosen.

The shared cockpit shows an active edge in Channels, the conversation composer,
the new-message dialog, and the reviewed outbox only when one is selected. Those
surfaces report Telnyx SMS/MMS readiness without implying Twilio-shaped credentials
or Telnyx Voice support.

Removing stored Telnyx credentials selects Twilio only when Twilio is actually
configured. Otherwise ForgeLink returns to local-only; it never represents an
unavailable provider as the active edge.

Twilio remains the voice edge. Selecting Telnyx for SMS/MMS does not change voice
behavior.

## Environment fallback

Existing non-interactive deployments may still use:

```powershell
$env:TELNYX_API_KEY = "KEY..."
$env:TELNYX_PHONE_NUMBER = "+15551234567"
$env:TELNYX_PUBLIC_KEY = "base64-ed25519-public-key"
$env:TELNYX_MESSAGING_PROFILE_ID = "00000000-0000-4000-8000-000000000000"
$env:FORGELINK_SMS_PROVIDER = "telnyx"
```

Environment values are not copied to disk automatically. Settings reports the
source as `environment`; saving through the form moves the supplied/retained values
into the OS-encrypted store. A legacy environment with only the API key and phone
number remains outbound-capable but is reported as incomplete for signed inbound
webhooks until the public key and profile ID are supplied.

## Inbound and status webhooks

Telnyx posts JSON events signed with Ed25519 over
`${telnyx-timestamp}|${rawBody}`. ForgeLink verifies the exact raw body and rejects
missing, invalid, tampered, more-than-five-minutes-old, or more-than-five-minutes-
future signatures before parsing the event.

- `message.received` events are normalized into the local inbox. SMS and MMS media
  URLs follow the provider-neutral message contract.
- `message.sent` and `message.finalized` events update the matching provider
  message ID. Other authentic event types are acknowledged and recorded as
  unsupported; they are never guessed to be delivery updates.
- Every valid envelope is first durably queued by Telnyx `data.id`, with its
  `occurred_at`, receipt/signature time, attempt, message ID, payload hash, and a
  hash of `meta.delivered_to`. The public route then acknowledges it and the local
  runtime processes pending events in occurrence order.
- Duplicate event IDs and inbound message IDs are idempotent. A restart drains any
  event that was committed but not yet processed.
- Duplicate or backward delivery-status transitions are ignored.

The raw payload is bounded to 64 KiB and retained only while processing or failed
recovery remains necessary; successful and unsupported events clear it while
retaining their non-content event ledger. The delivery target is never retained as
a raw URL. This lets ForgeLink acknowledge quickly without turning private webhook
content or URL secrets into an indefinite audit record.

## Outbound and diagnostics

Outbound messages use `POST https://api.telnyx.com/v2/messages` with `from`, `to`,
`text`, optional `media_urls`, and the configured `messaging_profile_id`. The local
message row receives the provider message ID and normalized status.

`/api/config-status` and `/api/diagnostics` report the selected provider and
redacted configuration booleans. They never include Telnyx credentials, signing
keys, provider response bodies, message contents, or private webhook URLs.

## Tauri posture

The shared cockpit bridge includes the Telnyx settings/status commands so the UI is
not forked. The current Tauri local-service and secure-provider-storage parity gate
remains owned by work item 032; Tauri reports
`desktop_local_service_required` and does not claim or fake usable Telnyx credentials.
