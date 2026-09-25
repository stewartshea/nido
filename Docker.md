# Nido Docker Setup

Nido ships as two containers — `api` and `web`. The databases are **not**
part of any image: the API reads and writes SQLCipher-encrypted SQLite files
under `/data` (`registry.db`, `db/<familyId>.db`, photos at `/data/photos`) on a
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
  the host folder `./data` bind-mounted to `/data` so the DBs and photos live as
  plain, inspectable/backup-able files on the host
- **web**: port 3001, `API_PROXY_TARGET=http://api:3000` (dev server forwards `/api` to the api service), depends on api

### Deploy `deploy/docker-compose/docker-compose.yml`
- Same two services, built from the repo root
- DBs + photos persisted on the **named volume `nido-data`** mounted at `/data`
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
- **Root compose**: `./data` bind mount — SQLite DB + photos as host files.
- **Deploy compose**: named volume `nido-data`.
- Images never contain database state. To start from a clean DB, reset the
  storage layer — **swapping images alone never clears data**:
  - Named volume: `docker compose down -v`
  - Bind mount: move/delete `./data` while the container is stopped

## Environment Variables
- `NIDO_MASTER_KEY`: hex secret that keys every per-family database
  (required in the deploy compose). `openssl rand -hex 32`. **Losing it means
  losing every family's data** — back it up separately from the volume
- `NIDO_DATA_DIR`: runtime data directory holding `registry.db`,
  `db/<familyId>.db` and `photos/` (default `/data`)
- `JWT_SECRET`: Secret for JWT authentication (required in the deploy compose)
- `PUBLIC_API_URL`: optional explicit API origin for the browser (defaults to same-origin `/api/v1`)
- `API_PROXY_TARGET`: where the web Vite dev server forwards `/api` (compose: `http://api:3000`, single-pod k8s: `http://localhost:3000`)
- `ALLOWED_HOSTS`: comma-separated hostnames the web Vite dev server accepts
  requests for — add your public domain (e.g. `nido.example.com`) when
  fronting it with a reverse proxy. Defaults to `localhost` (bare IPs are
  always allowed)
- `PHOTO_DIR`: Photo storage directory (deploy compose, defaults to `/data/photos`)

## Build Hygiene
A root `.dockerignore` excludes `data/`, `**/*.db*`, `node_modules/`, `.git/`,
and `.env*` from every build context. Local dev data can therefore never be
sent to a build daemon or baked into an image, regardless of which compose file
or `docker build` invocation is used.