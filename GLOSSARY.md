# Nido

A self-hosted family/care tracker: one encrypted database per family, recording
care events, growth, inventory consumption, and reminders for each member
(child or pet).

## Language

### People & scope

**Family**:
The tenant. One family = one encrypted database file, plus a routing row in the
instance registry. Everything else in the system is scoped to a family.
_Avoid_: household (legacy in-DB table name for the same thing), account,
workspace
_Note_: inside a family DB, `family_id` columns reference the legacy
`households(id)` table — a rename migration, not a second concept.

**Subject**:
A person or pet tracked within a family — what care events attach to. The
canonical term in code and schema (`subject_id` everywhere; the old `babies`
tables were renamed by migration).
_Avoid_: baby, child, member, person
_Note_: "member" collides with the `member` role — do not use it for the
tracked person in code; UI copy may still say "member" where friendlier.

**member type**:
The kind of subject: `child`, `pet`, `adult`. (Legacy name kept for the
`family_members` table; migrate to "subject type" alongside it.)
_Avoid_: kind, role

**Stage**:
The life-stage template a subject starts from (`infant`/`child`/`adult`/`pet`),
which determines their initial categories.
_Avoid_: phase, profile template

**Role**:
A user's permission level within a family: `owner`, `admin`, `member`.
_Avoid_: member type

**User**:
A login identity (email + password). A user belongs to a family via a role; a
user is not the same thing as a member.
_Avoid_: account, member

**Invitation**:
A pending offer for an email to join a family as a user.
_Avoid_: invite code

**Home**:
A residence an inventory belongs to. Members can be linked to homes.
_Avoid_: house, location

### Records

**Event**:
A unified record of something that happened: one typed row (feeding, diaper
change, sleep session, growth measurement…) with a category, timestamp, and
typed data. The core noun of the system.
_Avoid_: activity, log entry, record
_Note_: "event" here is the care-event envelope, NOT a consumption ledger row
(see: consumption) — do not reuse the word for both.

**Plan**:
A booking for something that will happen — the future tense of an event, with
status `planned`/`fulfilled`/`missed`/`cancelled`.
_Avoid_: upcoming, appointment (appointments are one bookable category, not
the general concept)

**Category**:
The vocabulary id that discriminates what an event is (`feeds`, `diapers`,
`sleep`, `growth`, `vaccines`, …). Defined once in the category registry
(`api/src/registry.ts`, slated for rename to `category-registry`).
_Avoid_: kind, type, registry
_Note_: "registry" unqualified means the instance registry DB
(`registry.db`); the code module is the **category registry**.

**custom option**:
A family-defined choice value within a category (e.g. custom feeding types).
_Avoid_: category options, custom field

**Overdue**:
A plan whose time has passed while still `planned`. A first-class state that
prompts "did it happen?".
_Avoid_: late, missed (missed is a resolution, not the state)

**Consumption**:
A ledger row recording that event(s) used up inventory stock. Distinct from a
care event.
_Avoid_: consumption event, usage event

### Record types (per category)

**Feeding**:
An event of category `feeds`: breast, formula, bottle, solid, or expressed
(pumping), with amount, side, and duration.
_Avoid_: feed (noun), bottle, meal

**Diaper change**:
An event of category `diapers`, with type, color, and consistency.
_Avoid_: change, diaper (alone)

**Sleep session**:
An event of category `sleep` with start/end and location.
_Avoid_: nap, night

**Growth measurement**:
An event of category `growth`: weight, height, head circumference, compared to
WHO/CDC percentile standards. Stores what was typed plus `unit_system`
(`imperial` default; `metric`), converted to metric only for percentile math.
_Avoid_: measurement, checkup

**Vaccination**:
An event of category `vaccines`, with dose date and next-due scheduling.
_Avoid_: vaccine (as a record), shot

**Milestone** (narrow sense):
An event of category `milestones`/`firsts` — a developmental first (smile,
roll over, words).
_Avoid_: milestone (as a catch-all record of any kind) — the legacy
catch-all table is deprecated in favor of events + plans.

**Journal entry**:
A free-form daily note (`title` + `body`), category `journal`.
_Avoid_: note, diary

### Inventory

**Item**:
A stockable or asset-trackable thing a family owns (formula, diapers, wipes;
or an asset with warranty/service intervals).
_Avoid_: inventory item, product

**Consumption rule**:
A rule that bills stock from an item when events of a source category match
its conditions ("each feeding uses 2 oz of formula").
_Avoid_: usage rule

**Adjustment**:
A manual correction to item stock.
_Avoid_: correction, manual count

**Days of cover**:
The forecast of how long current item stock lasts at the recent usage rate.
_Avoid_: runout, runway

### Notifications

**Reminder**:
A rule that pokes users about an inactivity or interval condition ("no
feeding in 3 hours", "medication every 8h").
_Avoid_: alert, notification

**Low-stock signal**:
An inventory rule threshold (item falls below X units) that can notify
recipients.
_Avoid_: alert, reminder

**Digest**:
The scheduled email summarizing due reminders/signals for a family, in their
timezone. Hourly, daily, or weekly.
_Avoid_: notification, newsletter

### Client & system

**Attachment**:
A stored blob (photo, file) attached to an event or plan. Encrypted, capped.
_Avoid_: upload, file

**Outbox**:
The client-side queue of unsaved records (offline writes), flushed on
reconnect.
_Avoid_: offline queue, pending records

**Theme**:
One of the palette presets (7 palettes × light/dark) or a custom palette,
expressed as CSS variables. Semantic Tailwind classes (`bg-surface`,
`text-ink`) are the only sanctioned way to reference them.
_Avoid_: palette (that's one axis of a theme), skin

**Quick action**:
A per-subject pinned shortcut for logging a common event.
_Avoid_: quick link, shortcut

**Import**:
Bringing external data (Baby Nara, CSV) into a family, with dedup by activity
key.
_Avoid_: migration, sync

## Resolved decisions

_Picked by code review 2026-10 — schema voted on most of these._

- **subject, not member/baby**: every FK is `subject_id`; `babies` was renamed
  by migration; "member" collides with the `member` role. UI copy may keep
  "member" for friendliness; code and schema use subject.
- **family, not household**: `households` is the legacy tenant table inside the
  family DB (family DB `family_id` columns reference `households(id)`); rename
  migration is cleanup, not a new concept.
- **registry**: unqualified = instance DB (`registry.db`). The code module
  `api/src/registry.ts` is the **category registry** — rename it so "registry"
  means one thing.
- **growth units**: store typed values + `unit_system`, imperial default;
  convert to metric only for percentile math (`toMetric`).
- **db file seams** (refactor/split-db-namespaces): `api/src/migrations.ts` is
  the versioned DDL history of both databases (registry + family); the runtime
  lifecycle (clients, cache, provisioning, teardown) is
  `api/src/namespaces.ts`. `db-namespaces.ts` is gone — don't recreate it.