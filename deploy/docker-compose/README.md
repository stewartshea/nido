# Nido — Docker Compose

A self-contained Compose deployment: the API and the web client behind the
same network, with the SQLite DB + uploaded photos persisted on a named volume.

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

- **api** — Hono API; binds `3000`. Persists the SQLite database and photos
  on the `nido-data` named volume mounted at `/data`.
- **web** — SvelteKit client; binds `3001`. The Vite dev server proxies `/api`
  to the api service via the `API_PROXY_TARGET` you set in `.env`.

The Dockerfiles are built from the repo root (`api/Dockerfile`, `web/Dockerfile`),
so this compose files points `build.context` at the corresponding subfolder.

## Notes

- `JWT_SECRET` must be changed from the placeholder in production.
- `API_PROXY_TARGET` is where the web's Vite dev server forwards `/api`
  requests (compose default `http://api:3000`; behind a split reverse proxy,
  set it to the proxied API hostname).
- The browser calls the API same-origin (`/api/v1`) — no CORS involved. To point
  the browser at an explicit API origin instead, set `PUBLIC_API_URL`.
- `ALLOWED_HOSTS` is the comma-separated list of hostnames the web service's
  Vite server will accept (e.g. `nido.example.com` behind a reverse proxy).
  `localhost` and IPs are always allowed, so the default is safe for local use.
- Back up the `nido-data` volume (e.g. `docker run --rm -v nido-data:/data -v "$PWD":/backup alpine tar czf /backup/nido-data.tgz -C /data .`).
- To self-host behind a reverse proxy (Caddy/traefik/nginx), point it at the
  `web` service on `3001` and the `api` service on `3000`.

## Using images published by CI instead of building

The repository's `build-containers.yml` workflow publishes images to GHCR on
every push to `main` and on `v*` tags:

- `ghcr.io/<owner>/<repo>/api:latest`
- `ghcr.io/<owner>/<repo>/web:latest`
- per-commit: `ghcr.io/<owner>/<repo>/{api|web}:sha-<commit>`

To pull those instead of building locally, set the compose file to reference
them (and log in first):

```bash
echo "$CR_PAT" | docker login ghcr.io -u <owner> --password-stdin
```

Replace the `build:`/`image:` blocks with e.g:

```yaml
api:
  image: ghcr.io/<owner>/<repo>/api:latest
  # ...same ports/env/volumes...
web:
  image: ghcr.io/<owner>/<repo>/web:latest
```