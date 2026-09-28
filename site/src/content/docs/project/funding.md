---
title: Funding
description: How Nido is funded — and how sponsorship relates to the software.
---

## The rule

**Every feature of Nido is free, and always will be.** Sponsorship buys
maintainer time: releases, security work, answering issues, keeping up with
dependency releases. It does not unlock anything, and it cannot be turned on
mid-session to make a feature disappear.

There is no "pro" build, no feature flag behind a paywall, and no telemetry —
opt-in or otherwise. [My Nido](../my-nido/) is not a paid tier; it is
free, and it runs the same code as a self-hosted install. If a change ever made
a feature sponsorship-gated, that would be a different project, and it would be a
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

It is the cheapest option available and the lowest-friction one that already
exists for this audience. The people most likely to sponsor a self-hosted
developer tool are the people already spending money on GitHub, and adding a
second account with a second payment method to express the same preference is a
tax on generosity.

The cost comparison, as of this writing:

| Platform | Platform fee | Payment processing (CA) |
| --- | --- | --- |
| **GitHub Sponsors** | **0%** on a personal account | included |
| Buy Me a Coffee | 5% | ~2.9% + $0.30, plus 0.5% on payout |
| Patreon | 10% | ~3.2% + CA$0.35 |

GitHub takes no platform fee on sponsorship from a personal account, so a
sponsor's money arrives intact. Patreon and Buy Me a Coffee both take their cut
first and then charge processing on top, and because the processing component
has a fixed component per transaction, the effective rate on a small monthly
amount is meaningfully worse than the headline.

Beyond fee, the practical reasons:

- **No platform is permanent.** A hosted dependency — a payment processor, a
  hosted version, an account-gated download — is a single point of failure for
  a project whose entire premise is that it runs on your own hardware with no
  external dependencies. Sponsorship keeps that property true.
- **Fewer places for a child's data to go.** Nido has no third-party accounts
  and no social login. A donation platform is not part of the running
  application, and the project has no integration with one.

:::caution[Fees change]
The numbers above were read from each platform's own pricing documentation and
will go stale. If you are comparing options, take the current figures from the
platform's pricing page rather than from this table.
:::

## Why not Patreon

It is the most expensive of the three, and its shape is wrong for this.

- **It charges 10% before processing even starts**, where GitHub Sponsors
  charges nothing. For a project whose supporters are mostly individuals
  giving small amounts, that difference is most of the donation.
- **It is a membership platform, and this is not a membership.** Patreon tiers
  exist because there is stuff behind them — early builds, private channels,
  badges. Here there is exactly one thing, the software, and it is already
  free. A tier would be a label on a donation.
- **A recurring membership creates an obligation to keep recurring.** Someone
  paying monthly reasonably expects the relationship to continue, which is a
  commitment a solo maintainer of a free project should not be making.

Buy Me a Coffee is the better fit for a one-time tip: it is far cheaper than
Patreon, and it asks for nothing in return.

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
