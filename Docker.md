# Nido Docker Setup

Nido ships as two containers — `api` and `web`. The databases are **not**
part of any image: the API reads and writes SQLCipher-encrypted SQLite files
under `/data` (`registry.db`, `db/<familyId>.db`, encrypted files at `/data/blobs`) on a
**mounted volume**, so image builds and pulls never carry database state with
them. There is no separate database service.

Each family gets its own encrypted file, keyed by an HKDF-SHA256 subkey
derived from `NIDO_MASTER_KEY`. The encrypted file *is* the tenant boundary.

## Docker Files

### 1. API Service - `api/Dockerfile`
- Node 20 Alpine base image
- Installs dependencies and compiles the TypeScript app
- Exposes port 3000, starts with `npm start`
- Copies only source (`src`, `tsconfig.json`, manifests) — never `data/` or any `*.db`

### 2. Web Service - `web/Dockerfile`
- Node 20 Alpine base image
- Installs dependencies and builds the SvelteKit app
- Exposes port 3001 (dev-mode server: `npm run dev -- --host`)

## Compose Files

### Root `docker-compose.yml` (development)
- **api**: port 3000, `NIDO_MASTER_KEY`, `NIDO_DATA_DIR`, `JWT_SECRET`, and
  the host folder `./data` bind-mounted to `/data` so the DBs and files live as
  plain, inspectable/backup-able files on the host
- **web**: port 3001, `API_PROXY_TARGET=http://api:3000` (dev server forwards `/api` to the api service), depends on api

### Deploy `deploy/docker-compose/docker-compose.yml`
- Same two services, built from the repo root
- DBs + encrypted files persisted on the **named volume `nido-data`** mounted at `/data`
- `NIDO_MASTER_KEY` and `JWT_SECRET` are both required — compose fails fast if
  either is unset
- API exposes a `/health` healthcheck
- For registry-published images (GHCR) replace the `build:`/`image:` blocks
  with `image: ghcr.io/<owner>/<repo>/{api|web}:latest` — see
  `deploy/docker-compose/README.md`

## Usage

### Development:
```bash
docker compose up          # start in the foreground
docker compose up -d       # start in the background
docker compose logs -f     # follow logs
```

### Production:
```bash
docker compose up -d --build       # build and start
docker compose build api           # rebuild a single service
docker compose build web
```

## Volumes
- **Root compose**: `./data` bind mount — SQLite DBs + encrypted blobs as host files.
- **Deploy compose**: named volume `nido-data`.
- Images never contain database state. To start from a clean DB, reset the
  storage layer — **swapping images alone never clears data**:
  - Named volume: `docker compose down -v`
  - Bind mount: move/delete `./data` while the container is stopped

## Backups
The API image doubles as a backup tool — it ships `dist/backup-cli.js`, which
snapshots every encrypted database plus `blobs/` into one gzipped tar.

```bash
# daily at 03:17 via systemd/cron on the host
NIDO_MASTER_KEY=... NIDO_DATA_DIR=/data \
NIDO_BACKUP_DIR=/backups NIDO_BACKUP_PASSPHRASE=... \
docker run --rm -v nido-data:/data -v nido-backups:/backups \
  nido/api:latest node dist/backup-cli.js backup --keep 14
```

Two important properties:

- **Consistent despite WAL.** A file-level `cp` of these SQLite databases is
  unsafe: recent commits live in a `-wal` sidecar until a checkpoint. The CLI
  uses `VACUUM INTO` per database, which snapshots a transactionally consistent
  view (WAL included) and keeps the file encrypted, then runs
  `integrity_check` on each snapshot before the archive is finalised.
- **Photos are plaintext in the archive unless encrypted.** Databases are
  already SQLCipher-encrypted, and so are the blobs. Set
  `NIDO_BACKUP_PASSPHRASE` to AES-256-GCM-encrypt the whole tar, which is what
  you want before shipping it off-box.

Restore (`node dist/backup-cli.js restore --archive FILE`) decrypts if needed,
verifies every database, and only replaces the data directory after every
check passes. Stop the API first and keep the current volume as a fallback.

See `deploy/docker-compose/README.md` and `deploy/kubernetes/README.md` for
per-platform scheduler examples.

## Environment Variables
- `NIDO_MASTER_KEY`: hex secret that keys every per-family database
  (required in the deploy compose). `openssl rand -hex 32`. **Losing it means
  losing every family's data** — back it up separately from the volume
- `NIDO_DATA_DIR`: runtime data directory holding `registry.db`,
  `db/<familyId>.db` and `blobs/` (default `/data`)
- `JWT_SECRET`: Secret for JWT authentication (required in the deploy compose)
- `PUBLIC_API_URL`: optional explicit API origin for the browser (defaults to same-origin `/api/v1`)
- `API_PROXY_TARGET`: where the web server forwards `/api` (compose: `http://api:3000`, single-pod k8s: `http://localhost:3000`)
- `NIDO_BLOB_DIR`: Photo storage directory (deploy compose, defaults to `/data/blobs`)
- `LOG_LEVEL`: API log verbosity — `debug`, `info` (default), `warn`, `error`,
  `silent`
- `LOG_FORMAT`: API log format — `json` or `pretty`. Unset lets the API choose,
  which resolves to `json` in a container (piped stdout) and `pretty` on a
  terminal
- `NOTIFY_ENABLED`: run the notification digest on a timer (default on)
- `NOTIFY_INTERVAL_MINUTES`: how often the digest runs, default `60`

## Notification digests
The API container emails each family's newly firing inventory alerts on a timer,
so nothing has to be open in a browser. It is a plain timer inside the API
process because a self-hosted install is one API container and one volume.

**Running more than one API replica? Turn it off on all but one.** Replicas that
share a data volume also coordinate through a lease row in `registry.db`, so they
cannot double-send. Replicas on *separate* volumes have separate registries and
cannot see each other — which is precisely the case `NOTIFY_ENABLED` exists for,
and why the flag is the documented mechanism rather than the lease.

Evaluating is cheap (local SQLite, and families with no rules are skipped), so the
interval can be frequent; email only goes out when something newly matches. When
the hosted deployment grows a queue, the digest is already a standalone function
(`runFamilyDigest` in `api/src/notifications.ts`) that a worker calls per job, so
the timer is the only thing that gets deleted.

## Reading the logs
The API logs to **stdout** only — no log files, no stderr split — so the
container runtime captures everything in order and `docker compose logs` is the
whole story:

```bash
docker compose logs -f api
# errors only
docker compose logs api | grep '"level":"error"'
# everything belonging to one request
docker compose logs api | grep '"requestId":"abc-123"'
```

Each request logs one `http_request` line with `requestId`, method, path,
status and duration. Handler errors, auth rejections and boot failures log
against the same `requestId`, which is also returned to the client as
`X-Request-Id` and included in 500 bodies — so a user-reported failure maps
back to exact log lines. Send an inbound `X-Request-Id` header to choose your
own id.

Field names that look like credentials are written as `[redacted]`, so no log
line can contain `NIDO_MASTER_KEY`, `JWT_SECRET` or a password hash.

## Build Hygiene
A root `.dockerignore` excludes `data/`, `**/*.db*`, `node_modules/`, `.git/`,
and `.env*` from every build context. Local dev data can therefore never be
sent to a build daemon or baked into an image, regardless of which compose file
or `docker build` invocation is used.