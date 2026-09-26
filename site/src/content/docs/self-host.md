---
title: Self-hosting Nido
description: Run Nido on your own hardware. Free forever, no account, no telemetry, no hosted version to migrate to.
---

<div class="nido-card nido-card--edge" style="margin:0 0 1.75rem">
	<p style="margin:0">
		<strong>Nido is free and always will be.</strong> There is no paid tier, no
		feature is locked, and self-hosting is the only supported way to run it.
		If you can run Docker, you can run Nido.
	</p>
</div>

## What you get by running it yourself

- **Your hardware, your disk.** Every family's data sits in a volume you control.
  Nothing is uploaded anywhere.
- **No account to create.** No sign-up, no email verification loop, no company
  holding a copy of your baby's records.
- **No telemetry.** Not opt-in, not anonymized — there is none to enable.
- **No hosted version to outgrow.** There is no service to migrate away from, so
  no migration. Your data stays where you put it.
- **Photos under your control.** Stored in a directory on your disk, not in
  someone's object store.

## What you take on

Honesty about the trade-off, because a self-hosted tool pushes work onto you:

| Nido handles | You handle |
| --- | --- |
| Keeping the app working | Keeping the **host** patched and running |
| Encrypting the database at rest | Backing up the volume **and the master key** |
| Auth, roles, family sharing | TLS if you expose it to the internet |
| Photo and record storage | Disk space, which photos will eat |

The one that catches people out is the master key. See below.

## Five minutes to a running instance

```bash
git clone https://github.com/stewartshea/nido.git
cd nido
./scripts/init-env.sh   # writes .env with freshly generated secrets
docker compose up -d
```

Then open <http://localhost:3001>. The API health check is on
<http://localhost:3000/health>.

`init-env.sh` generates `NIDO_MASTER_KEY` and `JWT_SECRET` with
`openssl rand -hex 32`, writes a `.env` at mode `0600`, and **refuses to
overwrite an existing file**. That refusal protects the only copy of your key.

Full detail, including the `deploy/docker-compose/` variant for a server:
[Installation →](./getting-started/installation/).

## Back up the key first

<div class="nido-card nido-card--edge nido-card--alert" style="margin:1.75rem 0">
	<p style="margin:0 0 .6rem"><strong>The one thing to do before you log in.</strong></p>
	<p style="margin:0">
		<em>Every family's database is encrypted with a key derived from
		<code>NIDO_MASTER_KEY</code>. It cannot be recovered and it cannot be
		rotated.</em> If you lose it, the data is unrecoverable — with no error to
		warn you first. If you change it later, the same thing happens to every
		family.
	</p>
</div>

```bash
grep NIDO_MASTER_KEY /path/to/nido/.env
```

Put that value in a password manager, **somewhere other than the data volume**.
A copy of the key on the same disk as the data protects you from nothing. Then
read [Backup & restore](./guides/backup-and-restore/), which covers both halves
and includes a restore you should test once.

## What you need

- **Docker** with Compose v2 — the only hard requirement
- Roughly 1 GB for the images, plus whatever your photos need. Years of daily
  photos will dwarf every database Nido writes.
- Node.js 18+ only if you plan to run the services outside containers

You do **not** need a domain, a public IP, or a TLS certificate to start.

:::note[Running a public instance? A VPN beats a hardening project.]
Put it behind Tailscale or WireGuard and the public attack surface is gone. If
you would rather have a hostname,
[Reverse proxy & TLS](./guides/reverse-proxy-and-tls/) has working Caddy,
Traefik and nginx configs — and one of them is a footgun to avoid.
:::

## Already have a server or a cluster?

- [Reverse proxy & TLS](./guides/reverse-proxy-and-tls/) — one domain, one
  certificate, no CORS
- [Kubernetes](./guides/kubernetes/) — single-pod and multi-pod manifests, and
  why `replicas: 1` is load-bearing
- [Upgrading](./guides/upgrading/) — pull a new image without touching data
- [Containers & volumes](./reference/containers/) — what is in each image, and
  what is deliberately not

## The honest short answer

Nido is free because it runs on your hardware. There is no revenue model
attached to your data, because your data never leaves the machine you installed
it on.

If it saves you time, the project accepts
[sponsorship](./project/funding/) — which buys maintainer time and nothing else.
No feature is behind it, and none ever will be.

<div class="nido-card nido-card--edge" style="margin-top:1.75rem">
	<p style="margin:0 0 .6rem"><strong>Prefer to read the code first?</strong></p>
	<p style="margin:0">
		The whole application is
		<a href="https://github.com/stewartshea/nido" rel="noopener">Apache-2.0</a> and
		about two containers. The tenant model is one encrypted SQLite file per
		family, explained in [Architecture](./reference/architecture/), and what is
		and isn't encrypted is in [Security model](./reference/security/).
	</p>
</div>
