---
title: Backup & restore
description: Back up the Nido data volume and the master key, and restore from either.
---

A Nido backup is **two things**, and they are useless apart:

1. The data volume — `registry.db`, `db/<familyId>.db`, `photos/`
2. The `NIDO_MASTER_KEY` that keys it

The volume alone is ciphertext. The key alone is nothing. A backup of one
without the other is not a backup.

## 1. Back up the master key

```bash
grep NIDO_MASTER_KEY /path/to/nido/.env
```

Copy that value into a password manager, or somewhere with its own backup. Get
it out of the server now, while you are still reading.

:::danger[This key cannot be rotated]
Every family database is keyed by an HKDF-SHA256 subkey derived from
`NIDO_MASTER_KEY`, with the family id as salt. Change the key and every
existing database becomes undecryptable — immediately, silently, with no
migration path and no error. Only a matching key *and* a matching data volume
will ever open them again.

Choose it once, before real data exists, and never rotate it.
:::

## 2. Back up the data volume

Data lives at `/data` inside the API container. What follows depends on whether
you used a named volume or a host bind mount.

### Named volume (`deploy/docker-compose`)

```bash
docker run --rm \
  -v nido-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/nido-data-$(date +%F).tgz -C /data .
```

The `:ro` read-only mount is deliberate — a backup tool should not be able to
write to the thing it is copying.

### Bind mount (development stack, `./data`)

```bash
tar czf ~/nido-data-$(date +%F).tgz -C ./data .
```

### Kubernetes

```bash
kubectl -n nido exec deploy/nido -- tar czf - -C /data . > nido-data-$(date +%F).tgz
```

## 3. Back up photos

Photos live in the same volume under `/data/photos`, so the volume archive
already contains them. Know this, because it means photos are usually the bulk
of the backup — a few years of daily photos will dwarf every database Nido
writes.

## Automate it

A daily `cron` entry beats remembering to do it. Back up both the volume and
the key on a schedule, and **keep the key backup somewhere the volume backup
cannot reach.**

```bash
#!/usr/bin/env bash
# /opt/nido/backup.sh — run daily from cron
set -euo pipefail
DEST="${NIDO_BACKUP_DIR:-/var/backups/nido}"
STAMP="$(date +%F)"
mkdir -p "$DEST"

docker run --rm \
  -v nido-data:/data:ro \
  -v "$DEST":/backup \
  alpine tar czf "/backup/nido-data-$STAMP.tgz" -C /data .

# prune anything older than 30 days
find "$DEST" -name 'nido-data-*.tgz' -mtime +30 -delete
```

```text
17 4 * * * /opt/nido/backup.sh
```

:::tip[Test the restore]
A backup you have never restored from is a hypothesis. Once, on a throwaway
machine, run the restore below and confirm a baby's records appear.
:::

## Restore

### The whole volume

```bash
# stop first, so nothing writes mid-restore
docker compose down

docker run --rm \
  -v nido-data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/nido-data-2026-01-14.tgz -C /data'

docker compose up -d
```

### The right key

The API must be started with the same `NIDO_MASTER_KEY` that the backup was
taken under. Put it in `.env` **before** `docker compose up -d`, or every
family database will fail to open.

```bash
# sanity check the key format before starting: 64 hex characters
grep -E '^NIDO_MASTER_KEY=[0-9a-f]{64}$' .env
```

## Export a single family

Per-family JSON export is a separate mechanism from the volume backup, and it
answers a different question: *how do I move one family off this instance?*

`GET /families/:id/export` and `POST /families/:id/restore` are owner- or
admin-gated. A family can also export from the UI.

Worth knowing: the JSON export is **not** the same protection as the encrypted
volume. It is readable data. Treat it as a medical record — it is exactly the
kind of file you would not paste into a chat window.

## Start clean

To throw away all state and begin again, reset the storage layer. **Swapping
images alone never clears data** — the volume is what holds it.

```bash
# named volume
docker compose down -v

# bind mount
docker compose down && rm -rf ./data
```

## Also consider

- **Photos are not encrypted at rest.** They are unencrypted files on disk,
  protected only by authenticated, family-scoped routes. Include them in
  encrypted-at-rest backups if the disk itself is not encrypted.
- **Original EXIF is preserved**, including GPS. Strip it before uploading
  anything you would rather not keep.
