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

**Inventory** is the household stock list — the things you run out of.

- Add an item with a **category**, **quantity**, **unit**, and optional
  **expiry date**. `diapers` is the default category; add your own.
- **Diaper stock counts itself.** A logged diaper change is one unit used,
  so the diaper count follows the log.
- **Rules** flag an item at or under a limit — or over one — and the
  Notifications page tells you.

## Reminders

**Notifications** holds two kinds of reminder, each scoped to a member or a
home:

- **Inactivity** — nothing of a kind logged for N hours. For "no wet diaper
  in too long", which is the question you actually have at 3am.
- **Interval** — something due every N days, for a recurring task.

Each shows when it was last satisfied, or "never done". Marking an interval
reminder **done** resets its clock.

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