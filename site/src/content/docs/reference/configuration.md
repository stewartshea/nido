---
title: Configuration
description: Every Nido environment variable, when it is required, and what breaks without it.
---

## Required in production

Both of these have **no defaults, deliberately**. The API resolves them before
it binds a port, so a misconfigured process exits rather than serving traffic
with a well-known key.

| Variable | Purpose |
| --- | --- |
| `NIDO_MASTER_KEY` | Hex secret that keys every per-family database. `openssl rand -hex 32` |
| `JWT_SECRET` | Signs session JWTs |

A blank value counts as missing. Under Compose you see this at variable
interpolation time, before any container starts:

```
error while interpolating services.api.environment.[]:
required variable NIDO_MASTER_KEY is missing a value
```

:::danger[`NIDO_MASTER_KEY` is unrecoverable and unrotatable]
Every family database is keyed by an HKDF-SHA256 subkey derived from it, with
the family id as salt and `nido:db` as info. Losing the key loses every
family's data, with no error to signal it. Changing it later has the same
effect. See [Security model](./security/#the-master-key).
:::

## Data

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIDO_DATA_DIR` | `/data` in Compose, `./data` locally | Root holding `registry.db`, `db/<familyId>.db` and `blobs/` |
| `NIDO_BLOB_DIR` | `/data/blobs` | Photo storage |

## Networking

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_PROXY_TARGET` | `http://api:3000` | Where the web service forwards `/api` |
| `PUBLIC_API_URL` | *(empty — same origin)* | Explicit API origin the browser uses. Leave empty unless the API is cross-origin. |
| `ALLOWED_HOSTS` | `localhost` | Comma-separated hostnames the web server answers to. Bare IPs are always allowed. |
| `FRONTEND_URL` | `http://localhost:3001` | Web origin, used as a fallback for `PUBLIC_URL` |

The browser talks to the API **same-origin at `/api/v1`**, so the normal setup
involves no CORS at all. `PUBLIC_API_URL` only matters when the API genuinely
lives on a different origin.

## Accounts and email

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_EMAIL` | *(empty)* | Grants platform admin on first boot. Empty means the first registered user becomes admin. |
| `SIGNUP_ENABLED` | *(empty — allowed)* | `false` blocks registration and locks the Admin panel toggle. |
| `PUBLIC_URL` | `FRONTEND_URL` | Origin used in verification and password-reset emails. **Must be public, not `localhost`.** |
| `NOTIFY_ENABLED` | *(empty — enabled)* | Runs the notification digest on a timer. Set `false` on all but one API replica. |
| `NOTIFY_INTERVAL_MINUTES` | `60` | How often the digest checks every family. |

:::caution[`NOTIFY_ENABLED` with more than one replica]
The digest is a timer inside the API process. Two live replicas will each try to
send, so keep it on exactly one. Replicas sharing a volume coordinate through a
lease in `registry.db`; replicas on separate volumes cannot see each other at
all, and the flag is the only thing stopping a duplicate send.
:::

:::caution[`PUBLIC_URL` behind a reverse proxy]
Verification and reset links are built from this. Left at `localhost`, your
parents receive a link that only resolves on the server itself. Set it to your
public origin: `https://nido.example.com`.
:::

## A complete `.env`

```bash
# --- required ---
NIDO_MASTER_KEY=…            # openssl rand -hex 32
JWT_SECRET=…                  # openssl rand -hex 32

# --- data ---
NIDO_DATA_DIR=/data
NIDO_BLOB_DIR=/data/blobs

# --- networking (single-origin behind a proxy) ---
API_PROXY_TARGET=http://api:3000
ALLOWED_HOSTS=nido.example.com

# --- accounts and email ---
ADMIN_EMAIL=you@example.com
SIGNUP_ENABLED=false
PUBLIC_URL=https://nido.example.com

# --- notification digests (omit entirely for a single API container) ---
# NOTIFY_ENABLED=true
# NOTIFY_INTERVAL_MINUTES=60
```

Generate the two secrets with:

```bash
./scripts/init-env.sh          # writes .env at mode 0600, refuses to overwrite
```

## How secrets are handled

- Both required secrets are read from the environment. Neither is ever given a
  fallback, logged, or returned by a route.
- Family subkeys are derived with HKDF-SHA256 and never reused across families
  or purposes. Salt is the family id; info is `nido:db`. The registry database
  uses `nido:registry` as both salt and info.
- `scripts/init-env.sh` writes the `.env` at mode `0600` and exits if the file
  already exists, so a re-run cannot destroy the only copy of your key.

## Where this is validated

`AGENTS.md` in the repository root documents the tenant boundary and the
key-derivation rules the rest of the codebase depends on. Read it before
touching `db-core.ts` or `db-namespaces.ts` — the derivation is part of the
data format, and the two `deriveKey()` call sites must stay identical to each
other or a database will open on one path and fail to decrypt on the other.
