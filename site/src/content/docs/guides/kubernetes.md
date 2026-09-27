---
title: Kubernetes
description: Deploy Nido to a single-node cluster with the bundled Kustomize manifests.
---

Nido's data layer is SQLite files on a volume, not a database server. That
constrains the topology: every API pod that can serve a given family must be
able to open that family's file, and SQLite does not tolerate two writers.

## Two manifests, two situations

| Directory | Topology | Use when |
| --- | --- | --- |
| `deploy/kubernetes/single-pod` | One pod, two containers | Single-node cluster, one household, the common case |
| `deploy/kubernetes/multi-pod` | Separate API and web deployments | You need to scale the web tier |

**Start with single-pod.** It is simpler, and it is the only topology that does
not have to reason about two processes writing the same file.

## Single pod

```bash
kubectl apply -k deploy/kubernetes/single-pod
kubectl -n nido get pods -w
```

One pod holds both containers, sharing a network namespace and the `nido-data`
volume. The web client reaches the API over the pod's own loopback at
`http://localhost:3000` (`API_PROXY_TARGET`) — which works *only* because both
containers share that namespace.

```bash
kubectl -n nido port-forward svc/nido 3001:80
# web: http://localhost:3001
```

`svc/nido` exposes both `:80 → web` and `:3000 → api`.

:::caution[One pod means one replica]
`replicas: 1` is load-bearing, not a default to raise. Two API replicas sharing
a PVC means two processes writing the same encrypted SQLite file, which is a
corruption path, not a scaling win. To scale the web tier independently, use
`multi-pod` — and read its notes on the data layer first.
:::

## Manifests

- `namespace.yaml`, `secret.yaml`, `pvc.yaml` — shared scaffolding
- `deployment.yaml` — one pod, two containers, shared PVC at `/data`
- `service.yaml` — exposes `web` (`:80 → 3001`) and `api` (`:3000`)

## Secrets

The `secret.yaml` must contain both required values:

```yaml
stringData:
  NIDO_MASTER_KEY: "…"   # openssl rand -hex 32
  JWT_SECRET: "…"
```

Generate the key outside the cluster and apply it — never let a `Secret` in git
be the only copy. See [the master key](../reference/security/#the-master-key).

## The filesystem is the real constraint

Because a family's encrypted file *is* the tenant boundary, a family can only
be served by a pod that can open its file. That has consequences:

- **ReadWriteOnce is honest.** The default `pvc.yaml` assumes one writer, which
  matches the SQLite constraint.
- **`ReadWriteMany` does not make it safe.** NFS and similar can mount
  read-write-many, but SQLite over a network filesystem is still a
  single-writer design being shared by two processes.
- **Back up the PVC** using the same procedure as the named volume, and
  separately. Same two-part requirement: [Backup & restore](./backup-and-restore/).

## Next

- [Backup & restore](./backup-and-restore/) — the `kubectl exec` variant
- [Configuration](../reference/configuration/) — every environment variable
- [Containers & volumes](../reference/containers/) — what lives where on disk
