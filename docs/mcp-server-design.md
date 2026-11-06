# Nido MCP server — design

Status: draft for review (issue [#83](https://github.com/stewartshea/nido/issues/83))
Scope: v1 (embedded, token-authenticated, tools + one resource)

## Summary

Nido exposes its own operations as **MCP (Model Context Protocol) tools** so a
user's agent can read a family's data and log against it through the same
validated routes the web app uses. Nido runs no model and generates no summary:
it is the tool server. The agent is the user's client, running wherever they
already run it.

The payoff is reports and answers — "how much did the baby sleep this week?",
"what's due on the car?", "log three feeds at 40 mL each" — without Nido ever
learning what an LLM is.

## What this is, and isn't

- **Is**: an MCP endpoint (`POST /mcp`) mounted in the existing `api` container,
  plus a tool catalog that wraps routes and read models Nido already has.
- **Isn't**: a model call, a summary generator, or anything that runs when no
  agent is attached. With no agent, nothing changes.
- **Doesn't**: add a new way into family data. Every tool resolves a token to one
  `familyId`, passes `assertFamilyId()`, opens only that family's database, and
  calls an existing route. There is no new query logic and no second path to the
  database.

## Architecture

```
agent (Claude Desktop / Cursor / custom)
        │  Streamable HTTP, JSON-RPC 2.0
        │  Authorization: Bearer nido_mcp_…
        ▼
  POST /mcp  ── embedded in api (Hono)
        │  1. hash token → look up familyId in registry.db (mcp_tokens)
        │  2. assertFamilyId(familyId)
        │  3. getFamilyClient(familyId)
        │  4. build a per-request McpServer bound to that family
        │  5. each tool calls an existing /api/v1 route via internal fetch,
        │     with a short-lived JWT minted for the token's family
        ▼
  existing routes → getFamilyClient(familyId) → {familyId}.db
```

### Transport

**Streamable HTTP, stateless.** The official
`@modelcontextprotocol/sdk` ships `WebStandardStreamableHTTPServerTransport`,
which takes a Web `Request` and returns a Web `Response` — exactly what Hono
already passes around (`app.all('/mcp', (c) => transport.handleRequest(c.req.raw))`).
The SDK documents this Hono usage, so there is no Express adapter and no second
HTTP stack in the container.

- `sessionIdGenerator: undefined` — stateless. No `Mcp-Session-Id`, no
  server-side session state, no cross-request memory. This suits a tool server
  where every call is an independent authenticated request and lets the endpoint
  scale by adding replicas behind a load balancer with no sticky routing.
- Each request builds a fresh `McpServer` + transport bound to the resolved
  family, handles the request, then closes both. Nothing family-scoped outlives
  the request.
- SSE fallback is deliberately **not** offered. Streamable HTTP is the target
  and what the clients in use speak; the older HTTP+SSE transport is a second
  surface with no caller, so it is skipped. A plain `GET /mcp` (client opens a
  server→client stream) returns `405`.

### Process placement

v1 is a mounted route in `api`. The endpoint is stateless and cheap per request,
and it reuses the API's route logic, auth guard, DB clients and logger. A
separate process is a later option if MCP traffic needs to scale or be isolated
from the web API; the modular split (`routes/mcp.ts`, `mcp/`) is written so that
move is a wiring change, not a rewrite.

## Token model

One page, one button, one opaque token. No OAuth, no scopes, no flows.

1. **Settings → Agent access** lists the family's tokens and a **Generate
   token** button.
2. Pressing it mints `nido_mcp_` + base64url of 32 `crypto.randomBytes` and
   shows it **once**.
3. The registry stores a **SHA-256 hash** with a label, `family_id`,
   `created_by_user_id`, `created_at`, and `last_used_at`. The plaintext is
   never persisted and never logged.
4. **Revoke** deletes the row; access ends at the next request. Tokens do not
   expire — revoking is the control.

### Why the registry, not the family database

The `mcp_tokens` table lives in `registry.db` because it is **auth routing**
(token → `familyId`), the same kind of thing as email → `familyId` already
stored there — **not** per-family application data. A token resolves to exactly
one family and is never read across families. This matches the existing rule
that `registry.db` holds routing and instance settings only. The token's
`family_id` is the same opaque id carried in a JWT and is passed through
`assertFamilyId()` before it touches the filesystem or SQL.

### Token shape and hashing

```
nido_mcp_<43 chars base64url>            # 32 random bytes, urlsafe, unpadded
sha256(plaintext) → 64 hex chars         # the only form ever stored
```

A fixed `nido_mcp_` prefix makes a leaked token greppable and lets the endpoint
reject non-MCP credentials before any DB read. SHA-256 (not bcrypt) is right
here: the token is 256 bits of uniform randomness, so there is no dictionary to
slow down, and hashing must be fast on every request.

## Authentication flow

`POST /mcp` sits **outside** `/api/v1/*`, so the JWT guard does not apply. It
authenticates itself:

1. Read `Authorization: Bearer nido_mcp_…`. Missing or malformed → `401`.
2. `sha256(token)`; look up `mcp_tokens` by hash in the registry.
3. No row → `401` (the same response for unknown and revoked; nothing to probe).
4. Row found → `familyId`, `created_by_user_id`. `assertFamilyId(familyId)`,
   `getFamilyClient(familyId)`.
5. Update `last_used_at` (best-effort; a failure must not fail the call).
6. Build the per-request `McpServer` bound to `{ familyId, db }` and handle it.

Every tool then runs through the existing routes, which enforce the family
boundary themselves: `requireAuth` re-checks membership, and each handler opens
only the routed family's database.

### Internal calls use the real routes

A tool is a **thin, typed shell over an existing route**. To guarantee that —
rather than re-implementing queries — the tool layer calls the route through
Hono's own `app.fetch()`, minting a short-lived (60 s) JWT for the family with
the token's `created_by_user_id` as the actor:

```ts
internalFetch(familyId, userId, '/api/v1/feedings?memberId=7&from=…')
```

This means validation (`zod`), authorization (`familyAccess`), provenance
(`created_by`) and the logger are exactly the web app's — there is no second
code path that can drift. If the recorded creator is no longer in the family,
the caller falls back to any member of that family; if the family has no users
at all, the call is refused.

> Later refactor option: extract the read models into small service functions
> imported by both the routes and the tools, dropping the internal HTTP hop.
> The MVP keeps the hop because it is the strongest guarantee of "same route,
> same validation" for the least code.

## Tool catalog

Each tool maps to an existing route or evaluator. Reads use the same read models
the UI uses; writes go through the same `zod`-validated, parameterized routes.
An agent write is a normal write, attributed like any other.

### Read

| Tool | Leans on |
| --- | --- |
| `list_children` | `GET /families/members` scoped to children |
| `list_homes` | homes (#76) |
| `list_assets` | home assets (#65) |
| `get_feedings` | feedings route, date-ranged |
| `get_diapers` | diapers route, date-ranged |
| `get_sleep` | sleep route, date-ranged |
| `get_growth` | growth route + `growth-percentile.ts` |
| `get_milestones` | milestone/event records |
| `get_vaccinations` | vaccination records + schedule |
| `get_appointments` | appointment route |
| `get_journal` | journal route |
| `list_meters` | meters (#66) |
| `whats_due` | the **What's due** view (#67) |
| `get_maintenance_log` | maintenance log (#68) |
| `list_inventory` | inventory + `inventory-eval.ts` (#11) |
| `get_family_summary` | bounded, date-ranged rollup so "how was the week" is one call |

### Write

| Tool | Wraps |
| --- | --- |
| `log_feed` | feed route (breast / bottle / formula) |
| `log_diaper` | diaper route |
| `log_sleep` | sleep start/stop |
| `log_growth` | growth route |
| `log_milestone` | milestone route |
| `log_vaccination` | vaccination route |
| `create_appointment` | appointment route |
| `add_journal_entry` | journal route |
| `adjust_inventory` | inventory adjust (with reason) |
| `log_maintenance` | maintenance entry (#68) |
| `add_meter_reading` | meter reading (#66) |
| `add_asset` | home asset registry (#65) |
| `recount_inventory` | inventory recount (absolute quantity) |

Each record category above also ships an `update_*` (e.g. `update_feed`,
`update_diaper`), so an agent can correct what it logged. There is deliberately
no `delete_*`: see "No delete tool" above.

### Resource

`nido://family/export` — the existing `GET /api/v1/families/export` payload as an
MCP resource, so an agent can pull the whole family in one call. Not a parallel
export. (Owner/admin only, since the underlying route is.)

### Shipped so far

**MVP** (proved the shape end to end): token auth, `POST /mcp` with the SDK,
`list_children`, `get_feedings`, `get_diapers`, `get_sleep`,
`get_family_summary`, `log_feed`, and `nido://family/export`.

**Read catalog** (the full read surface): `get_growth` (with the route's WHO/CDC
percentiles), `get_milestones`, `get_vaccinations` (records + optional
schedule), `get_appointments` (schedule-derived upcoming + booked plans),
`get_journal`, `list_homes`, `list_assets`, `list_meters`, `whats_due`,
`get_maintenance_log`, `list_inventory`.

**Write catalog** (creates + updates): `log_feed` / `update_feed`, `log_diaper`
/ `update_diaper`, `log_sleep` / `update_sleep`, `log_growth` / `update_growth`,
`log_milestone` / `update_milestone`, `log_vaccination` / `update_vaccination`,
`add_journal_entry` / `update_journal_entry`, `create_appointment` /
`reschedule_appointment`, `add_asset` / `update_asset`, `adjust_inventory`,
`recount_inventory`, `add_meter_reading`, `log_maintenance` /
`update_maintenance`.

The record categories share one registration helper (`registerRecordWrites` in
`mcp/tools-write.ts`) because they are the same create-then-update shape over
`category-routes.ts`; the rest are bespoke tools over bespoke routes.

**No delete tool.** A delete is destructive and irreversible, and it earns its
own design — provenance, confirmation, and what an agent may undo — rather than
riding in on the logging surface. Creates and updates are additive and
reversible; deletes are neither.

The reads live in `mcp/tools-baby.ts` and `mcp/tools-home.ts`, the writes in
`mcp/tools-write.ts`, all built on `mcp/tool-kit.ts` (the result shape,
date-window filtering, and the thin fetchers). Still to come: record-level
provenance, then scale-out.

## Attribution

An agent write should be honest about who acted. Two layers:

- **Now**: a write made through MCP carries the token creator as `created_by`,
  and the request log records `via: mcp` with the token id. The record exists in
  the same log as any other.
- **Later**: a first-class provenance marker on the record ("logged via MCP").
  The schema is designed so adding a `source`/`via` column is additive; not part
  of this slice.

The open question in the issue ("leaning yes") is answered: yes, cheap and it
keeps the log honest. The `via: mcp` log line is the v1 form.

## Rate limiting

A runaway agent must not hammer the database. v1 adds a small in-memory,
per-token sliding-window limiter (default 120 requests/minute, counted per
`mcp_tokens.id`), returning a JSON-RPC error rather than a bare 429 so the agent
can back off. In-memory is correct for a single container; a multi-replica
deployment moves the counter to the registry (a `rate`/`window` row) later. The
limit is deliberately generous — it is a runaway guard, not a billing meter.

## Security notes

- The token is a bearer credential: never logged, never echoed after creation,
  never stored in plaintext.
- Unknown and revoked tokens get the same `401` body.
- `POST /mcp` never accepts a `familyId` from the client — only from the token
  row. `assertFamilyId()` runs before `getFamilyClient()`.
- The endpoint is exempt from CORS-relaxation assumptions: it is meant for
  non-browser agent clients, and the existing `secureHeaders()` middleware still
  applies.
- A tool cannot widen scope: it can only reach the routes, and the routes can
  only open the routed family's database.

## Open questions — resolved for v1

| Question | Decision |
| --- | --- |
| Attribution | Yes — `created_by` + a `via: mcp` log line now; a record-level marker later. |
| Rate limiting | Yes — in-memory per-token, 120/min, JSON-RPC error. |
| Process placement | Mounted route in `api` (v1); separate process is a later wiring change. |
| Transports | Streamable HTTP only. No SSE fallback. |

## Phasing

1. **MVP** — registry `mcp_tokens` table, token mint/list/revoke routes,
   `POST /mcp` with the SDK, a first handful of tools + the export resource,
   Settings → Agent access, tests. **Done.**
2. **Read catalog** — the full read surface (`tools-baby.ts`, `tools-home.ts`).
   **Done.**
3. **Write catalog** — the creates and updates (`tools-write.ts`). **Done.**
   Deletes are deliberately out of scope and were not added.
4. **Provenance** — a record-level `via` marker and richer logging.
5. **Scale-out** — registry-backed rate limiting and, if needed, a dedicated
   process.

## Testing

- Token lifecycle: mint returns plaintext once and stores only a hash; resolve
  by hash; revoke ends access.
- Isolation: a token for family A can never read family B — the resolved
  `familyId` is the only one opened.
- Protocol: `initialize`, `tools/list`, `tools/call` over `POST /mcp`;
  malformed and revoked tokens get `401`.
- A write through `log_feed` lands in the family's database and appears in the
  normal feed read.
- Every create in the write catalog lands a real record visible through the
  matching read; every update corrects it; and a token for family A cannot
  write into family B.
