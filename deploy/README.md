# Nido — deploy
Community deployment references for running Nido with Docker Compose or a
lightweight Kubernetes cluster. Use these as starting points; adapt names,
secrets, and storage classes to your environment.

## Layout
- `docker-compose/` — single-node Compose deployment (bind mount or named volume).
- `kubernetes/` — lightweight K8s manifests (Deployment + Service + PVC + Secret + optional Ingress), wired together with Kustomize.

See the `README.md` inside each subfolder for run instructions.