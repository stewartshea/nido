---
title: Upgrading
description: Move a Nido instance to a new version without losing data.
---

Nido is not on a managed platform, so upgrades are yours to run. The good news:
upgrading the images does not touch your data.

## Before you start

```bash
# 1. back up the volume and confirm the key is safe
./backup.sh

# 2. note what you're on
docker compose ps
docker inspect nido-api-1 --format '{{.Config.Image}}'
```

A backup is not optional before an upgrade. It is the only thing standing
between a bad release and a family that has lost a year of sleep records.

## Upgrade

```bash
git pull
docker compose up -d --build     # build from source
```

Or, if you run the published images:

```bash
docker compose pull
docker compose up -d
```

## Verify

```bash
# the API's healthcheck
curl -fsS http://localhost:3000/health
docker compose ps          # both services Up, API healthy
```

Then log in and confirm a baby's records are present. The encrypted files
should open with the existing key untouched.

## What an upgrade can and cannot change

:::caution[Never rotate `NIDO_MASTER_KEY` during an upgrade]
The strings `'nido:db'` and `'nido:registry'` in `db-core.ts` /
`db-namespaces.ts` are **part of the data format**, not an implementation
detail. They are the HKDF salt and info for every family key.

Changing either one re-derives every subkey, and every existing database
becomes unreadable — with no error to signal it. If you ever see
"database is not a database" or an empty family after an upgrade, a derivation
change is the first thing to suspect.
:::

The data format is treated as a compatibility boundary:

- **Safe across versions** — container images, the web client, API routes,
  added features
- **Requires a migration and a documented procedure** — anything that changes
  how a family key is derived, or the on-disk layout of a family database

## Roll back

Rolling the images back is safe, because the old version reads the same files:

```bash
git checkout <previous-sha>
docker compose up -d --build
```

This works only as long as the newer version did not change the data format or
run a destructive migration. For that reason the project publishes every image
tag as `sha-<commit>`, so a rollback can be pinned to exactly the commit that
was running before — not merely "the previous release".

## Watching for new versions

Images are published to GHCR on every push to `main`, tagged `latest` plus
`sha-<commit>`. Watch releases rather than tracking `latest` if you would
rather review changes before they land:

```bash
gh release list --repo stewartshea/nido
gh release view <tag> --repo stewartshea/nido
```

The [roadmap](../project/roadmap/) lists what is in flight and what is still
planned.
