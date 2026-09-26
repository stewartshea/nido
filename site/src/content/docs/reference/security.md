---
title: Security model
description: What Nido encrypts, what it does not, and the things worth knowing before you deploy.
---

## Reporting a vulnerability

Please open a **private security advisory** rather than a public issue.

<div class="nido-card nido-card--edge" style="margin:1.5rem 0">
	<a href="https://github.com/stewartshea/nido/security/advisories/new" rel="noopener">Open a private security advisory →</a>
</div>

## The master key

`NIDO_MASTER_KEY` is the root of the whole system, and it is unforgiving in
two directions.

- **It is unrecoverable.** Lose it and every family database is lost, with no
  error to signal it and no recovery path.
- **It cannot be rotated.** Every family key is an HKDF-SHA256 subkey derived
  from it. Change the key and every existing database becomes undecryptable
  immediately.

Choose it once, before real data exists, and back it up **separately from the
data volume**. A copy of the key sitting on the same disk as the data protects
you from nothing.

There is deliberately no default and no fallback key. The API resolves
`NIDO_MASTER_KEY` and `JWT_SECRET` before binding a port, so a misconfigured
process exits rather than serving traffic under a key that is published in the
repository.

## What is encrypted

| Data | At rest |
| --- | --- |
| `registry.db` | SQLCipher, keyed by a `nido:registry` subkey |
| `db/<familyId>.db` | SQLCipher, keyed by an HKDF subkey **derived from that family id as salt** |
| Session tokens | Signed JWTs, 24h expiry |
| **Photos** | **Not encrypted on disk** |

The encrypted file *is* the tenant boundary. There is no `WHERE family_id = ?`
filter inside a family database because there is no need for one — see
[Architecture → the tenant boundary](./architecture/#the-tenant-boundary-is-a-file).

## What is not

:::caution[Photos are stored unencrypted]
Photo uploads are written to disk in the clear and are protected only by
authenticated, family-scoped routes. If the underlying disk is not encrypted,
anyone who can read that disk can read the photos.

Include them in an encrypted-at-rest backup, or encrypt the volume.
:::

:::caution[EXIF is preserved]
A photo's original EXIF — **including GPS coordinates** — is kept as uploaded.
Strip it before uploading anything you would rather not keep.
:::

:::caution[There is no upload size limit]
Photo uploads are MIME-validated and family-scoped, but there is currently no
maximum file-size check. Do not expose an upload path to untrusted or
high-volume traffic. Terminating at a proxy that caps request body size closes
the gap until the limit lands.
:::

## Request handling

| Concern | Rule |
| --- | --- |
| `familyId` | Attacker-influenceable and used to build a filesystem path. Must pass `assertFamilyId()` / `^[A-Za-z0-9-]{10,64}$` before touching the filesystem or a SQL string. |
| Authorization | Lives in `authz.ts`, **before** `getFamilyClient()`. Not in a query, not after. |
| SQL | Parameterized only. No request-derived string is ever concatenated into SQL. |
| Request bodies | Validated with `zod` before any database access. |
| Files | MIME-validated and scoped by `photos.family_id`. Client-supplied filenames and paths are never trusted. |

## Deployment checklist

- [ ] `NIDO_MASTER_KEY` generated with `openssl rand -hex 32` and backed up
      **off the data volume**
- [ ] `JWT_SECRET` generated independently of the master key
- [ ] `.env` at mode `0600`; never committed
- [ ] `SIGNUP_ENABLED=false` once the family is invited
- [ ] `ADMIN_EMAIL` set, so admin is not whoever registers first
- [ ] `PUBLIC_URL` set to the real public origin, not `localhost`
- [ ] `ALLOWED_HOSTS` set to the public hostname if behind a proxy
- [ ] TLS terminated in front of Nido
- [ ] Port `3000` not exposed to the internet — single-origin setup, or bind
      to `127.0.0.1`
- [ ] Automated volume backups running, with the key stored separately
- [ ] A restore has been **tested**, not merely written
- [ ] Request body size capped at the proxy, pending the upload limit

## Threat model in one paragraph

Nido assumes the host it runs on is trustworthy and the network in front of it
is not. It encrypts the most sensitive thing — a family's feeding, sleep and
health records — at rest with a key the operator controls, and it treats
authorization as a property of *which file gets opened* rather than of a `WHERE`
clause. It does not attempt to be hardened against a determined attacker with
shell access on the host, and it is not a medical device. A VPN is a better
front door than a hardening exercise.

## License

[Apache-2.0](https://github.com/stewartshea/nido/blob/main/LICENSE).
