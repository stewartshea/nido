---
title: First run
description: Register the first account, add a baby, and invite the other caregivers.
---

## Back up the master key before you log in

The very first thing worth doing is getting `NIDO_MASTER_KEY` out of the server
and into your password manager. Every family's database is encrypted with a key
derived from it, and there is no recovery path.

```bash
# read it out of the .env you already have
grep NIDO_MASTER_KEY /path/to/nido/.env
```

Store it **somewhere other than the data volume** — a synced password manager
is ideal. A backup of the volume sitting next to the same key on the same disk
protects you from nothing.

Full procedure: [Backup & restore → back up the key](../guides/backup-and-restore/#1-back-up-the-master-key).

## Create the first account

Open <http://localhost:3001> and register.

- If `ADMIN_EMAIL` is set, that address gets platform admin on first boot.
- If it is left empty, **the first account to register becomes the platform
  admin**. Register yourself first on a fresh instance.

Only the platform admin can reach **Account Settings → Admin**, which is where
the registration toggle lives.

:::caution[Close registration once the family is set up]
Leaving `SIGNUP_ENABLED` at its default means anyone who can reach your instance
can create an account. Set `SIGNUP_ENABLED=false` when you are done inviting
people — the env var is authoritative and locks the Admin panel toggle.
:::

## Add your baby

Sign in and add a family member: name, birth date, and a member type. Each
member gets their own avatar, and every record — feed, diaper, sleep, growth
entry, milestone — is attached to a member rather than to "the baby". That
matters if you ever track a sibling or a pet-level daily log.

## Invite the other caregivers

**Settings → Family** (or the invite flow) generates a link. Accepting it adds a
user to the same family with a role:

| Role | Can do |
| --- | --- |
| **Owner** | Everything, including export, restore and member removal |
| **Admin** | Manage records and members; cannot remove the owner |
| **Member** | Log and view records |

A second adult on the same shift is the whole point of the app — one person
logs the 3am feed, the other sees it on waking. A shared login is not needed
and is not recommended, because it destroys the audit trail of who logged what.

## Try the offline queue

Turn off your phone's Wi-Fi and log a diaper. It appears immediately and is
queued under the `nido.outbox` localStorage key (capped to the most recent 200
entries), then replayed on reconnect. This is what makes logging work in a
basement or a hospital corridor.

## Pick a theme

**Settings → Appearance** offers 7 palettes × light and dark, plus a custom
theme editor. The default is *forest* — the same palette the documentation
you're reading is themed in.

## What to do next

- [Back up & restore](../guides/backup-and-restore/) — set up a real backup now, not later
- [Security model](../reference/security/) — what is and isn't encrypted
- [Upgrading](../guides/upgrading/) — how to move to a new version
