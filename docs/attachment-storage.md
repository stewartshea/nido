# Attachment Storage — Architecture

Attachments are files a family keeps against the things it records: a photo of a
rash on a feeding, a vaccination report against a vet visit, a receipt against an
inventory item. This document covers where those bytes live, how they are
encrypted, and how the storage layer is kept from becoming the thing that breaks
the tenancy model.

The requirement that drives all of it: **the filesystem must not be able to break
a tenant boundary.** A database row is reached through a query we wrote; a file
is reached through a path. Paths are easier to get wrong, and they survive across
processes, backups and operators copying things around.

## 1. Two concerns, deliberately apart

```
BlobBackend          raw byte storage, addressed by a storage key.
                     Local filesystem today, S3-compatible later.
                     Knows nothing about encryption.

EncryptedBlobStore   wraps a backend and is the only handle callers get.
                     Encrypts on write, decrypts on read.
```

The backend has no crypto in it, so a new backend cannot be wired up without
passing through the same sealing. The store has no filesystem in it, so the
encryption cannot accidentally depend on a filesystem behaviour S3 does not
have.

This mirrors how the database layer already works: `deriveKey()` gives every
namespace a subkey, and nothing above it handles the master key.

## 2. The tenancy argument

Three gates, and each is independently sufficient to stop a cross-tenant read.
They are stacked because any one alone is thin.

**Gate 1 — the path is namespaced by a validated id.** A blob's storage key is
`blobs/<familyId>/<yyyy>/<mm>/<blobId>.bin`. `familyId` is checked against
`FAMILY_ID_RE` (`/^[A-Za-z0-9-]{10,64}$/`) before it can appear in a path, so
`../` and absolute paths are rejected at the boundary rather than sanitised
later. `blobId` is a UUID, checked against its own pattern.

**Gate 2 — the content key is derived from the family.** The encryption key is
`deriveKey(master, familyId, 'nido:blobs')`. Naming another family gets you a
different key, so a guessed or copied path yields ciphertext you cannot decrypt.
The `'nido:blobs'` info string is distinct from `'nido:db'`, so a blob subkey
cannot open a database and a database subkey cannot open a blob. One leaked
subkey does not compromise the others.

**Gate 3 — the address is authenticated as associated data.** The storage key
itself is fed to AES-GCM via `setAAD`. If a file is copied into another family's
directory — the case where an operator, a bad script, or a misconfigured sync
makes the *path* valid while the *bytes* belong to someone else — decryption
fails authentication. The ciphertext is not just unreadable; it is provably not
from where it claims to be.

Gates 2 and 3 are what make this different from "the folder is named after the
family". A directory name is a label. A derived key is a capability.

## 3. What a stored blob looks like

```
MAGIC(4) = "NIDB" | VERSION(1) | IV(12) | ciphertext ... | TAG(16)
```

- **AES-256-GCM**, one AEAD pass over the whole file.
- The **header is plaintext and is not authenticated by the cipher**; it carries
  only the format marker, a version, and the IV. It is deliberately outside the
  payload so a future version can change the frame without re-reading every file.
- The **tag is a trailer** because GCM produces it at the end. Reads therefore
  hold back the final 16 bytes until the stream finishes before they can verify
  anything.
- The **IV is random per blob**, so the same photo uploaded twice produces
  different ciphertext.

Why one pass rather than per-chunk tags: a single construction is easier to
audit, and attachments are photos and PDFs, not video. The tradeoff is recorded
in §7.

## 4. The size ceiling

`DEFAULT_MAX_BLOB_BYTES` is 25 MiB, enforced **during** the stream by a metering
transform, not by trusting a `Content-Length` and not after the fact. A write
that exceeds the ceiling aborts mid-flight and leaves nothing behind.

The ceiling is also what bounds memory on the read path, which matters because
§7 explains why reads buffer more than writes do.

## 5. Atomicity

A reader must never see a partial blob. The local backend writes to a sibling
`.tmp-<uuid>` file in the same directory and `rename()`s it into place only on
`finish`, which is atomic on one filesystem. Files are created `0600`, because
even ciphertext should not be world-readable.

A failed write removes its temp file. A crashed process can leave a `.tmp-` file
behind, but never a real key pointing at half a file.

## 6. Where the bytes live

### Local filesystem

`NIDO_BLOB_DIR`, defaulting to `<NIDO_DATA_DIR>/blobs`.

**This is deliberately separate from `NIDO_DATA_DIR` itself.** SQLite over a
network filesystem is a corruption risk — locking and mmap do not behave across
NFS or CIFS — so the database directory must stay local to a single replica.
Attachment bytes carry no such constraint. Splitting the two is what allows:

- the **API and web tiers to scale out independently** against a shared blob
  mount, while each replica keeps its own local database directory;
- a small self-hosted deployment to leave everything in one place and never
  think about it.

If they shared one volume, scaling the API would mean putting the databases on a
network filesystem, which is the failure mode this split exists to avoid.

### S3-compatible storage

Deferred, but the interface is shaped for it. A blob key is already a
slash-separated, prefix-friendly path, so it maps to an S3 object key unchanged.
The backend contract is `createWriteStream` / `read` / `remove` / `exists`; an S3
backend implements those over multipart upload and ranged GET and needs no crypto
of its own.

The one gap to close when S3 lands: S3 has no atomic rename. The equivalent is a
multipart upload completed in one call, which is atomic by construction — the
object appears only when the upload completes. That is a better fit than the
temp-file dance, not a workaround for it.

## 7. Deliberately not built

- **Range reads.** One AEAD pass means the whole file is authenticated together,
  so a partial read cannot be served without decrypting from the start. Reads
  buffer up to the ceiling in memory. If large attachments or video arrive, the
  upgrade is chunked AEAD with per-chunk tags — a format change, gated by
  `VERSION`.
- **Deduplication.** Two families storing the same file keep two copies. That is
  correct for the tenancy model: a shared content-addressed store would make one
  family's existence inferable from another's storage.
- **Attachment metadata.** There is no table yet saying which record a blob hangs
  off. That belongs to the feature work and the foreign-key shape is an open
  question on the roadmap issue.
- **Quotas.** Only a per-file ceiling exists. A per-family total needs a counter
  and a decision about what happens at the limit.

## 8. Backup and restore

The existing backup path bundles a family's encrypted database with `tar.ts` and
gzip. Attachments are already encrypted at rest under the same master key, so
they can be archived as-is — **but only if the master key is preserved.** A blob
archive without `NIDO_MASTER_KEY` is unreadable bytes, exactly like the database.
This is the same warning the database backup already carries, and it extends to
attachments without exception.

Deletion has to be honoured in both directions: deleting a family must remove its
blob prefix, and deleting a member must remove the blobs hanging off that member's
records. Neither is wired up yet.

## 9. Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `NIDO_BLOB_DIR` | Where attachment bytes live. Point at a shared mount to scale out. | `<NIDO_DATA_DIR>/blobs` |
| `NIDO_MASTER_KEY` | Root of all key derivation. **Cannot be rotated.** | *(required, no default)* |

## 10. Files

| File | Role |
| --- | --- |
| `api/src/blob-store.ts` | `BlobBackend`, `LocalBlobBackend`, `EncryptedBlobStore`, frame format |
| `api/src/blob-store.test.ts` | Round trip, on-disk assertions, tenancy boundary, damaged input |
| `api/src/db-core.ts` | `deriveKey()`, `getDataDir()`, `FAMILY_ID_RE` |
| `api/src/tar.ts` | Streaming tar used by backup; attachments ride along |
