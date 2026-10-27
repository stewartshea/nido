---
title: Releases
description: How Nido is versioned, what a release contains, and which tag to pin.
---

Nido uses **CalVer**: the version is the date the release was cut —
`v2026.10.26` — with `.2`, `.3` added when a second release lands on the same
day. The tag is the only version that means anything; the `version` fields in
the `package.json` files stay at their initial placeholder because nothing
reads them, so they cannot disagree with a release.

## What a release is

A release is a tag on `main`, cut by hand from the `Release` workflow in the
[nido repository](https://github.com/stewartshea/nido). It is not on a
schedule: a release is a claim that this commit is safe against someone's
family data, and that is not a judgement a cron should make unattended.

Cutting one does four things, in order:

1. Tags the commit `v<date>` and creates a GitHub Release whose notes are
   generated from the pull requests merged since the previous tag.
2. Builds and publishes `ghcr.io/stewartshea/nido/{api,web}:v<date>` — an
   immutable pair of images — and moves `:latest` to it.
3. Waits for those images to exist in the registry.
4. Pins the hosted instance's manifests to the tag, in a separate
   infrastructure repository. Flux reconciles that repository into the cluster,
   so the release — not a pod restart — is what rolls production.

Step 4 is deliberate, and it is the part that is easy to get wrong. A floating
tag on a Deployment looks automatic and is not: the tag is resolved when a pod
is created, so a release that only moves `:latest` changes nothing until
something recreates the pod. A release that pins a version rolls the cluster
when it is cut, and the manifest on the cluster says which release is running.

## Which tag to use

| Tag | What it is | Use it for |
| --- | --- | --- |
| `:v<date>` | A release. Immutable. | Anything you rely on. |
| `:latest` | The newest release. Moves when a new one is cut. | Trying Nido, nothing more. |
| `:main` | The newest merge to `main`. Unreleased. | Following development. |
| `:sha-<commit>` | One commit, exactly. | Rolling back, or reproducing a bug. |
| `:dev` | The newest build of an open pull request. | Previewing a change. |

Pin a release tag in anything you keep running. `:latest` means "whatever the
newest release is, whenever this container next starts", which is a different
thing from "the release I chose".

## Upgrading and rolling back

Upgrading images does not touch your data — the databases live on a volume,
never in an image. The [upgrading guide](../guides/upgrading/) covers the
steps, and [backup & restore](../guides/backup-and-restore/) covers what to do
first.

Two properties of the data matter before any upgrade:

- **Schema migrations run lazily** — the first time a family's database is
  opened after the upgrade, not when the container starts — and they are not
  reversible in place.
- **`NIDO_MASTER_KEY` cannot be rotated.** If it is lost, the family databases
  are unreadable, so confirm the key is safe before you touch the images.

Rolling back is safe while the newer version has not changed the data format.
Pin `:sha-<commit>` for the exact build that was running before; that is what
makes a rollback honest rather than approximate.

## Release notes

There is no `CHANGELOG.md`. The notes on the
[releases page](https://github.com/stewartshea/nido/releases) are generated from
merged pull-request titles, deliberately: a hand-kept changelog drifts the
moment someone forgets, and a stale changelog looks authoritative while being
wrong.

The trade is that generated notes list changes rather than explain them. If a
release's pull requests touch the schema, treat the upgrade as a
**data-format change**: read the migration itself in `api/src/db-namespaces.ts`
and take a backup before you upgrade, rather than reading the note as a feature
list.

## The hosted instance

[My Nido](../my-nido/) runs the same code under a pinned release tag, rolled by
the same release step described above. There is no hosted-only build and no
feature only one side can see; when My Nido is ahead of or behind what you are
running, that is deployment timing, not a product difference.
