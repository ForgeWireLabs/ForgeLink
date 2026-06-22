# Human Cards and operator aliases (work item 016, AGH-001)

Human Cards make ForgeLink's human authority *resolvable*. Instead of addressing
a person by phone number or contact string, an agent addresses a role:

```text
operator:primary
operator:release_approval
operator:security_approval
operator:emergency_only
```

A Human Card is the local record behind such an alias. It is **local data** and
is never sent to telecom providers or external channels.

## What a Human Card holds

| Field | Meaning |
| --- | --- |
| `alias` | Resolvable address, shaped like `operator:primary` (`^[a-z][a-z0-9_]*:[a-z0-9_]+$`). Unique. |
| `display_name` | Human-readable name shown on approval surfaces. |
| `role` | Role label (for example `operator`). |
| `availability` | `available`, `away`, `quiet`, … |
| `authority_scopes` | What this operator may approve (for example `release_approval`, `security_approval`, `general_approval`, `emergency`). Enforced by AGH-002. |
| `preferred_channels` | Ordered channel hints (for example `local`). |
| `quiet_hours` | Operator-private quiet-hours config. |
| `redaction_profile` | Default redaction profile for this operator (for example `desktop_full`). |
| `notes` | Operator-private notes. |

## Default seed

A fresh (and local-only) install always has a resolvable human authority: the
v11 migration seeds `operator:primary` with all approval scopes. No setup is
required for single-operator use.

## Alias resolution and fallback

Agents resolve an alias through the redacted, agent-reachable endpoint:

```http
GET /api/human-cards/resolve?alias=operator:release_approval
```

Resolution rules:

- An exact alias match is returned.
- An unconfigured `operator:*` alias **falls back to `operator:primary`**, so the
  well-known role aliases work without multi-operator setup. The response's
  `resolved_via` field reports which card actually matched.
- Non-`operator:*` aliases do not fall back; unknown aliases return `404`.

The resolved view is **redacted**: it exposes `alias`, `display_name`, `role`,
`availability`, `authority_scopes`, `preferred_channels`, and `resolved_via`.
Operator-private fields (`notes`, raw `quiet_hours`) are never returned to agents.

## Managing cards

Management requires the local launch token (the desktop app); the MCP/agent token
can only *resolve*, not list or edit.

```http
GET    /api/human-cards                      # list (launch only)
POST   /api/human-cards                       # create/update by alias (launch only)
DELETE /api/human-cards/operator:release_approval   # delete (launch only)
GET    /api/human-cards/resolve?alias=...     # resolve (agent-reachable, redacted)
```

`operator:primary` cannot be deleted — it is the guaranteed fallback authority.

## Security notes

- Human Cards are local operator records, not public identity documents. They are
  not published externally by default.
- A well-formed request does not grant authority. Authority-scope enforcement is
  defined by AGH-002; AGH-001 only makes authority *addressable and resolvable*.
- Schema ownership: `human_cards` is schema version **v11**, owned by work item
  016 per [decision 0011](../decisions/0011-schema-migration-coordination.md).
