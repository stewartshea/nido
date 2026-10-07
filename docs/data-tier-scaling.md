# Data Tier & Scaling — Architecture

How Nido stores data, and how it survives a node loss or a rolling deploy without
giving up the per-family encryption model.

The short version: **families are never worth scaling, so this is not a scaling
problem.** A family's data is kilobytes. What we need is availability, and the
two requirements — survive a lost node, deploy without an outage — are served by
restoring a snapshot, not by sharding a database.

## 1. What is actually required

| | |
|---|---|
| **Driver** | Node loss and rolling deploys |
| **Not the driver** | Throughput. Each family is very low-throughput. |
| **Tolerance** | A few seconds of blip on node loss or deploy is acceptable |
| **Not acceptable** | Losing the per-family encryption model |

That last row is the constraint everything else is measured against. The per-family
SQLCipher file is the security property this product is built on, and it was the
reason `@libsql/client` was dropped in favour of
`better-sqlite3-multiple-ciphers` (`api/src/db-core.ts`).

## 2. Rejected approaches

### Sharding by family

Attractive because the schema is already 100% family-scoped: every family is a
separate encrypted file with its own derived key, so no cross-family query is
even physically possible. It therefore *looks* like a design asking to be sharded.

**It is the wrong tool here.** Sharding solves throughput, which is not the
problem. Worse, it works against availability: a lost shard is *lost data*, so
sharding turns node loss from a non-event into an outage. The small size makes it
doubly pointless — a lost shard of kilobytes is an availability hole with no
scaling benefit behind it.

Sharding would only be right if throughput became the driver, which nothing
suggests.

### A shared filesystem for the databases

The obvious shortcut: put the encrypted SQLite files on a network filesystem and
let every replica mount them.

**Rejected.** SQLite relies on POSIX advisory locking and, in WAL mode, on shared
memory (`-shm`) via `mmap`. Neither is reliable over NFS or CIFS. The failure mode
is corruption, not contention, which is why this is not a "measure it first"
question.

### Postgres for family data

**Rejected for the same reason libSQL was:** Postgres has no per-family SQLCipher
equivalent. Column-level encryption breaks indexes and sorting; per-family
databases explode connection counts; and falling back to disk-level encryption
plus row-level security means one leaked dump exposes every family, with isolation
enforced by a connection string rather than by mathematics.

Postgres *does* appear in this design — for the registry, in §6. Small, global,
and genuinely the right fit there.

## 3. The property that makes this work

The per-family key is **derived, not stored**:

```
deriveKey(NIDO_MASTER_KEY, familyId, 'nido:db')
```

Deterministic from the master key and the family id. Every replica already holds
the master key, so **every replica can already decrypt every family file, and the
encrypted files are portable between replicas as opaque bytes.**

This is the thing libSQL's removal appeared to close and did not: libSQL had to
replicate *inside* the engine, where its encryption story was weak. Replicating at
the **file** level sidesteps that entirely. Ciphertext in transit, ciphertext at
rest, no new secrets, no new key material.

## 4. The design: snapshot, ship, restore

```
writer replica                     shared store                standby replica
──────────────                     ────────────                ───────────────
mutate family DBs
  → VACUUM INTO snapshot  ────────►  db-snapshots/<familyId>/  ──► (idle until promoted)
  → debounced / interval
```

**Active / passive.** One replica is the writer; it holds a lease in the registry
(the same take-or-renew pattern as `scheduler_leases`). Standbys hold no family
data and do nothing until they acquire the lease. Reads are forwarded to the
writer — fine, because throughput is not the problem.

**On becoming the writer**, a replica restores the latest snapshot from the shared
store and opens the databases. That restore is the blip.

**Snapshots are consistent and already encrypted.** `VACUUM INTO` produces a
point-in-time copy that inherits the SQLCipher settings — verified: the snapshot is
not plaintext, opens with the same derived key, and is refused with a wrong one.

**Snapshots are stored through `BlobBackend`, not `EncryptedBlobStore`.** The
snapshot is *already* encrypted by SQLCipher under a key derived from the same
master, so wrapping it in the blob store's AEAD would be redundant, not
defence-in-depth. Reusing the crypto-free backend gives path validation, atomic
writes, and a swap to S3 later, without a second encryption of the same bytes.

## 5. Precision on "seconds of blip"

| | |
|---|---|
| **RTO** (time to serve again) | Lease TTL + snapshot restore ≈ seconds |
| **RPO** (writes at risk) | The snapshot interval |

RTO is the headline and is comfortable. **RPO is the number to decide:** with a
snapshot every few seconds, a node loss can drop the last few seconds of writes.
That is a different thing from a few seconds of *downtime*, and it should be
chosen deliberately rather than inherited from whatever interval is convenient.

A cheap mitigation: keep a warm periodically-restored copy on standbys so
promotion is a reopen rather than a download.

## 6. The registry problem, which is the real one

**The registry cannot stay on SQLite in a multi-replica deployment.**

Leases require every replica to read and write `registry.db`. That makes it
multi-writer across machines — precisely the SQLite-over-a-network-filesystem case
rejected in §2. You cannot coordinate replicas with a database whose coordination
mechanism is unsafe to share.

So the sequence has a prerequisite:

| Phase | Family data | Registry | Gives you |
|---|---|---|---|
| **0 — today** | Local SQLite + durable volume | Local SQLite | Single replica. HA by fast restore from backup. Deploy = downtime. |
| **1** | unchanged | **Postgres** (pluggable) | Safe multi-replica coordination. Still single-writer, so no HA yet. |
| **2** | Snapshot + write lease + restore | Postgres | Node loss and rolling deploys survive with seconds of blip. |
| **3 — only if ever** | Live file shipping | Postgres | Zero downtime. Real work. |

Phase 1 must be **pluggable**, not a replacement: SQLite stays the registry
default for a single replica, so the simplest self-hosted install never takes on a
Postgres dependency. Postgres is what you opt into when you run more than one.

## 7. Self-hosting parity

The design constraint, restated as a test:

```bash
docker compose up --scale api=3     # must behave identically to
kubectl scale deploy/nido-api --replicas=3
```

This is why the coordinator is a **registry lease** and not orchestrator state:
no StatefulSet ordinal routing, no Ingress consistent-hash annotations, no
operator, no CRD, no k8s API calls. Nothing that would make compose a second-class
deployment.

Note this holds for the web tier trivially — it is stateless — and for the API
tier once the registry is shared. Neither needs an orchestrator beyond "run N
copies."

## 8. What this deliberately does not give you

- **Zero downtime.** A blip on promotion is accepted. §11 is the upgrade path.
- **Read scaling.** Standbys serve nothing until promoted. Throughput is not the
  driver, so this is correct rather than a limitation.
- **Point-in-time recovery across snapshots.** Retention keeps the latest snapshot
  per family, not a history. The existing backup path (`tar.ts`) is the archive
  story; this is the availability story.
- **Multi-writer.** One writer per replica set. Concurrent writers are what make
  distributed SQLite corrupt.

## 9. Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `NIDO_REGISTRY_URL` | Registry backend. Absent = local SQLite. | *(unset → SQLite)* |
| `NIDO_SNAPSHOT_INTERVAL` | How often family DBs snapshot to the shared store. Sets RPO. | *(to be decided)* |
| `NIDO_BLOB_DIR` | Shared store for snapshots and attachments. | `<NIDO_DATA_DIR>/blobs` |
| `NIDO_MASTER_KEY` | Root of key derivation. **Cannot be rotated.** | *(required)* |

## 10. Files

| File | Role |
| --- | --- |
| `api/src/db-namespaces.ts` | Registry, `scheduler_leases` (the lease pattern to generalize), family clients |
| `api/src/db-core.ts` | `deriveKey()`, `getDataDir()`, SQLCipher open path |
| `api/src/scheduler.ts` | The existing lease take-or-renew to extend for a write lease |
| `api/src/blob-store.ts` | `BlobBackend` reused for snapshot storage |
| `api/src/tar.ts` | Existing backup; the archive story, not the availability story |

## 11. If zero downtime is ever needed

Phase 3: the writer ships live changes rather than periodic snapshots — WAL bytes
after each commit — with standbys holding warm, near-current copies. Promotion
becomes a reopen instead of a restore, and the blip goes away.

This is a substantially harder problem (WAL checkpointing, ordered shipping, atomic
swap, consistency during handoff) and is **only** worth it if "a few seconds" stops
being acceptable. It is recorded here so Phase 2 does not have to be re-litigated
to reach it — the write lease and the shared store are the same foundation.

## 12. Unresolved

- **Why libSQL was actually dropped.** `db-core.ts` records the swap but not the
  reason. The encryption explanation is assumed throughout this document and is
  load-bearing: if libSQL was dropped for encryption, §2 and §3 stand; if it was
  dropped for maturity or cost, an embedded-replica model deserves a fresh hearing,
  because it would give HA with no snapshot tier at all.
- **Snapshot interval**, which is the RPO decision in §5.
- **Whether the registry moves wholesale to Postgres**, or grows a pluggable
  interface with SQLite retained as the single-replica default. §6 assumes the
  latter.
- **Draining semantics** for a rolling deploy: does the outgoing writer snapshot on
  release, or does the incoming replica simply restore the last periodic one?
