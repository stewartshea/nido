---
title: Funding
description: How Nido is funded — and how sponsorship relates to the software.
---

## The rule

**Every feature of Nido is free, and always will be.** Sponsorship buys
maintainer time: releases, security work, answering issues, keeping up with
dependency releases. It does not unlock anything, and no feature is ever gated
behind it.

There is no "pro" build, no feature flag behind a paywall, and no telemetry —
opt-in or otherwise. [My Nido](../my-nido/) is not a paid tier; it is free, and
it runs the same code as a self-hosted install. If a change ever made a feature
sponsorship-gated, that would be a different project, and it would be a
different repository.

If you self-host Nido, that is the whole arrangement. Nothing expires, nothing
phones home, and the [master key](../reference/security/#the-master-key) you
generated is the only key involved.

## Where to sponsor

Two options: a monthly sponsorship, or a one-time tip.

<div class="nido-card nido-card--edge" style="margin:1.5rem 0">
	<p style="margin:0 0 .75rem"><strong>GitHub Sponsors</strong> — monthly. Recurring, alongside your existing GitHub billing, and the single place to track a monthly total.</p>
	<a href="https://github.com/sponsors/stewartshea" rel="noopener">github.com/sponsors/stewartshea →</a>
</div>

<div class="nido-card nido-card--edge" style="margin:0 0 1.5rem">
	<p style="margin:0 0 .75rem"><strong>Ko-fi</strong> — one-time. For giving once, without a GitHub account and without taking on a recurring commitment.</p>
	<a href="https://ko-fi.com/sheastewart0494" rel="noopener">ko-fi.com/sheastewart0494 →</a>
</div>

Neither is a tier, and nothing sits behind either one. The [support
page](../../support/) renders these from `site/src/site.config.ts`, so there is
one place to change a URL if a channel moves.

## Why GitHub Sponsors comes first

Not sentiment — friction. It sits alongside the GitHub billing the audience for
a self-hosted developer tool already has, so supporting costs no extra account,
no second payment method, and no second thing to cancel. It also handles the
cross-border tax withholding and reporting that a solo maintainer would
otherwise own.

GitHub takes no platform fee on sponsorship from a personal account, and Ko-fi
takes no platform fee on a tip, so either way the whole amount arrives. The
distinction between them is shape, not cost: one is recurring, the other is not.

## What sponsorship pays for

Time goes to the unglamorous things that keep a dependency-bearing project
safe:

- Keeping up with security advisories in the SvelteKit, Node and SQLite
  dependency trees
- Keeping the docs and the in-app guidance aligned with the code, including
  this site
- Reproducing and fixing the reports that arrive with "it broke during the
  3am feed" as the headline
- The unglamorous releases nobody notices: a digest of CVE fixes

None of that is visible in a changelog until the day it matters, which is
exactly the kind of work sponsorship struggles to attract and easiest to skimp
on.

## What it does not buy

- **No feature requests.** Sponsorship is not a vote on the
  [roadmap](./roadmap/). The roadmap responds to what people actually hit, and
  a concrete use case moves further than a larger invoice.
- **No priority support.** Issues are answered in the order they arrive. A
  reproducible bug report is worth more than any tier.
- **No guarantee of anything.** Nido is maintained in one person's evenings.
  It is offered as-is, with no SLA.

## Elsewhere

- **Source** — [github.com/stewartshea/nido](https://github.com/stewartshea/nido),
  [Apache-2.0](https://github.com/stewartshea/nido/blob/main/LICENSE)
- **Issues** — [github.com/stewartshea/nido/issues](https://github.com/stewartshea/nido/issues)
- **Security reports** — a
  [private advisory](https://github.com/stewartshea/nido/security/advisories/new),
  not a public issue
