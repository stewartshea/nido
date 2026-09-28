---
title: Roadmap
description: What is planned for Nido, and what is deliberately not.
---

## Where this is going

*Nido* means "nest" — something you build, keep, and look after. The infant
tracker is where it starts, not where it stops. A baby grows up, and the list of
things needing care gets longer rather than shorter, so the next tracker Nido is
being built for is **home maintenance and care**.

The same ideas, pointed at a whole home instead of one small person: recurring
tasks with history, reminders for what is due, shared between the people who
live with them, and exportable so the records stay yours. The filter that needs
changing, the water heater that needs flushing, the smoke alarms that need
testing, the warranty that expires in March.

It is built in the open and in the same codebase as the infant tracker. If that
direction is wrong for your household, [open an issue](https://github.com/stewartshea/nido/issues)
— the ordering responds to what people actually want tracked.

## Planned

- **Home maintenance and care tracker.** The next tracker, described above. It
  reuses the infant tracker's patterns — history, reminders, shared access and
  export — for the things a house needs, rather than a baby.
- **Photo size limits and server-side EXIF stripping.** Both are known gaps —
  there is no maximum file-size check on upload today, and original EXIF
  (including GPS) is preserved as uploaded. Closing them removes two items from
  the [security checklist](../reference/security/#what-is-not).
- **Tests in CI.** `npm test` runs both workspaces locally; wiring it into a
  workflow is straightforward and overdue.
- **Static build of the web client.** A static export would let the UI be
  served from a CDN while the API stays self-hosted, and would remove the Vite
  dev server from the production path entirely.

## Deliberately not planned

Worth being explicit, because "no" is easier to respect when it is written
down.

| Not doing | Why |
| --- | --- |
| **A paid tier** | Neither way of running Nido costs money. [My Nido](../my-nido/) is free, self-hosting is free, and sponsorship buys maintainer time without unlocking anything. |
| **Feature paywalls** | Sponsorship buys maintainer time — releases, security work, answering issues. It does not unlock features. See [Funding](../project/funding/). |
| **Telemetry or analytics** | Not even opt-in. A baby tracker that reports home is a surveillance tool. |
| **Third-party accounts or social login** | More external dependencies, and more ways for a child's data to reach a server that is not yours. [My Nido](../my-nido/) asks for an email and a password and nothing else. |
| **HIPAA compliance as a marketing claim** | Nido is a record-keeping and charting tool, not a medical device. It does not diagnose. Use [WHO and CDC curves](../reference/architecture/#growth-tracking) to have a conversation with a paediatrician, not instead of one. |

## Shipped

The current feature set is listed in the
[documentation index](../index/#what-nido-does), and the release history is
on the [releases page](https://github.com/stewartshea/nido/releases).

## Have a say

The roadmap reflects one person's evenings. If something here is wrong for your
household, [open an issue](https://github.com/stewartshea/nido/issues) — the
ordering responds to what people actually hit, and a concrete use case moves
further than enthusiasm.
