---
title: Privacy policy
description: What My Nido stores, where it lives, and the only emails it will ever send you. Short version — your data is yours, and we want as little of it as possible.
---

This policy covers **My Nido** ([my.nido-app.ca](https://my.nido-app.ca)),
the hosted version of Nido. If you self-host, none of this applies to you —
your data never leaves your own hardware, and there is nothing to policy about.

It is written to be read, not to hide behind. If anything here is unclear,
[open an issue](https://github.com/stewartshea/nido/issues) and ask.

## What we store

- **Your account** — an email address and a password hash. The password itself
  is never stored.
- **Your family's records** — everything you log: feeds, diapers, sleep,
  growth, milestones, vaccinations, journal entries, and the blobs you upload.
- **Very little else.** There is no analytics, no telemetry, no tracking
  pixels, and no advertising. There is nothing to "improve the product" with,
  because nothing reports back.

## Where it lives

My Nido runs on hardware in **Canada**, and your data stays there. Each
family's records live in their own encrypted database file — see the
[security model](./reference/security/) for exactly what is encrypted and what
is not. (The short honest version: databases are encrypted at rest; uploaded
blobs are not, yet.)

## The only emails you will ever get

My Nido sends email for **your account only**, and only when it has to:

- **Verifying your email address** when you sign up
- **Resetting your password** when you ask for it
- **A family invitation** — only when someone you know invites you to their
  family
- **A confirmation** if your account is deleted

That is the complete list. **No marketing emails, no newsletters, no "we miss
you" nudges, no product announcements.** If you get an email from My Nido,
it is because something happened to your account, not because we want your
attention.

## What we never do

- **Sell, rent, or share your data** with anyone, for any reason
- **Run ads** or let advertisers anywhere near your records
- **Track you** — no analytics, no behavioural profiling, no third-party
  cookies
- **Train anything on your data** — your baby's records are not model food
- **Require third-party accounts** — no "sign in with Google", no social login

## Your data is yours

- **Export everything, any time.** The same JSON export that ships in the
  self-hosted version works in My Nido — see
  [Backup & restore](./guides/backup-and-restore/). You can move to a
  self-hosted install whenever you like.
- **Delete your account** and your family's data goes with it. We will send one
  confirmation email, and then nothing, ever again.

## Who runs this

My Nido is operated by the maintainer of
[stewartshea/nido](https://github.com/stewartshea/nido), one person, in their
evenings. The code is Apache-2.0 and auditable end to end — if you want to know
exactly what the server does with a request, you can
[read it](https://github.com/stewartshea/nido).

## Changes to this policy

If this policy ever changes, the change lands in
[this repository](https://github.com/stewartshea/nido) first, in the open,
before it takes effect. Material changes will be called out on this page — not
quietly edited.

*Last updated: September 2026.*
