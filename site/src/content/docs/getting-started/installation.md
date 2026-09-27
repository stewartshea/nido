---
title: Installation
description: Get Nido running locally or on a server with Docker Compose.
---

Nido ships as **two containers** — `api` and `web` — plus a data volume. There
is no external database service to install, and no account to create before you
can try it.

## Requirements

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`)
- Node.js 18+ — only if you plan to run the services outside containers
- Roughly 1 GB of free disk for the images, plus whatever your family's data needs

You do not need a domain, a public IP, or a TLS certificate to get started.
Everything below runs on `localhost`.

## Local development

This is the shortest path to a working instance, and it is also the
configuration to copy when you move to a server.

```bash
git clone https://github.com/stewartshea/nido.git
cd nido
./scripts/init-env.sh   # writes .env with freshly generated secrets
docker compose up -d
```

`init-env.sh` generates a `NIDO_MASTER_KEY` and a `JWT_SECRET`, writes them
into a `.env` at mode `0600`, and **refuses to overwrite an existing `.env`**.
That refusal is on purpose — the master key cannot be rotated once family
databases exist, and an accidental overwrite would destroy your only copy.

Then open:

- <http://localhost:3001> — the web client
- <http://localhost:3000/health> — API health check

:::caution[Do not skip `init-env.sh`]
`cp .env.example .env` on its own is not enough. A blank value counts as
missing, and Compose fails during variable interpolation before any container
starts:

```
error while interpolating services.api.environment.[]:
required variable NIDO_MASTER_KEY is missing a value
```

That is the intended failure mode, not a bug — see
[the master key](../reference/security/#the-master-key).
:::

## Single-host server

The `deploy/docker-compose/` directory holds a production-shaped Compose file
that keeps data on a named volume instead of a host bind mount.

```bash
cd deploy/docker-compose

cp .env.example .env
# edit .env: set NIDO_MASTER_KEY and JWT_SECRET
./../../scripts/init-env.sh   # or paste in: openssl rand -hex 32

docker compose up -d --build
```

Differences from the development stack:

- Data lives on the **named volume `nido-data`** mounted at `/data`
- `NIDO_MASTER_KEY` and `JWT_SECRET` are both mandatory, and Compose fails fast
  if either is unset
- The API has a `/health` healthcheck; both services `restart: unless-stopped`

## Prebuilt images

CI publishes images to GHCR on every push to `main` and on `v*` tags. To pull
instead of building:

```bash
echo "$CR_PAT" | docker login ghcr.io -u stewartshea --password-stdin
```

Then swap the `build:` / `image:` blocks in the Compose file:

```yaml
api:
  image: ghcr.io/stewartshea/nido/api:latest
web:
  image: ghcr.io/stewartshea/nido/web:latest
```

Per-commit tags (`sha-<commit>`) are available if you would rather pin.

## What runs where

| Service | Port | Holds |
| --- | --- | --- |
| `api` | `3000` | Reads and writes the encrypted databases under `/data` |
| `web` | `3001` | SvelteKit client; proxies `/api` to the API service |
| volume | `/data` | `registry.db`, `db/<familyId>.db`, `photos/` |

The databases are **not** part of any image, so image builds and pulls never
carry database state with them. A root `.dockerignore` also excludes `data/`,
`**/*.db*`, `node_modules/`, `.git/` and `.env*` from every build context, so
local dev data cannot be baked into an image regardless of which Compose file
or `docker build` invocation you use.

## Running outside Docker

Useful for development; not recommended for a real family's data.

```bash
npm install          # installs the api and web workspaces

# terminal 1
cd api && npm run dev

# terminal 2
cd web && npm run dev
```

`npm run db:init` creates the registry database. Per-family databases are
created on first access.

## Next

- [First run](./first-run/) — create the first account, add a baby, invite a caregiver
- [Configuration](../reference/configuration/) — every environment variable
- [Reverse proxy & TLS](../guides/reverse-proxy-and-tls/) — putting it behind a domain
