---
title: User guide
description: Day-to-day use of Nido — signing in, logging, correcting mistakes, adding people, inventory, reminders, and settings.
---

This is the app walkthrough. [Features →](../features/) is what exists;
this is what you do with it. If you have not run Nido yet, start with
[Installation →](../getting-started/installation/) and
[First run →](../getting-started/first-run/).

## Signing in

Nido serves the app on port **3001**. Open it and sign in with email and
password.

- **Forgot password** sends a reset link to the address on the account.
- **Create an account** is on the sign-in screen while registration is
  enabled.
- An invited caregiver goes to the join link in their email instead of
  registering.

:::caution[Registration is open by default]
Anyone who can reach your instance can create an account until you turn
registration off. Do that in **Settings → Admin → Sign up** once your family
is in, or set `SIGNUP_ENABLED=false`, which is authoritative.
:::

## The five places

The app has five destinations, in the header on desktop and the bottom bar
on a phone: **Dashboard**, **Family**, **Home**, **Inventory**, and
**Notifications**. Settings is in the account menu in the header.

Everything on this page is reached from those, plus the log forms.

## Logging the everyday things

Tap a tile in **Quick Actions** and the matching form slides up from the
bottom. The form differs per category; the shape is the same — a type, a
date and time defaulting to now, and optional notes.

### Feeds

Pick **breast**, **bottle**, or **formula**.

- A **breast** session has a timer. Start it, do the other thing, come back
  and stop it. Side is tracked per breast.
- A **bottle** or **formula** takes an amount and unit.

A feed logged while you are offline is held on the device and sent when the
app next talks to the server. See [Working offline →](#working-offline).

### Diapers

Choose **wet**, **dirty**, or **both**, then optionally a consistency, a
colour, and notes. Consistency and colour are your family's own value lists —
set them once in settings and the forms just offer them.

### Sleep

Set a start and an end, or start a session and end it later. The Today tile
shows how long ago the last sleep started and how long it lasted.

### Growth

Weight, length, and head circumference, with a metric/imperial switch on the
form. Age in weeks comes from the member's birth date.

### Pumping

A pump session, logged against whoever pumped.

### Milestones, Firsts, Routines, Medical

One form: a title, a date, and notes. Routines are recurring patterns,
Firsts are one-off moments, Medical is appointments and visits.

### Vaccines, Moods, Journal

A dose with a date; a mood from your value list; a free-text entry.

## Finding the category you need

The pinned tiles are yours to choose (**Settings → Mobile quick links**).
Two controls cover the rest:

- **Log activity** opens every category at once.
- **Other** expands only the categories you have not pinned.

So a household that logs six things constantly pins those six and leaves
**Other** for the rest.

## Correcting a mistake

Recent activity is listed newest-first, and every record can be **edited** or
**deleted** from the list.

Edit rather than delete-and-retype whenever the record was right and the
time was not — a feed logged at 11pm that happened at 10pm is an edit, and
the record still counts once.

## Adding people

**Family** is where members live.

- **Add a family member** takes a name, birth date, and member type —
  `child` or `adult`. Email and avatar are optional. Each gets their own
  avatar and their own tracked categories.
- **Invite someone** emails a join link. Invitees see their own set of
  members and can log to any member in the family.
- Members can be edited and removed from the list.

Every record stores who logged it, and the Today tiles show that name — so
"who did the 3am feed" is visible in the log itself.

## Who can change what

Settings are split by who they affect:

- **Any member** can change what the family tracks and the value lists in
  the log forms, and their own mobile quick links.
- **Owners and admins** can invite people, change the anonymized sharing
  opt-in, and reach the admin panel.

## What your family tracks

Under **Settings → Household**, toggles turn categories on and off. A
category switched off disappears from the log forms for **every member** in
the family — useful for keeping a toddler's quiet months away from a
newborn's log without deleting anything.

Under **Choices when logging**, the values offered for each kind of record —
routine types, visit types, mood words, diaper consistency and colour. They
appear in the log forms for everyone, so agree on them before the first
2am diaper rather than during.

:::tip[Set these before you need them]
Both are family-wide, so any member can change what everyone else sees.
A quick conversation beats a surprise.
:::

## Inventory

**Inventory** is the household stock list — the things you run out of. It is
worth a little setup, because it forecasts rather than just counting.

### Adding stock

An item needs a **category**, a **quantity**, and a **unit**. Optionally it
carries a **variant** (a diaper size, a scent) and an **expiry date**.
`diapers` is the default category, and you can add your own under
**Inventory**.

### Two things that count themselves

- **Diaper stock follows the log.** A logged diaper change is one unit used,
  so you never adjust the count by hand.
- **Cadenced items deplete on their own.** Give an item a rate — eight a day
  — and it falls between logs, so wipes and nappies are tracked even when
  nobody records using them.

Every item then shows **days of cover** and when the next unit is due,
worked out from your recent rate of use.

### Rules

A rule compares a **signal** against a limit and raises an alert when it
crosses. Pick the signal that matches the question you are asking:

| If you want to know… | Use this signal |
| --- | --- |
| How long the stock lasts at this rate | Days of cover left |
| When it will be gone | Days until you run out |
| When you're nearly out, not nearly empty of days | Amount on hand |
| What is about to expire | Days until this expires |
| When you personally haven't logged usage | Days since you recorded using this |
| When the baby outgrows this size | Days until this size is outgrown |

Two are worth explaining. **Days since you recorded using this** ignores the
automatic cadence rows on purpose, so it only climbs when a person has not
logged anything — use it for stock nobody thinks to record. And **days until
this expires** only counts down while the date is still ahead, so an expired
item stops alerting instead of counting negative days.

### Predicting a size change

Set a **weight band** on each diaper size and Nido fits a trend through the
weights you have recorded — it needs at least two — then projects the day
the next size is needed. That is the difference between buying size 4 in
advance and discovering at 2am that there are none left.

## Notifications

**Notifications** is one page in four parts: what needs attention now,
tracking rules, inventory rules, and email.

### Needs attention now

Any rule currently firing. This is the page to check when something feels
off, and the first place to look when you think a record is missing.

### Tracking rules

Reminders, scoped to a member or a home:

- **Inactivity** — nothing of that kind logged for N hours. For "no wet
  diaper in too long", which is the question you actually have at 3am.
- **Interval** — something due every N days, for a recurring task.

Each shows when it was last satisfied, or "never done". Marking an interval
reminder **done** resets its clock.

### Email

Alerts can arrive as one email rather than being watched for. **Send digest
now** delivers it immediately and tells you how many went out.

Automatic digests are a server setting, not a per-family one — your operator
controls them. If they are off, this section says so rather than leaving you
guessing. Self-hosters: see
[Configuration →](../reference/configuration/).

## Home

**Home** carries the household half of Nido: the **homes** themselves, the
**property assets** in them, **maintenance** records, and **manuals &
routines**. It is the same member-and-record model as the baby log, which is
what makes adding it cheap.

## Working offline

Feed and sleep records — including pump sessions — are queued on the device
if the server is unreachable, up to the most recent 200, and sent when
connectivity returns. The queue drains when you next open the **Dashboard**
or **Family** page, and tells you how many records synced.

:::note[Not every category queues]
Only feeds, pumps, and sleep are held offline. A diaper logged with no
connection fails rather than waiting, so enter it again once you are back.
:::

## Settings

**Settings** is grouped four ways:

- **Account** — profile, change password, delete account.
- **Household** — family and tracking: categories, value lists, anonymized
  sharing, invitations, people, mobile quick links.
- **Data** — import history, download a backup, restore from one.
- **Admin** — registration toggle and SMTP, for the platform admin.

### Theme

Nido ships light and dark variants of **Forest**, **Sage**, **Slate**,
**Espresso**, **Terracotta**, **Ocean**, and **Blush**. The picker sits in
the header, and your choice is applied before the page renders — so there is
no flash of the default palette on load.

## Bringing your history with you

Under **Data**, Nido imports a **NaraBaby CSV export**, and restores from a
backup file or a restore point.

For a complete copy of your own data, download the backup. It is a file you
can read without Nido running.

To move a whole instance to new hardware, that is
[Backup & restore →](backup-and-restore/) — the data volume **and** the
master key, kept together.

## Getting help

Something wrong, or a question the docs do not answer?
[Support Nido →](../support/) lists the repository and the sponsorship
options, and an issue on the tracker is the fastest route to a fix.