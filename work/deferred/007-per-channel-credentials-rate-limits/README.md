# 007 - Per-Channel Credentials And Rate Limits

> **Status**: Deferred.
> **Owners**: Security Agent, Backend Agent, Data Agent, UI Agent.
> **Depends on**: Work items `003` and `005`.

## Intent

Harden agent-channel access so ForgeLink does not become a local spam pipe. The
current bridge can use the local launch token. That is acceptable for early
trusted local use, but durable external integrations need separate channel
credentials, revocation, and rate limits.

## In Scope

- Channel registry with stable channel ids and human-readable labels.
- Separate channel credentials for agent-channel message creation.
- Credential creation, rotation, revocation, and disable/enable flows.
- Per-channel rate limits.
- Urgency-aware limits so `urgent` cannot be abused.
- Backend rejection paths that are auditable without logging message bodies.
- Settings UI for channel administration.
- Data lifecycle behavior for channel metadata.

## Out Of Scope

- Public network exposure. The API remains loopback unless a future threat model
  says otherwise.
- OAuth or third-party hosted identity.
- RSS feed policy; that belongs to `008` and `009`.

## Design Questions

- Should credentials be stored in SQLite encrypted by OS storage, or in an
  operating-system credential store with SQLite metadata only?
- Should rate limits be token bucket, fixed window, or simple rolling window?
- Should revocation preserve a channel audit row forever, or follow retention?

## Closeout Evidence

Close only with backend tests, renderer tests, migration tests, security notes,
and a redaction audit showing no credential values or message bodies are logged.
