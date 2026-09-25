# Nido — Kubernetes, single pod

The lightest possible deployment: **one Deployment pod with two containers**
(`api` and `web`) sharing the pod's network namespace and the `nido-data`
volume. The web client reaches the API at `http://localhost:3000` — no service
splitting, no Ingress path rules needed.

## When to use
- A single-node cluster (k3s, k3d, kind, minikube) or a single-VM workload.
- You want one pod to port-forward / traffic-manage.
- You don't need to scale the web and API pods independently.

## Apply
```bash
kubectl apply -k deploy/kubernetes/single-pod

# watch rollout
kubectl -n nido get pods -w
```

### Access
```bash
kubectl -n nido port-forward svc/nido 3001:80
kubectl -n nido port-forward svc/nido 3000:3000
# web: http://localhost:3001   api: http://localhost:3000/health
```
`svc/nido` exposes both `:80 → web` and `:3000 → api`.

## Files
- `namespace.yaml`, `secret.yaml`, `pvc.yaml` — shared scaffolding.
- `deployment.yaml` — one pod, two containers, shared PVC at `/data`.
- `service.yaml` — exposes both `web` (:80 → 3001) and `api` (:3000).

## Notes
- The web dev server proxies the browser's `/api` requests to the API at
  `http://localhost:3000` (`API_PROXY_TARGET`) — this works only because both
  containers share the pod loopback. If you later split them out (see
  `../multi-pod`), set `API_PROXY_TARGET` to the api Service URL instead.
- Same pod means the API and web scale up or down together (replicas: 1).