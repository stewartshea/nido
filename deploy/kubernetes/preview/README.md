# Preview environments

A preview is a real deployment of a pull request, in the cluster, with a
database of its own:

```
https://pr-42.previews.dev.nido-app.ca
```

Both tiers are deployed — the API and the web tier — so a change can be
exercised end to end, against real storage, before it merges. A preview is
not a mock: registering an account on it creates a real family, with a real
encrypted database.

## How one is put together

Everything that varies per pull request — the namespace, the image tags, the
hostname — is rendered by [`scripts/preview.mjs`](../../../scripts/preview.mjs)
into `.render/nido-pr-<number>/` as a kustomize overlay on top of `base/`. The
base never changes shape, so a preview is always the same two Deployments,
the same two Services and the same HTTPRoute.

```
base/                    the same for every preview
.render/nido-pr-42/      generated, not committed
  kustomization.yaml     namespace, image tags, hostname
  namespace.yaml         nido-pr-42, labelled nido-app.ca/preview=true
```

The overlay is rendered into the repository rather than a temporary directory
because kustomize refuses to load a base from outside the directory holding
the kustomization.

## What is in a preview

| | |
| --- | --- |
| Namespace | `nido-pr-<number>`, labelled `nido-app.ca/preview=true` |
| API | one Deployment and one Service, `Recreate` strategy |
| Web | one Deployment and one Service, `Recreate` strategy |
| Data | an `emptyDir` on the API, so a preview starts empty and leaves nothing behind |
| Secrets | `NIDO_MASTER_KEY` and `JWT_SECRET`, derived per pull request and commit |
| Priority | `nido-preview`, so a preview is evicted before anything real and never preempts another pod |

The `Recreate` strategy is not a default. prod-saz is a single node with
about 1.9 GiB allocatable, and a `RollingUpdate` runs the old pod and the
new pod at the same time. Two API pods during a rollout is two pods' worth
of memory for a preview that only ever needs one.

`emptyDir` rather than a PersistentVolumeClaim: a preview's data is
disposable, a claim would leave a Cinder volume behind on every pull
request, and a claim would also add the attach latency that a preview
reviewer waits through on every redeploy. The directory is disk-backed
rather than memory-backed, because the database must stay on a local
filesystem — SQLite over a shared mount is a corruption risk.

## The keys

`NIDO_MASTER_KEY` and `JWT_SECRET` are derived, not random:

```
<label>:nido-pr-<number>:<commit>")
```

Derived, because a random key per deployment leaves the pod holding a key
that no longer matches the Secret whenever a deployment is repeated for the
same commit. The key has to change at exactly the moment the pod is
replaced, and the pod is replaced exactly when the image tag changes.

The salt is what keeps the derived key out of reach of anyone who can guess
the pull request number and read the commit history. It is a repository
secret, `PREVIEW_KEY_SALT`.

A preview is not a place for real family data: signup is open, there is no
mail server, and the namespace is deleted when the pull request closes.

## The hostname

`nido-pr-<number>` namespaces are reached at `pr-<number>.previews.dev.nido-app.ca`
and are covered by two wildcards, both created once and not per pull request:

- `*.previews.dev.nido-app.ca` — a DNS A record pointing at the Traefik
  LoadBalancer. The preview HTTPRoutes deliberately carry **no**
  `external-dns.kubernetes.io/hostname` annotation, so external-dns never
  manages a record per pull request and a new preview URL resolves the
  instant its namespace exists.
- `*.previews.dev.nido-app.ca` — a wildcard certificate on the shared
  Traefik Gateway. One certificate covers every preview, so opening a
  preview costs no ACME issuance and cannot hit a rate limit.

A wildcard matches exactly one label, so `pr-42.previews.dev.nido-app.ca`
works and `a.b.previews.dev.nido-app.ca` does not. A pull request number is
the only thing that goes in a preview hostname.

The cluster side of this — the wildcard certificate, the ServiceAccount the
deploy runs as, and the admission policy that limits that ServiceAccount to
`nido-pr-<number>` namespaces — lives in the private `ovh-flux` repository, not
here.

## Lifecycle

| Event | What happens |
| --- | --- |
| pull request opened, or a push to its branch | the images are built, deployed, and the URL is posted as a pull request comment |
| pull request closed or merged | the namespace is deleted |

The comment is sticky: it is updated in place on every push rather than
adding a new one.

A nightly sweep deletes any preview whose pull request is no longer open.
The close handler is the normal path; the sweep is the backstop for the
times it does not run — a failed run, a disabled workflow, a pull request
closed while the runner was down. A preview left behind holds about 130 MiB
of the node's memory requests on a node that is already at 98% of capacity,
and it would degrade the live instances to pay for it.

## Running it by hand

```bash
# render the overlay and check the manifests build
node scripts/preview.mjs render --pr 42 --sha "$(git rev-parse HEAD)"
kubectl kustomize deploy/kubernetes/preview/.render/nido-pr-42

# deploy, against a cluster the current kubeconfig can reach
PREVIEW_KEY_SALT=... node scripts/preview.mjs deploy --pr 42 --sha "$(git rev-parse HEAD)"

# remove it
node scripts/preview.mjs teardown --pr 42
```

The deploy identity can only create a `nido-pr-<number>` namespace and can only
write inside one. A `kubectl` run with an administrator's kubeconfig is not
restricted that way.
