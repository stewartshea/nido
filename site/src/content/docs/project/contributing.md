---
title: Contributing
description: How to contribute to Nido, and the rules the codebase depends on.
---

Contributions are welcome — issues, documentation, and code.

## Start with `AGENTS.md`

The repository root has an [`AGENTS.md`](https://github.com/stewartshea/nido/blob/main/AGENTS.md)
that documents the design system, the tenant boundary, and the key-derivation
rules. Read it before writing code. It is short, and most of it exists because
something was already got wrong once.

## Local setup

```bash
git clone https://github.com/stewartshea/nido.git
cd nido
npm install          # installs the api and web workspaces
./scripts/init-env.sh
npm run dev          # docker compose up
```

Or run the services directly:

```bash
# terminal 1
cd api && npm run dev

# terminal 2
cd web && npm run dev
```

`npm run db:init` creates the registry database. Per-family databases are
created on first access.

## Tests

```bash
npm test             # both workspaces
cd api && npm test   # vitest
```

Running them in CI is on the [roadmap](./roadmap/) — until then, please run
them locally before opening a pull request.

## Conventions that are not negotiable

These are the ones that will be reviewed hardest, because violating them is
either a security hole or an unrecoverable data bug.

**The tenant boundary.** Every family gets its own encrypted SQLite file. There
is no `WHERE family_id = ?` filter inside a family database because the file
*is* the boundary. Never open another family's file to answer a request.
Authorization belongs in `authz.ts`, before `getFamilyClient()` is ever called.

**Key derivation.** Family keys come from HKDF-SHA256 of `NIDO_MASTER_KEY`,
salt = familyId, info = `'nido:db'`. Never derive a key any other way, never
reuse a subkey across families or purposes, never log or expose
`NIDO_MASTER_KEY` or a derived key.

**The derivation strings are the data format.** `'nido:db'` and
`'nido:registry'` in `db-core.ts` / `db-namespaces.ts` are part of the on-disk
format. Changing one makes every existing database unreadable with no error to
signal it. The two `deriveKey(..., familyId, ...)` call sites in
`db-namespaces.ts` — attach and provision — must stay identical to each other.

**Never trust `familyId`.** It comes straight from the JWT payload and is used
to build a filesystem path. It must pass `assertFamilyId()` / `FAMILY_ID_RE`
(`^[A-Za-z0-9-]{10,64}$`) before it touches the filesystem or a SQL string.

**Parameterized queries only.** Never concatenate request-derived input into
SQL.

**Validate mutating bodies with `zod`** before they reach the database.

**Registry vs family data.** `registry.db` only maps email → familyId and holds
`app_settings`. Per-family application data never goes there.

**Never hardcode colours.** The app has 7 palettes × light and dark as CSS
variables in `web/src/app.css`, surfaced through semantic Tailwind classes
(`bg-surface`, `text-ink`, `bg-primary`, `border-line`, …). A hardcoded hex
renders wrong in every theme except the one you eyeballed.

**Two font families.** Lora for display headings, Inter for body and UI. Not a
third.

## UI patterns that already exist

Inventing a second version of something is how a codebase drifts.

| Job | Use |
| --- | --- |
| Primary action | `h-11` (44px). Never ship a tappable element under `h-9` on a mobile page. |
| Content card | `bg-surface rounded-xl shadow-sm border border-line-soft p-4` |
| Add/edit record | `LogSheet.svelte` — the one bottom-drawer pattern |
| Primary nav on mobile | `BottomNav.svelte`, 48×48px minimum targets |
| Save/delete feedback | The existing toast — do not add a second alert mechanism |
| Plain enum picker | Native `<select>` |
| Picker needing icons | The custom trigger + backdrop-dismiss listbox |

**A wrapped or multi-row pill/chip list is banned as a primary selector.** It
wraps unpredictably on mobile web, wastes vertical space, and is hard to scan
and tap. This has been flagged more than once.

## Pull requests

1. Branch from `main`.
2. Make the change, and run `npm test`.
3. Explain *why* in the description — a diff is self-evident, the reasoning is
   not.
4. Call out anything touching key derivation, the tenant boundary, or the data
   format explicitly, so a reviewer knows to look.

## Security

Do not open a public issue for a vulnerability. Use a
[private security advisory](https://github.com/stewartshea/nido/security/advisories/new).
