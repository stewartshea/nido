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
- **Logging**: `LOG_LEVEL` (`info` by default) and `LOG_FORMAT` (`json` by
  default) are already set on the api container. Keep the format `json` here —
  that is what makes the lines parseable by `kubectl logs` pipelines and log
  shippers. See [Reading the logs](#reading-the-logs) below.
- **Web allowed hosts**: the web container runs a Vite dev server that rejects
  unknown `Host` headers. In `multi-pod`, set `ALLOWED_HOSTS` in
  `web-deployment.yaml` to the hostname browsers use (the Ingress host, e.g.
  `nido.example.com`). In `single-pod`, loopback-only access means
  `localhost` is fine (bare IPs are always allowed).

## Reading the logs
The API writes to **stdout** only, so the container runtime collects it — no
log file, no volume, no sidecar needed:

```bash
kubectl logs -l app=nido-api -f
# errors across all pods
kubectl logs -l app=nido-api --prefix | grep '"level":"error"'
# one request, end to end
kubectl logs -l app=nido-api --prefix | grep '"requestId":"abc-123"'
```

Because `kubectl logs` without a pod name can hit any replica, add `--prefix`
when reading multiple pods — that is what tells you which one a line came from.

One line per request carries `requestId`, method, path, status and duration.
Errors, auth rejections and shutdown events share that `requestId`, and the
same id is returned to the browser as `X-Request-Id`, so a user screenshot of
a 500 maps straight to its log lines. Send an inbound `X-Request-Id` to pin
your own id.

Because the format is one JSON object per line, ad-hoc filtering is a `jq`
away:

```bash
# slowest 10 requests
kubectl logs -l app=nido-api | jq -r 'select(.event=="http_request") | "\(.durationMs)ms \(.method) \(.path)"' | sort -rn | head
# anything that errored
kubectl logs -l app=nido-api | jq -c 'select(.level=="error")'
```

`debug` is available for chasing one request and is deliberately noisy — set it
per-pod rather than as a standing default:

```bash
kubectl set env deployment/nido-api LOG_LEVEL=debug
```

Field names that look like credentials are written as `[redacted]`, so a log
line cannot contain `NIDO_MASTER_KEY`, `JWT_SECRET` or a password hash. That
makes logs safe to ship, but the redaction is a name-based heuristic — treat
them as sensitive anyway rather than pasting them into a public issue.

## Storage
The `nido-data` PVC is `ReadWriteOnce` (single node). For multi-node, pick a
`ReadWriteOnce`-on-host storage class or `ReadWriteMany`. Back up the volume
regularly (`kubectl cp`, CSI snapshot, etc.).

## Backups
Two layers, because they protect against different losses:

1. **In-app export** (Account Settings → Backup): a JSON of the current
   family's records. Good for moving data between installs; not a server
   backup.
2. **Volume backup — `nido-backup` CronJob** ([`backup-cronjob.yaml`](backup-cronjob.yaml)):
   snapshots every encrypted database plus the `photos/` directory into a
   gzipped tar on a **separate `nido-backups` PVC**, keeps the newest 14, and
   verifies each restored database before writing it back.

### Why not `kubectl cp` the volume?
The databases are WAL-mode SQLCipher files. Recent commits live in a `-wal`
sidecar until a checkpoint, so a file-level copy can grab a torn database or
silently drop the newest writes. The CronJob instead runs
`VACUUM INTO` per database — SQLite's online snapshot — which includes WAL
content and keeps the same encryption, then runs `integrity_check` on every
restored file before the archive is accepted.

### The CronJob needs a controller
`backup-cronjob.yaml` uses `apiVersion: batch/v1` (`kind: CronJob`). That
control plane exists in Portainer and Kubernetes 1.28+ batch APIs; on a plain
`kubectl` cluster, apply it where a CronJob controller is available, or run
the same image from a host cron:

```bash
# Docker / host cron — same snapshot semantics, no controller required
docker run --rm -it \
  -e NIDO_MASTER_KEY=$(kubectl -n nido get secret nido -o jsonpath='{.NIDO_MASTER_KEY}') \
  -e NIDO_DATA_DIR=/data -e PHOTO_DIR=/data/photos \
  -e NIDO_BACKUP_DIR=/backups \
  -v nido-data:/data -v nido-backups:/backups \
  nido/api:latest node dist/backup-cli.js backup --keep 14
```

The volume is currently `ReadWriteOnce` (one writer). The CronJob mounts it
read-only while the API pod keeps read-write, so no worker is kicked off the
hang; if your storage class can only do `ReadWriteOnce` single-attach, run the
backup job on the same node as the API via `nodePlacement`.

### Enabling it
Create the backup PVC and the CronJob, then trigger a run immediately to seed
the first archive:

```bash
kubectl apply -n nido -f backup-pvc.yaml
kubectl apply -n nido -f backup-cronjob.yaml
# seed the first archive now
kubectl create job nido-backup-manual --from=cronjob/nido-backup -n nido
```

### Restore
Point `NIDO_DATA_DIR` at an empty directory and run the restore command from
the archive (the CLI decrypts if the passphrase was set, verifies every
database, and only then swaps it into place):

```bash
docker run --rm -it \
  -e NIDO_MASTER_KEY=... -e NIDO_DATA_DIR=/data-restore \
  -v "$(pwd)/archive.tar.gz":/archive.tar.gz \
  nido/api:latest node dist/backup-cli.js restore --archive /archive.tar.gz
```

Stop the API first, and back up the current live volume before overwriting.

### Encryption and shipping off-cluster
The databases are already encrypted, but `photos/` are not. Set
`NIDO_BACKUP_PASSPHRASE` in the `nido` secret to AES-256-GCM-encrypt the whole
archive so it is safe to `rclone sync` / S3 / Backblaze off-cluster. Treat
unencrypted archives as private.

### A CronJob on the same cluster is not disaster recovery
If the node (or cluster) dies, a second PVC on that node can die with it. The
CronJob protects against **logical** loss — accidental deletes, bad updates,
one bad migration. For real DR, ship the encrypted archive off-cluster on a
schedule (`rclone`, `aws s3 sync`, etc.).