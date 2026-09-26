---
title: Funding
description: How Nido is funded — and how sponsorship relates to the software.
---

## The rule

**Every feature of Nido is free, and always will be.** Sponsorship buys
maintainer time: releases, security work, answering issues, keeping up with
dependency releases. It does not unlock anything, and it cannot be turned on
mid-session to make a feature disappear.

There is no hosted tier, no "pro" build, no feature flag behind a paywall, and
no telemetry — opt-in or otherwise. If a change ever made a feature
sponsorship-gated, that would be a different project, and it would be a
different repository.

If you self-host Nido, that is the whole arrangement. Nothing expires, nothing
phones home, and the [master key](../reference/security/#the-master-key) you
generated is the only key involved.

## Where to sponsor

<div class="nido-card nido-card--edge" style="margin:1.5rem 0">
	<p style="margin:0 0 .75rem"><strong>GitHub Sponsors</strong> — primary. Recurring, alongside your existing GitHub billing, and the single place to track a monthly total.</p>
	<a href="https://github.com/sponsors/stewartshea" rel="noopener">github.com/sponsors/stewartshea →</a>
</div>

One-time tips and the platforms not yet in use are listed on the
[support page](../../support/), which also explains the reasoning behind the
choice.

## Why GitHub Sponsors is the primary

It is the lowest-friction option that already exists for this audience: the
people most likely to sponsor a self-hosted developer tool are the people
already spending money on GitHub, and adding a second account with a second
payment method to express the same preference is a tax on generosity.

Beyond convenience, the practical reasons:

- **No platform is permanent.** A hosted dependency — a payment processor, a
  hosted version, an account-gated download — is a single point of failure for
  a project whose entire premise is that it runs on your own hardware with no
  external dependencies. Sponsorship keeps that property true.
- **Fewer places for a child's data to go.** Nido has no third-party accounts
  and no social login. A donation platform is not part of the running
  application, and the project has no integration with one.

:::caution[Check the fee before you publish a percentage]
Platform fees, payout thresholds and tax handling change on their own
schedule, and this page deliberately does not quote a take rate. If you are
reading this and comparing options, take the current numbers from the
platform's own pricing page rather than from a blog post or from memory.
:::

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
exactly the kind of work sponsorship struggles to attract and easiest to
skimp on.

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
