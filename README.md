# 巣 Nido

A self-hosted newborn and infant tracker. Log feeds, diapers, sleep, growth,
milestones and vaccinations; share them with the other caregivers in your
family; keep the data on your own hardware.

<!-- prettier-ignore -->
> **On the name.** *Nido* means "nest" in Spanish and Italian. 巣 (*su*) is the
> Japanese kanji for "nest" and doubles as the project's mark. The two are a
> deliberate pairing, not a translation of each other.

## Features

- **Feeding** — breast and formula timers, side/session tracking, amounts
- **Diapers** — wet, soiled, dry and combinations
- **Sleep** — start/stop with live duration
- **Growth** — weight, height and head circumference against WHO/CDC percentiles
- **Milestones & vaccinations** — logging plus schedule
- **Photos** — per-member avatars and photo uploads (MIME-validated)
- **Journal & mood** — free-form notes per day
- **Shared family access** — invite caregivers, owner/admin/member roles
- **Reminders** — inactivity and interval nudges
- **Export / restore** — move a family's whole dataset as JSON
- **Offline queue** — writes made without a connection are queued and replayed
- **Themes** — 7 palettes × light/dark, plus a custom theme editor

## Quick start

```bash
git clone https://github.com/stewartshea/nido.git
cd nido
./scripts/init-env.sh   # writes .env with freshly generated secrets
docker compose up -d
```

The web client is on <http://localhost:3001>, the API on
<http://localhost:3000/health>.

### About the master key

Nido encrypts every family's database with a key derived from
`NIDO_MASTER_KEY`, and there is no default — deliberately. If the value is
missing or blank the API refuses to start, and `docker compose` fails during
variable interpolation with:

```
error while interpolating services.api.environment.[]:
required variable NIDO_MASTER_KEY is missing a value
```

`./scripts/init-env.sh` generates the key for you (`openssl rand -hex 32`) and
writes a `.env` at mode `0600`. It refuses to overwrite an existing `.env`,
because the key cannot be rotated once family databases exist.

Losing this key means losing every family's data. Back it up separately from
the data volume.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `NIDO_MASTER_KEY` | in production | Hex secret that keys every per-family database. `openssl rand -hex 32` |
| `JWT_SECRET` | in production | Signs session JWTs |
| `NIDO_DATA_DIR` | no | Data root. Default `/data` in Compose, `./data` locally |
| `ADMIN_EMAIL` | no | Grants platform admin on first boot |
| `SIGNUP_ENABLED` | no | Set to enable open registration |
| `PUBLIC_URL` | no | Origin used in verification/reset emails |
| `PHOTO_DIR` | no | Photo storage. Default `/data/photos` |
| `ALLOWED_HOSTS` | no | Hostnames the web server answers to. Default `localhost` |
| `API_PROXY_TARGET` | no | Where the web dev server forwards `/api` |

## Development

Requires Node.js 18+.

```bash
npm install          # installs the api and web workspaces
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

### Tests

```bash
npm test             # runs both workspaces
cd api && npm test   # vitest
```

## Architecture

- **Backend** — TypeScript + [Hono](https://hono.dev), JWT auth, Zod validation
- **Frontend** — [SvelteKit](https://svelte.dev/docs/kit) + Tailwind
- **Database** — no external database service. SQLCipher-encrypted SQLite via
  `better-sqlite3-multiple-ciphers`, **one file per family** at
  `db/<familyId>.db`, plus a `registry.db` holding only email → family routing
  and instance settings
- **Key derivation** — each family's file is keyed by an HKDF-SHA256 subkey
  derived from `NIDO_MASTER_KEY`. The encrypted file *is* the tenant
  boundary; there is no `WHERE family_id = ?` filter inside a family database
- **Deployment** — two containers (`api`, `web`) with data on a volume

```
api/    Hono API, per-family encrypted SQLite
web/    SvelteKit client
deploy/ Docker Compose and Kubernetes manifests
docs/   Design specs and backlog
```

## Deployment

- [`Docker.md`](Docker.md) — containers, volumes, environment
- [`deploy/docker-compose`](deploy/docker-compose/) — single-host Compose
- [`deploy/kubernetes`](deploy/kubernetes/) — single-pod and multi-pod
  manifests

Images are published to GHCR on every push to `main`.

## Security notes

If you report a vulnerability, please open a private security advisory rather
than a public issue.

A few things worth knowing before deploying:

- `NIDO_MASTER_KEY` and `JWT_SECRET` are both mandatory everywhere — root
  Compose, `deploy/docker-compose`, and Kubernetes. There is no fallback key and
  no default JWT secret. The API resolves both before it binds a port, so a
  misconfigured process exits instead of serving traffic.
- Choose `NIDO_MASTER_KEY` once, before any real data exists. It cannot be
  rotated later: every family's key is derived from it, and there is no
  recovery path without a backup of both the key and the data.
- Photos are stored unencrypted on disk and are served only through
  authenticated, family-scoped routes. A photo's original EXIF (including GPS)
  is preserved — strip it before uploading anything you would rather not keep.
- There is currently no maximum file-size check on photo uploads.

## Contributing

Contributions are welcome. Please read [`AGENTS.md`](AGENTS.md) first — it
documents the design system, the tenant boundary, and the key-derivation rules
that the rest of the codebase depends on.

## Roadmap

- Static build of the web client for GitHub Pages
- Photo size limits and server-side EXIF stripping
- Run tests in CI

## License

[Apache-2.0](LICENSE)
