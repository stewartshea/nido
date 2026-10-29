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
A stockable thing a family owns and consumes (formula, diapers, wipes).
_Avoid_: inventory item, product, asset (see: home asset — assets are not
stock and live in their own table)

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

### Home assets (HOME modules)

**Home asset**:
A durable thing a family owns that needs care (car, furnace, the house
itself): a first-class `home_assets` row with a controlled-vocabulary
category (`vehicle`, `appliance`, `hvac`, `structure`, `outdoor`, `other`),
an optional identity quartet (manufacturer/model/model_year/serial), and
archivability. Assets are NOT inventory items — the two meet by reference
(`consumed_items` on a maintenance entry). The house is an asset with
category `structure`.
_Avoid_: asset (unqualified), home ("home" means the residence), inventory
item, equipment

**Meter**:
A monotonic counter attached to an asset: `distance` (odometer, km), `time`
(run-hours), or `count` (cycles). Latest reading wins; readings are sparse
and interpolated between.
_Avoid_: odometer (that is one meter), tracker, usage log

**Reading**:
One confirmed value of a meter at a point in time. Reminders evaluate
against a linear estimate between readings; a confirmed reading always
overrides the estimate.
_Avoid_: entry (that is maintenance), measurement

**Maintenance entry**:
The unit of care: one thing done to one asset, once — with cost, optional
provider, consumed inventory lines, and attachments. Ad-hoc work has no
schedule item.
_Avoid_: service record, log entry, event (an event is the care-event
envelope)

**Schedule item**:
One recurring care obligation on one asset, with a list of trigger
conditions and a match rule (`any` = whichever fires first; the oil-change
case "every 8,000 km or 6 months" is one schedule item, not two).
_Avoid_: reminder (that is the general rule concept), recurring task, cron

**Seasonal window**:
A trigger condition that recurs every year without a year anchor
(start_month_day – end_month_day). Overdue means past window close and
unsatisfied.
_Avoid_: season, annual reminder

**Checklist instance**:
Derived state, materialized at read time: schedule items in an active
window render as cards, and a card checks off iff a qualifying maintenance
entry exists in that window (or an explicit "not this season" skip with a
reason). Never stored, never "checked off" without a backing record.
_Avoid_: checklist, todo list

**Provider**:
A person or business in a family's address book who performs maintenance.
Selectable on an entry, clickable on a phone. A family member who does the
work is recorded as no-provider plus notes.
_Avoid_: vendor (a vendor field is a name on a bill), contact, mechanic

**Manual**:
The operating document for an asset, in one of two forms behind one Manuals
section: a **manual file** (encrypted attachment referenced to the asset) or
a **manual link** (`manual_url` — Nido does not hold the bytes).
_Avoid_: documentation (that is the docs site), guide, attachment (an
attachment is the general blob)

## Notifications

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
- **home asset, not inventory item** (2026-10): assets are not stock — no
  count to deplete, no consumption rules. First-class `home_assets` table;
  inventory stays consumables. They meet by reference: `consumed_items` on a
  maintenance entry. "Home" keeps meaning the residence; the modules are the
  HOME modules, the entity is a home asset.
- **meters interpolate** (2026-10): sparse readings + a linear estimate
  evaluate triggers; a confirmed reading always overrides. No automatic
  imports.
- **checklists are derived** (2026-10): a checklist instance is read-time
  state from schedule items + entries. Nothing is checked off without a
  backing maintenance record.
- **suggest, never assert** (2026-10): templates propose schedule items
  unchecked; Nido never silently writes a schedule the user did not confirm.
- **OCR is text only** (2026-10): best-effort extraction stored as searchable
  text beside the scan; no structured field extraction into data.
- **db file seams** (refactor/split-db-namespaces): `api/src/migrations.ts` is
  the versioned DDL history of both databases (registry + family); the runtime
  lifecycle (clients, cache, provisioning, teardown) is
  `api/src/namespaces.ts`. `db-namespaces.ts` is gone — don't recreate it.