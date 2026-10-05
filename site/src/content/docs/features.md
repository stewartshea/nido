---
title: Features
description: What Nido actually does — logging, people, photos, inventory, reminders, and the home inventory that comes after the baby stage.
---

Nido is a private record of the things you care for and keep. It starts as a
baby log and grows into a household record: the same app, tracking more
members and more kinds of thing.

This page describes what is in the app today. [First run →](../getting-started/first-run/)
gets you to a signed-in instance; [User guide →](guides/user-guide/) walks
through day-to-day use.

## Two ways to run it

The features are identical in both. Only who runs the server differs.

| | Self-hosted | My Nido |
| --- | --- | --- |
| Who runs the API and web | You | RunWhen |
| Where the data lives | Your hardware | Canada |
| Your account | Yours alone | Yours, in a shared Nido |
| Cost | Free | Free to use |

See [Self-hosting →](../self-host/) and [My Nido →](../my-nido/).

## People, not a single baby

Every record attaches to a **family member**, not to "the baby". Members have
a name, an avatar, a birth date, a member type (`child` or `adult`), an
optional email, and their own set of tracked categories.

That is the decision everything else rests on. A second child, a pet, an
elder, a housemate — each is a member with the same log, the same history,
and the same photos. Tracking a pet's daily log is not a workaround, it is
the same form.

Each member can be tracked separately, so one baby can be logged while a
sibling's categories stay quiet until you need them.

## Twelve kinds of record

These are the log categories. Your family can turn any of them off — see
[What your family tracks →](guides/user-guide/#what-your-family-tracks).

### Feeds

Breast, bottle, and formula, in one category, distinguished by type.

- A breast session can be **timed**, with the timer running in the drawer
  until you stop it.
- Bottle and formula entries take amount and unit.
- Left and right are tracked separately for breast sessions.
- Notes on any of them.

Breast sessions and pump sessions share the same underlying record, so a
pump is a feed you did yourself.

### Diapers

Type (`wet`, `dirty`, or `both`), optional **consistency** and **colour**,
and notes. Consistency and colour are the values your family uses — the
defaults cover the usual range and you can add your own in settings.

### Sleep

Start and end, or an ongoing session that is still running. Nido computes
duration and shows the gap since the last sleep, which is the number you
actually want at 3am.

### Growth

Weight, length, and head circumference, with a metric/imperial toggle. Age in
weeks is derived from the member's birth date — Nido does not store it twice.

### Pumping

Pump sessions as their own category, tracked per member, so pumping and
feeding history stay separable.

### Milestones, Firsts, Routines, and Medical

One form, four categories, because these are all dated events with a title
and notes. Firsts are the "rolled over at 4 months" moments, Routines are
recurring patterns, and Medical holds appointments and visits.

### Vaccines

Dated doses, so the record is there when a clinic asks what was given when.

### Moods

A pick from your family's mood values, plus a time and optional notes.

### Journal

Free-text entries with a timestamp. No structure imposed.

## Today

The Today view answers four questions without navigation:

- **Age** — in weeks, from birth date
- **Last feed** — how long ago, the clock time, the type, and who logged it
- **Last diaper** — same shape
- **Last sleep** — how long ago it started, and how long it lasted

"How long ago" is the headline because that is the question a "last seen" tile
is actually asked. The exact time sits underneath for when it matters. Every
tile is also a shortcut into the matching log form.

## Quick Actions

The things you log most often get their own tiles. You choose which — the
**Mobile quick links** setting pins any subset of the twelve categories to the
front of the screen.

Two escape hatches sit next to the pinned tiles:

- **Log activity** opens every category at once, including the ones turned
  off for this member.
- **Other** expands just the unpinned categories, so the pinned row stays
  short.

Once pinned, logging a feed or a diaper is two taps.

## Recent activity

Records are listed newest-first and can be **edited or deleted** from the
list — a mistimed feed at midnight gets corrected rather than deleted and
re-entered. Edits open in a dialog over the list.

## Photos

Photos attach to a record, not to the member. Upload from the strip on a
record; they load with a bounded fetch concurrency rather than one serial
request per image.

## Inventory

A stock list for the things a household actually runs out of — and, unlike a
shopping list, one that forecasts.

- Items carry a **category**, **quantity**, **unit**, an optional **variant**
  (a diaper size, a scent) and an optional **expiry date**. Categories are
  yours to define; `diapers` ships as the default.
- **Diaper stock counts itself.** A logged diaper change is one unit used, so
  the count follows the log rather than being a second thing to maintain.
- Items can also run on a **cadence** — eight a day — and deplete themselves
  between logs, so wipes and nappies fall without anyone recording them.
- Every item is **forecast**. Nido works out the recent rate of use and
  reports days of cover and when the next unit falls due.

### Rules that reason about time, not just counts

A rule compares a **signal** against a threshold. Nido ships six, and each
one is a different question:

| Signal | The question it answers |
| --- | --- |
| Days of cover left | How long is the current stock good for, at the rate you are using it? |
| Days until you run out | The same number, named for the consequence |
| Amount on hand | "Tell me when I am down to one left" |
| Days until this expires | Needs an expiry date; only reported while the date is still ahead |
| Days since you recorded using this | Nudges you when *you* have not logged usage |
| Days until this size is outgrown | When growth reaches the next size band |

The last one earns its place. Give each diaper size a **weight band** and Nido
fits a trend through your recorded weights — it needs at least two — then
projects the day the next size is needed, instead of telling you at 2am that
size 3 is gone.

The "days since you recorded using this" signal deliberately **ignores**
automated cadence rows, so it only rises when a person has not logged
anything. It is the signal for stock nobody records: "check the wipes".

Expired is also not "expiring soon". A past date stops raising the signal
rather than counting negative days forever.

## Notifications

Everything that needs your attention is on one page, in four parts.

### Needs attention now

Rules currently firing, whichever kind they came from.

### Tracking rules

Reminders scoped to a member or a home, in two kinds:

- **Inactivity** — nothing of a kind has been logged for N hours. The right
  tool for "no wet diaper in too long".
- **Interval** — something is due every N days, for a recurring task.

An interval reminder is a checklist item: mark it **done** to reset its
clock. Each shows when it was last satisfied, or "never done" if it never has
been.

### Email

Alerts can arrive as one email instead of being watched for in-app. **Send
digest now** runs it on demand and reports how many went out.

Automatic digests run on a server-wide interval — `NOTIFY_ENABLED` (on by
default) and `NOTIFY_INTERVAL_MINUTES`, which defaults to 60. It is an
instance-level timer that sweeps every family rather than a per-family cron,
so with more than one API replica it is switched on for one of them only.
When it is off, the page says so plainly instead of leaving you to wire up
your own scheduler. See [Configuration →](../reference/configuration/) and
[Architecture →](../reference/architecture/#notifications).

## Home

The same pattern, past the baby stage. A home tracks:

- **Homes** — the properties themselves
- **Property assets** — the things in them
- **Maintenance** — what was done, when
- **Manuals & routines** — the paper that used to live in a drawer

This is where "grows to cover the whole home" stops being a slogan: the
member-plus-record model is what makes it cheap to add.

## Reports

The Family page carries feed rollups for the last 24 hours and 30 days —
count, average size, and average length. Enough to answer "is this normal for
them this week" without building a report.

## Multi-caregiver, one record

Several people can log to the same family. Every record stores **who logged
it**, shown on the Today tiles, so attribution is visible without asking.

Invite by email, or add a member directly. Roles are `owner` and `admin`
alongside ordinary members; settings that affect everyone — which categories
are tracked, the value lists, and anonymized sharing — are owner/admin
changes.

## Bringing your history, and taking it with you

**Import** history from a **NaraBaby CSV export** under **Settings → Data**.

**Export** by downloading a backup — a file you can read without Nido
running, with no account and no Nido involvement.

Moving a whole instance to new hardware is a different job: it needs the
data volume **and** the master key together.
[Backup & restore →](guides/backup-and-restore/) covers both.

## What it deliberately does not do

- **No push notifications for every record.** Nido is a record, not an
  alarm clock. Reminders are opt-in and deliberately few.
- **No health advice.** Growth records are stored and charted; Nido does not
  interpret them.
- **No accounts-within-accounts, no social feed, no sharing by default.**
  People are added to your family deliberately.
- **No telemetry, and no analytics.** Nido does not phone home. The one
  opt-in that reads as outbound — *anonymized daily sharing* under
  **Settings → Household** — is currently a stored preference with a 24-hour
  totals preview, not a published feed, and only an owner or admin can set
  it. See [Security model →](../reference/security/).