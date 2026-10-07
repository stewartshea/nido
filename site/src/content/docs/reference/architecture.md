---
title: Architecture
description: Two containers, one encrypted SQLite file per family, and why the file is the tenant boundary.
---

## Shape

```
api/     Hono API, per-family encrypted SQLite
web/     SvelteKit client
deploy/  Docker Compose and Kubernetes manifests
docs/    Design specs and backlog
```

| Layer | Choice |
| --- | --- |
| Backend | TypeScript + [Hono](https://hono.dev), JWT auth, Zod validation |
| Frontend | [SvelteKit](https://svelte.dev/docs/kit) + Tailwind |
| Database | No external database service. SQLCipher-encrypted SQLite via `better-sqlite3-multiple-ciphers` |
| Deployment | Two containers (`api`, `web`), data on a volume |

## The tenant boundary is a file

Every family gets its own SQLCipher-encrypted SQLite file at
`db/<familyId>.db`, opened through `getFamilyClient(familyId)`. Alongside it,
`registry.db` holds only email → family routing and instance settings.

The consequence is worth stating plainly: **there is no `WHERE family_id = ?`
filter inside a family database, because there is no need for one.** The file
itself is the boundary. Every query against a family database is trusted to be
within that family by construction.

That inverts the usual review instinct. The question at each call site is not
"is this query scoped?" but "has access control already run, before this file
was opened?" Authorization lives in `authz.ts`, ahead of `getFamilyClient()` —
never in a query, and never after.

:::caution[`familyId` is attacker-influenceable]
It comes straight from the JWT payload and is used to build a filesystem path.
It must pass `assertFamilyId()` / `FAMILY_ID_RE` (`^[A-Za-z0-9-]{10,64}$`)
before it touches the filesystem or a SQL string. Never interpolate a raw
`familyId` — or any other request-derived string — into a path or a query.
:::

## Key derivation

`NIDO_MASTER_KEY` is a single instance-wide secret. Every database is keyed by
HKDF-SHA256 of it:

| Database | Salt | Info |
| --- | --- | --- |
| `db/<familyId>.db` | the family id | `nido:db` |
| `registry.db` | `nido:registry` | `nido:registry` |

The `'nido:db'` and `'nido:registry'` strings are **part of the data format**.
Changing one re-derives every subkey and makes existing databases unreadable
with nothing to signal it.

The two `deriveKey(..., familyId, ...)` call sites in `db-namespaces.ts` — one
on attach, one on provision — must stay identical. If they drift, a database
opens on one path and fails to decrypt on the other, which is a miserable
failure to diagnose.

## Registry vs family data

`registry.db` only maps email → family id and holds instance-wide settings
(`app_settings`). Per-family application data — records, blobs, settings —
belongs in the family namespace and must never be written to the registry.

## API conventions

| Concern | Rule |
| --- | --- |
| Auth | JWT with a 24h expiry, carrying `userId`, `email`, `familyId`, `role`. Never mint a token without an expiry; never trust a `familyId` from anywhere but a verified JWT. |
| Query construction | Parameterized only. Every route uses `execute({ sql: '…', args: [...] })`. |
| Body validation | Every mutating request body goes through `zod` before it touches the database. |
| Uploads | MIME-validated (`mime.startsWith('image/')`) and scoped by `blobs.family_id`. Never trust a client-supplied filename or path. |
| Bulk movement | `GET /families/:id/export` and `POST /families/:id/restore`, owner/admin-gated. Extend these rather than adding a parallel import path. |

## Client-side

Client writes that might fail offline are queued in `localStorage` under
`nido.outbox`, capped at the most recent 200 entries, and flushed on page mount
and every 60 seconds. That is what lets you log a 3am feed in a basement and
watch it sync later.

## Growth tracking

Weight, height and head circumference are compared against **WHO Growth
Standards** (breastfed infants, 0–2 years) and **CDC Growth Charts** (US
population-based, extended to 2–20 years), producing percentile rankings and
growth velocity. The full design is in `docs/growth-tracking-spec.md` in the
repository.

Nido is a record-keeping and charting tool. It is not a medical device, does
not diagnose, and is not a substitute for a paediatrician.

## Notifications

Notification rules are **family-wide**. Any caregiver can add one, every caregiver
sees every rule and every alert, and each rule is attributed to whoever set it.
Rules for both tracking and inventory live on one page, `/notifications`.

What you choose per inventory rule is **who gets emailed** — the whole family, or
named caregivers. Only caregivers with a confirmed address can be emailed, so only
those appear in the picker. The audience governs email only: everyone in the family
still sees everything, because the stock is shared and hiding it from the household
helps nobody.

The API emails newly firing inventory alerts on a timer, so nothing needs to be
open in a browser. It is a timer inside the API process because a self-hosted
install is one API container and one volume — evaluating is cheap, and families
with no rules are skipped before their stock is read.

Two details worth knowing:

- A rule that matches keeps showing as firing, but each caregiver is **emailed
  once per crossing**, not once per day, until the condition clears or its repeat
  window elapses. That bookkeeping is per person, so one address bouncing does
  not stop the others being told.
- Reading the page never consumes a notification — only delivery records it.
- The digest covers **inventory alerts only**. Tracking reminders appear in the
  app but are not emailed yet.

**Running more than one API replica?** Set `NOTIFY_ENABLED=false` on all but one.
Replicas sharing a volume also coordinate through a lease in `registry.db`, but
replicas on separate volumes have separate registries and cannot see each other,
which is what the flag is for. `NOTIFY_INTERVAL_MINUTES` (default `60`) controls
the interval; `GET /api/v1/notifications/status` reports the live configuration.

The full design, including how the scheduler crosses the tenant boundary and the
seam a future queue would slot into, is in
`docs/notifications-architecture.md` in the repository.

## On-disk layout

```
/data
├── registry.db              # email → family routing, app settings
├── db/
│   └── <familyId>.db        # one encrypted file per family
└── blobs/                  # encrypted uploads (avatars + attachments)
```

The databases are never part of an image, so image builds and pulls carry no
database state. See [Containers & volumes](./containers/).
