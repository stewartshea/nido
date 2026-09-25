# Nido — Kubernetes (lightweight)

Minimal, readable Kubernetes manifests for running Nido on a lightweight
cluster (k3s, k3d, kind, minikube, etc.). Everything lives in the `nido`
namespace. Two layout options are provided.

## Options

| | Single pod | Multi pod |
|---|---|---|
| **Layout** | 1 pod, 2 containers (api + web) | 1 pod per service (api, web) |
| **Web → API call** | `http://localhost:3000` (shared loopback) | API Service URL or Ingress path |
| **Scale independently?** | No — they move together | Yes |
| **Port-forward** | One service, two ports | One service per service |
| **Best for** | Single node / single VM (k3s, k3d, kind, minikube) | Multi-node or when you'll scale web/API separately |

### `single-pod/` — one pod, both containers
Lightest option for a single-node cluster. The web container reaches the API at
`localhost:3000` because they share the pod's network namespace, and they share
the `nido-data` PVC.

```bash
kubectl apply -k deploy/kubernetes/single-pod
```

### `multi-pod/` — a Deployment + Service per service
Separate `nido-api` and `nido-web` pods with their own Services, ready for
an Ingress split (`/api` → api:3000, `/` → web:80).

```bash
kubectl apply -k deploy/kubernetes/multi-pod
```

## Shared across both
- `namespace.yaml` — the `nido` namespace.
- `secret.yaml` — `JWT_SECRET` (change the placeholder!).
- `pvc.yaml` — `nido-data`, 1Gi for the SQLite DB + photos.
- `ingress.yaml` — optional (multi-pod); uncomment in its `kustomization.yaml`.

The `namespace.yaml`, `secret.yaml`, and `pvc.yaml` files are duplicated into
each option folder so every option applies cleanly on its own.

## Prerequisites
- A cluster and `kubectl` configured.
- Images in a registry your cluster can pull. Replace `nido/api:latest` /
  `nido/web:latest` with your own, or use `k3d image import` /
  `minikube image load` for locally built images.

## Images built by CI

The repository's `build-containers.yml` workflow builds both containers on every
push to `main` and `v*` tags, and publishes them to GitHub Container Registry:

- `ghcr.io/<owner>/<repo>/api:latest` / `web:latest` (on `main`)
- `ghcr.io/<owner>/<repo>/{api|web}:sha-<commit>` (every push)
- `ghcr.io/<owner>/<repo>/{api|web}:<tag>` (on `v*` tags)

Point the manifests at those images (and configure the cluster with an image
pull secret / `docker login` for private repos):

```yaml
image: ghcr.io/<owner>/<repo>/api:latest
```

## Configuration
- **JWT secret**: edit `secret.yaml` → `JWT_SECRET`. Keep it long and random.
- **Platform admin**: only one admin exists, designated by `ADMIN_EMAIL` (an
  existing account) — when set, that user owns **Account Settings → Admin**
  and everyone else is demoted. If unset, the **first registered user** becomes
  the admin. Set it in the api container's env or via the `nido` secret.
- **Email base URL**: set `PUBLIC_URL` on the api service to the **public
  origin** (e.g. `https://nido.example.com`) so verification / password-reset
  links email the real site, not `localhost`.
- **API URL for the web client**: the client calls the API **same-origin**
  (`/api/v1`); the web container's Vite dev server proxies `/api` to the API via
  `API_PROXY_TARGET` in `web-deployment.yaml`. Behind the Ingress, `/api`
  routes straight to the api Service, so public traffic never hits the proxy.
  - single pod → `API_PROXY_TARGET=http://localhost:3000` (shared loopback).
  - multi pod → `API_PROXY_TARGET=http://nido-api:3000` (api Service).
  Only set `PUBLIC_API_URL` on the web container when the API is served from a
  different origin than the web app.
- **Web allowed hosts**: the web container runs a Vite dev server that rejects
  unknown `Host` headers. In `multi-pod`, set `ALLOWED_HOSTS` in
  `web-deployment.yaml` to the hostname browsers use (the Ingress host, e.g.
  `nido.example.com`). In `single-pod`, loopback-only access means
  `localhost` is fine (bare IPs are always allowed).

## Storage
The `nido-data` PVC is `ReadWriteOnce` (single node). For multi-node, pick a
`ReadWriteOnce`-on-host storage class or `ReadWriteMany`. Back up the volume
regularly (`kubectl cp`, CSI snapshot, etc.).

## Backups
Use the in-app **Account Settings → Backup** tab to download an all-data JSON
backup and restore it there. For disaster recovery also back up the
`nido-data` volume (database + uploaded photos).