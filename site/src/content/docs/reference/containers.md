---
title: Containers & volumes
description: What lives inside each image, and where the data actually is.
---

## Two images

| Image | Base | Exposes | Starts |
| --- | --- | --- | --- |
| `api` | Node 20 Alpine | `3000` | `npm start` |
| `web` | Node 20 Alpine | `3001` | `npm run dev -- --host` |

The `web` image runs the Vite dev server as its production entrypoint, which
means it proxies `/api` to the API service. That is deliberate: it keeps the
browser same-origin, so there is no CORS configuration anywhere in the stack.

## Databases are never in an image

The API reads and writes SQLCipher-encrypted files under `/data` on a
**mounted volume**. Image builds and pulls therefore never carry database
state with them — pulling a new tag cannot clobber your data, which is exactly
what makes `docker compose up -d` a safe upgrade.

```
/data
├── registry.db            # email → family routing, app settings
├── db/<familyId>.db        # one encrypted file per family
└── blobs/                # uploads
```

`api/Dockerfile` copies only source (`src`, `tsconfig.json`, manifests) and
never `data/` or any `*.db`.

## Build hygiene

A root `.dockerignore` excludes `data/`, `**/*.db*`, `node_modules/`, `.git/`
and `.env*` from every build context. Local development data cannot reach a
build daemon or be baked into an image, regardless of which Compose file or
`docker build` invocation you use.

## The two Compose files

| File | Data location | Use |
| --- | --- | --- |
| `docker-compose.yml` (root) | `./data` bind mount | Development — data as plain, inspectable host files |
| `deploy/docker-compose/docker-compose.yml` | `nido-data` named volume | Single-host deployment |

The root file bind-mounts the host folder so the databases and blobs live as
ordinary files you can inspect and back up with `tar`. The deploy file uses a
named volume, which needs a `docker run --rm -v …` incantation to archive.

Both require `NIDO_MASTER_KEY` and `JWT_SECRET`; the deploy file enforces it
in the Compose variable interpolation so it fails before building anything.

## Starting from clean state

To discard everything and begin again, reset the storage layer.

```bash
# named volume
docker compose down -v

# bind mount
docker compose down && rm -rf ./data
```

:::caution[Swapping images never clears data]
Changing tags, rebuilding, or `docker compose pull` all leave `/data` intact.
That is the intended property — but it also means "I updated and my old data is
still there" is not a bug. The volume is what holds state.
:::

## Published images

CI publishes to GHCR on every push to `main` and on `v*` tags:

```text
ghcr.io/stewartshea/nido/api:latest
ghcr.io/stewartshea/nido/web:latest
ghcr.io/stewartshea/nido/{api,web}:sha-<commit>
```

Per-commit tags are worth knowing about: they are what makes
[rollbacking an upgrade](../guides/upgrading/#roll-back) pin to exactly the
commit that was running before, rather than to a vague "previous release".
