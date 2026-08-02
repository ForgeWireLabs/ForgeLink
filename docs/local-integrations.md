# Local webhook and LAN integration boundary

ForgeLink includes a disabled-by-default boundary for operator-controlled local
systems. It is separate from public telecom webhooks and never makes the private
`/api/*` surface remotely accessible.

## Current capability

The authenticated operator endpoint `GET /api/local-integrations/capabilities`
returns a redacted contract and health document. The inbound contract is:

```text
POST /local-integrations/:integration_id/events
Content-Type: application/json
maximum body: 65536 bytes
```

Inbound requests can use either `X-ForgeLink-Local-Token` (or Bearer token) or
HMAC-SHA256. For managed integrations, the HMAC key is the hex SHA-256 digest of
the one-time credential (the server persists that digest, never the credential).
Signed requests provide `X-ForgeLink-Local-Timestamp` as Unix
seconds, `X-ForgeLink-Local-Nonce`, and `X-ForgeLink-Local-Signature`, computed
over `timestamp + "." + nonce + "." + exact_body`. Signatures have a five-minute
window and nonces cannot be replayed within that window.

The shipped inbound schema has `schema_version: 1`, a stable `event_id`,
`event_type: "agent_message"`, an ISO `occurred_at`, and a bounded `payload` with
`title`, `body`, and optional `urgency` (`low` or `normal`). It normalizes into a
ForgeLink `local_notice` agent message. Event IDs are durably replay-protected;
malformed, unknown, urgent, unscoped, muted, or blocked inputs are rejected.
Authentication never grants approval or command authority.

## Enabling the boundary

The launch-authenticated management surface creates a credential exactly once:

```text
POST /api/local-integrations
POST /api/local-integrations/:id/rotate
POST /api/local-integrations/:id/revoke
POST /api/local-integrations/:id/enable
POST /api/local-integrations/:id/disable
```

Create/update accepts only the least-privilege `agent_message` and `actions`
scopes. List and capability responses contain redacted metadata, counters, and
health only. Credentials are stored as SHA-256 hashes and are returned only on
create or rotate. Revoked credentials cannot be re-enabled without rotation.

The desktop Settings page provides the complete operator workflow: create an ID
and label, select scopes, inspect enabled/credential/health state and accepted or
rejected counters, run a synthetic low-urgency test event, add or remove the
actions scope, rotate, disable, re-enable, and revoke. The main process writes the
one-time credential to `~/.forgelink/local-integrations/<id>.token`; the renderer
sees only the path and presence flag, never the credential value.

The route permits loopback callers and loopback `Host` values by default. LAN
access requires the additional explicit opt-in:

```text
FORGELINK_LOCAL_INTEGRATIONS_ALLOW_LAN=true
```

LAN opt-in permits only RFC1918 IPv4, IPv6 ULA, loopback, and operator-controlled
`.local`, `.lan`, or `.home.arpa` host names. Public source addresses and public
Host values remain rejected. If a browser supplies `Origin`, it must be local and
match the request Host. Server-to-server clients may omit Origin.

## Security and failure behavior

- The route is disabled when enablement or its secret is missing.
- JSON bodies are limited to 64 KiB before authentication or parsing.
- Each integration/source pair is limited to 30 attempts per minute.
- Invalid network scope, Host, Origin, authentication, stale signature, replay,
  content type, and payload size receive distinct stable error codes.
- Capability and diagnostics responses contain booleans and limits only; secrets
  and event content are never returned.
- LAN exposure increases the number of devices that can reach the boundary. Use a
  host firewall and a dedicated secret, and leave LAN mode off unless required.

## Failure modes

| Code or state | Meaning | Operator response |
| --- | --- | --- |
| `local_integration_disabled` | Integration is disabled, revoked, or not configured. | Enable it, or rotate a revoked credential before enabling. |
| `network_scope_rejected` | Caller is outside loopback/private LAN policy. | Keep the caller local; do not expose the route publicly. |
| `host_rejected` / `origin_rejected` | Host or browser Origin is outside the opted-in boundary. | Correct the local URL; do not bypass the check. |
| `authentication_required` | Token/HMAC is missing, stale, or invalid. | Rotate and replace the protected token file used by the integration. |
| `rate_limited` | The source exceeded 30 attempts in one minute. | Fix retry behavior and wait for the bounded window. |
| `payload_out_of_bounds` / `json_required` | Body is empty, oversized, or not JSON. | Send schema-v1 JSON below 64 KiB. |
| `schema_rejected` | Event type or bounded fields are malformed or unsupported. | Use `agent_message` with stable ID, ISO time, title, and body. |
| `scope_rejected` | Credential lacks the required capability. | Add only the necessary scope in Settings. |
| `policy_rejected` | Urgency, identity trust, or contact policy denied the event. | Review policy; local integrations cannot self-elevate. |
| `event_replay_rejected` / `action_replay_rejected` | A durable ID or token was already consumed. | Generate a new event ID or pending action. |
| `action_expired` | The signed pending action exceeded its TTL. | Create a new operator-owned pending action if still needed. |

Diagnostics intentionally omit event bodies, credentials, signatures, nonces,
and private message content. A failed synthetic test increments the same redacted
rejection health used for real local callers.

Public Twilio, Telnyx, and email webhooks remain under `/webhooks/*` and retain
their provider-specific signature rules. A local-integration credential is not a
provider credential, ForgeLink API token, MCP token, approval, or send authority.

## Pending actions and outcomes

The operator can create a scoped pending action with
`POST /api/local-integrations/:id/pending-actions`. ForgeLink returns a signed,
expiring token. The integration reports `succeeded`, `failed`, `cancelled`, or
`rejected` to `/local-integrations/:id/actions/:signed_token` while also presenting
its current credential. ForgeLink verifies the signature, integration binding,
expiry, credential, network boundary, and pending record before durably consuming
the token. A second use is rejected as replay. This records an outcome only; it
does not let the integration create an operator approval or execute a ForgeLink
action.
