# Nido — Docker Compose

A self-contained Compose deployment: the API and the web client behind the
same network, with the SQLite DB + encrypted uploads persisted on a named volume.

## Quick start

```bash
cd deploy/docker-compose

# 1. Configure secrets (change the JWT secret!)
cp .env.example .env
# edit .env — set a strong JWT_SECRET; API_PROXY_TARGET defaults to http://api:3000

# 2. Build & start
docker compose up -d --build

# 3. Open the app
#    web:  http://localhost:3001
#    api:  http://localhost:3000/health
```

## What this does

- **api** — Hono API; binds `3000`. Persists the SQLite databases and encrypted blobs
  on the `nido-data` named volume mounted at `/data`.
- **web** — SvelteKit client; binds `3001`. The web server proxies `/api`
  to the api service via the `API_PROXY_TARGET` you set in `.env`.

The Dockerfiles are built from the repo root (`api/Dockerfile`, `web/Dockerfile`),
so this compose files points `build.context` at the corresponding subfolder.

## Notes

- `JWT_SECRET` must be changed from the placeholder in production.
- `API_PROXY_TARGET` is where the web server forwards `/api`
  requests (compose default `http://api:3000`; behind a split reverse proxy,
  set it to the proxied API hostname).
- The browser calls the API same-origin (`/api/v1`) — no CORS involved. To point
  the browser at an explicit API origin instead, set `PUBLIC_API_URL`.
- Back up the `nido-data` volume with the backup CLI rather than a plain
  `tar`/`cp`: the databases are WAL-mode, so a file copy can capture a torn
  database or silently drop the newest writes. The API image snaps each one
  consistently and verifies it:
  ```bash
  # on a schedule (systemd timer / host cron), daily at 03:17
  NIDO_BACKUP_PASSPHRASE="optional-archive-password" docker run --rm \
    -e NIDO_MASTER_KEY="$(grep NIDO_MASTER_KEY .env | cut -d= -f2)" \
    -v nido-data:/data -v nido-backups:/backups \
    nido/api:latest node dist/backup-cli.js backup --keep 14
  ```
  Restore: `node dist/backup-cli.js restore --archive /path/to/archive.tar.gz`
  (stop the API first). See `Docker.md` → Backups for the full story, including
  why `NIDO_BACKUP_PASSPHRASE` matters before shipping archives off-host.
- To self-host behind a reverse proxy (Caddy/traefik/nginx), point it at the
  `web` service on `3001` and the `api` service on `3000`.

## Using images published by CI instead of building

Two tiers, and the difference is the point:

- `ghcr.io/<owner>/<repo>/{api|web}:main` — published on every push to `main`.
  A build of whatever was just merged: floating, and unreleased.
- `ghcr.io/<owner>/<repo>/{api|web}:v<date>` — a release, published by the
  `Release` workflow. Immutable. **Pin this.**
- `ghcr.io/<owner>/<repo>/{api|web}:latest` — the newest release. Fine for
  trying Nido; it moves.
- `ghcr.io/<owner>/<repo>/{api|web}:sha-<commit>` — every build, by commit.

To pull those instead of building locally, set the compose file to reference
them (and log in first):

```bash
echo "$CR_PAT" | docker login ghcr.io -u <owner> --password-stdin
```

Replace the `build:`/`image:` blocks with e.g:

```yaml
api:
  image: ghcr.io/<owner>/<repo>/api:v<date>
  # ...same ports/env/volumes...
web:
  image: ghcr.io/<owner>/<repo>/web:latest
```