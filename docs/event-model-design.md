# The Event Model — Design

What a family records becomes one stream of typed events, and the catch-all
stops existing.

**Status.** Proposal, responding to two rounds of review on PR #42: the
`milestones` table is the wrong table — it is a catch-all that only fits three
of the eight kinds stored in it, and every layer built on top of it
(inventory, reminders, upcoming, the summary tiles) has had to special-case
it. This document designs the replacement for the whole event layer, sized
for the near-term goals: many types of tracked things, inventory decrement,
event-driven notifications, and the home module (assets, maintenance, seasonal
upkeep).

It supersedes the "Phase 3" sketch in `inventory-consumption-design.md` §4.1,
which proposed an `activity_events` shadow table fed by routes. That sketch
kept the catch-all and added a second copy of every record; this one removes
the catch-alls instead.

§4 walks the model end to end through four user journeys — an infant, a dog,
an adult, and a home asset — including the inventory decrement and the
notification paths, so the data flow can be read against the schema.

---

## 1. The problem, in bugs it has already caused

The model is not hypothetical; it has been generating defects:

| Bug | Cause in the model |
| --- | --- |
| Jennifer's vitamins appeared as routines | Migration 10 reclassified rows with `UPDATE milestones SET kind='routines' WHERE category IN ('vitamin', …)` — one table storing eight kinds cannot distinguish them structurally, so a migration guessed, and guessed wrong for existing data |
| The inventory picker offered "Milestone" but not "Vitamins" | The picker derived one entry per *table*; eight kinds share one table, so seven vanished and `presetConditions` had to be invented to smuggle the kind back in |
| A category's option list went missing four times | `CATEGORY_OPTIONS`, `MILESTONE_KINDS`, the log forms, and the web's generated copy were hand-kept lists that each had to learn every new category |
| The consumption wiring drifted (`WIRED_TABLES`) | Each route had to remember to call `emitActivity`, and a parallel whitelist had to remember to offer it — two lists, both hand-kept |
| "Upcoming" only sees milestone-backed kinds | `appointments.ts` reads "any future-dated milestone row"; a future-dated *vaccination* or anything typed cannot surface there without another special case |
| The summary route is a wall of per-table queries | `health.ts` runs one hand-written query per table per tile; `latestByKind` for the eight milestone kinds is a window-function query over the shared table, and feeds/diapers/sleep each need their own |

The pattern behind every row: **the coding layer keeps re-deriving what the
data model refused to say.** Every consumer — summary, upcoming, activity
history, attachments, consumption, reminders, export — reimplements "all the
things that happened" as a union over typed tables plus a switch over
`kind`.

## 2. The future that forces the decision

The home module is next: property assets, maintenance events, seasonal
upkeep, appliance manuals. On the current model each new domain costs a table,
a route, a registry entry, a log form, a conformance fixture, and one more
branch in every union. Tracked *things* also stop being only people and pets:
a furnace is something you log maintenance against and a filter is something
that maintenance decrements — the same relationship vitamins have to a vitamin
bottle in the cupboard, which inventory consumption already models.

Two moves generalize all of it at once:

1. **One event stream** — every "thing that happened" is a row in one table,
   discriminated by a category the vocabulary already knows, with a typed
   document for the fields specific to it.
2. **One tracked-thing table** — `inventory_items` generalizes to *items*
   with a `kind` (stock, asset), because "how many left" and "when was it
   last serviced" are the same shape of question about a consumable and an
   appliance.

Everything downstream — stage templates, quick links, reminders, consumption
rules, alerts, digests, upcoming — already wants to speak in categories. The
model should too.

## 3. The target model

### 3.1 `events` — one envelope

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  INTEGER REFERENCES subjects(id),   -- who it happened to (person, pet)
  item_id     REFERENCES items(id),              -- what it happened to (item, asset)
  category    TEXT NOT NULL,                     -- vocabulary id: 'feeds', 'vitamins', 'maintenance'
  occurred_at TEXT NOT NULL,                     -- ISO instant; a future value is "upcoming"
  title       TEXT,                               -- the named thing: 'Vitamin D', 'Rabies booster'
  notes       TEXT,
  data        TEXT NOT NULL DEFAULT '{}',         -- typed document, shape per category (§3.2)
  tags        TEXT,
  created_by  TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK (subject_id IS NOT NULL OR item_id IS NOT NULL)
);
CREATE INDEX idx_events_subject_time ON events(subject_id, occurred_at);
CREATE INDEX idx_events_category      ON events(category, occurred_at);
```

- **`category` is the only discriminator.** `kind` dies. A vitamin row *is*
  category `vitamins`; no migration can ever reclassify it, because there is
  nowhere else for it to be.
- **`occurred_at` is one column, and it is always in the past at write time.**
  An event is a thing that happened; the future is expressed by a *plan*, not
  by a future-dated event (§3.6). Upcoming therefore reads plans — it works
  for every bookable category, and no consumer has to filter the future back
  out of the past.
- **`subject_id` XOR `item_id`.** The CHECK is deliberate: two nullable
  foreign keys that might both be set is exactly the "two ids that only
  sometimes coincide" trap the `babies`→`subjects` rename avoided. An event is
  about a person or about a thing, never both.
- `title`/`notes`/`tags` are envelope-level because every category has them
  and three consumers already read them generically (activity history,
  upcoming list, anonymized digest).

### 3.2 The registry — one entry per category, in code

The registry is code, not a table, for the same reason `vocabulary.ts` is:
one deployable, one family DB per file — a registry *row* would need a
migration fanned out to every family DB to add a category. A registry *module*
needs a deploy, which is happening anyway.

```ts
// src/registry.ts — vocabulary.ts and reminder-conditions.ts merge into this
export const CATEGORIES = {
  vitamins: {
    label: 'Vitamins',
    storage: 'events',                       // §3.4: 'events' | { table: 'feedings' }
    time: 'occurred_at',
    schema: z.object({                       // validated at the edge; the DB cannot
      type: z.enum(['dose', 'refill', 'missed', 'other']),
      amount: z.number().optional(),
      unit: z.string().optional(),
    }),
    fields: [                                 // what the web form renders, from one place
      { key: 'type', kind: 'enum', options: [...] },
      { key: 'amount', kind: 'number' },
    ],
    customOptions: 'type',                   // family's own values merge here, as today
    consumable: true,                        // inventory can be linked to it
    tense: ['record', 'book'],               // §3.6: log it, and schedule it
  },
  feeds: {
    storage: { table: 'feedings' },          // stays typed in Phase 1 — see §5
    time: 'start_time',
    schema: z.object({ type: z.enum([…]), amount: z.number().optional(), … }),
    consumable: true,
    …
  },
  // maintenance (home module): storage 'events', item-targeted, consumable: true
  // — a furnace service decrements the filter stock without a new table
};
```

One entry now drives: the log forms (`fields` — killing the hand-kept form
lists and the `MILESTONE_KINDS`/`TITLED_BY_CATEGORY` switches), the stage
templates (`STAGE_CATEGORIES` survives unchanged — it is about which
categories a profile starts with, orthogonal to storage), the reminders
catalog, the inventory activity picker (`consumable` entries, one per
category — the `presetConditions` hack is deleted, not ported), the log
form's schedule option (`tense` entries, §3.6), and export. `CATEGORY_OPTIONS`
and `CATEGORY_OPTION_KEY` dissolve into `fields` + `customOptions`.

### 3.3 `items` — stock and assets, one table

`inventory_items` becomes `items` with a `kind`:

```sql
ALTER TABLE inventory_items RENAME TO items;
ALTER TABLE items ADD COLUMN kind TEXT NOT NULL DEFAULT 'stock';
-- 'stock': quantity, unit, pack_size, lead_days — everything consumption uses
-- 'asset': data holds warranty_until, manual (attachments ref), service_interval_days
ALTER TABLE items ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
```

An appliance is an asset item: it can be the target of maintenance events, it
can carry attachments (manuals), and its "next service due" is a condition
over its own fields — the same alert machinery that already watches low
stock. Nothing about the consumption path changes: a rule already joins
"events of category X" to "item Y"; after the home module lands, "1 filter
per 2 furnace services" is category `maintenance` against item `Furnace
filter`, configured exactly like "1 tablet per 4 bottle feeds".

### 3.4 Detail tables — the promotion rule

Not every field belongs in `data` forever. The rule, stated once and applied
mechanically:

> A field is promoted out of `data` into a column — or a detail table keyed by
> `event_id` — when something must aggregate over it: trends, forecasts,
> grouping math, or a constraint the database should enforce.

`feeds` keeps `amount`/`duration` as real columns because feed grouping and
the feeds-per-day rate are real arithmetic over them. `growth` keeps weight
and height because percentile curves are. Everything title-date-option shaped
— routines, firsts, milestones, medical, medication, vitamins, appointments,
grooming, journal, moods — lives in `data`, promoted only when a report asks.

The registry's `storage` says where a category's rows live, so no consumer
ever guesses: `'events'` reads the envelope, `{ table: 'feedings' }` reads
the typed table through the same attribute names. That indirection is what
makes the migration below staged instead of big-bang.

### 3.5 One condition language, already half-built

Reminders and consumption rules already store condition documents validated
against the registry; this design finishes the sentence by removing the
table-vs-kind split that made milestones special:

- `inventory_consumption_rules.source_table` → `source_category`
  (`'milestones'` + `{kind: 'vitamins'}` becomes just `'vitamins'`).
- `reminders.conditions[].category` already speaks category ids — unchanged.
- `inventory_rules` (low-stock alerts) keeps watching item fields, and gains
  the same validator for free when the home module adds asset conditions.

One evaluator, three rule kinds: **reminder** (inactivity), **consumption**
(event decrements an item), **alert** (an item crosses a threshold —
`inventory_rules` already stores exactly this: signal, comparator,
threshold).

Rules also inherit the events' target XOR (§3.1): a rule watches one subject,
one item, or the whole household. `inventory_consumption_rules` gains the
same `subject_id`/`item_id` pair events carry, and `reminders` already has a
generic `target_type`/`target_id` to say it with. This is what lets "1 filter
per 2 furnace services" scope to the furnace without a second rule engine —
and it is the one amendment the journeys in §4 exposed; everything else in
this section stood as designed.

### 3.6 Records and plans — two tenses, two tables

An event is a thing that happened. A plan is a thing that is going to. The
current model stores both in one column: a future `achieved_date` means
"scheduled", a past one means "happened", and every consumer has to tell them
apart by comparing against now. The symptoms are already on the books:

- the summary tiles had to learn to exclude future rows (PR #36) because a
  booked appointment was sorting as the "last medical entry" — a filter
  convention standing in for an invariant;
- "upcoming" is built on the pun (PR #34: *any* future-dated activity) rather
  than on a thing that is actually a booking;
- nothing stops a feed or a pump being logged into the future —
  `z.string().datetime()` checks the shape of the timestamp, not its tense —
  so nonsense rows sit at the top of every newest-first list;
- and one column cannot hold both the scheduled time and the time something
  actually happened, so correcting an appointment to reality erases what it
  was booked for.

One column meaning two things is the same disease as one table meaning eight
kinds, and the cure is the same: make the distinction structural.

```sql
CREATE TABLE plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id      INTEGER REFERENCES subjects(id),  -- the same XOR as events
  item_id         REFERENCES items(id),
  category        TEXT NOT NULL,                     -- the same vocabulary ids
  scheduled_at    TEXT NOT NULL,                     -- what it is booked for
  title           TEXT,
  notes           TEXT,
  data            TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'planned',   -- planned | fulfilled | missed | cancelled
  fulfilled_by    INTEGER REFERENCES events(id),     -- the event that happened
  origin_event_id INTEGER REFERENCES events(id),     -- e.g. the dose that scheduled the next
  created_by      TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,    -- when it was booked —
  CHECK (subject_id IS NOT NULL OR item_id IS NOT NULL) -- deliberately a second
);                                                       -- time column, not a default
CREATE INDEX idx_plans_due ON plans(status, scheduled_at);
```

The invariants this states, none of which the one-column model can:

- **`events.occurred_at` is always past at write time.** The registry's zod
  refuses a future timestamp for record categories, so a feed cannot be
  future-logged — not filtered out later, refused at the edge (with a small
  skew tolerance, so clock drift does not turn into rejections). Newest-first
  is then correct everywhere by construction, not by remembered filters.
- **Booked-at and booked-for are separate facts.** `created_at` is when the
  record was made; `scheduled_at` is the appointment. Book today for March,
  reschedule twice — neither fact destroys the other.
- **Scheduled ≠ actual is representable.** The plan was for 09:00; the event
  that fulfils it happened at 09:20. `fulfilled_by` links them, and both
  times survive.
- **Overdue is a first-class state** — `status = 'planned'` with
  `scheduled_at` in the past — which today is invisible: a future-dated row
  silently becomes a past row and drifts into the "last" tiles.
- **Upcoming reads one thing**: plans with `status = 'planned'`, ordered by
  `scheduled_at`. No `WHERE date >= now` scattered across categories;
  fulfilling or cancelling removes the row from the list by changing status.

A category declares which tenses make sense of it:

```ts
feeds:        { tense: ['record'] }            // log only; the future is refused
appointments: { tense: ['record', 'book'] }    // log the visit, or book it
maintenance:  { tense: ['record', 'book'] }
```

Booking is the same gesture with a different verb: the log sheet offers
"schedule" for `book`-capable categories, the row lands in `plans`, and on
the day "mark done" writes the event and links it. Fulfilment runs the
ordinary path — the new event bills stock, resets reminder clocks, feeds the
tiles — because plans never touch rules; only the events their fulfilment
creates do. A vaccination logged with a `nextDue` creates the plan for the
next dose (`origin_event_id` pointing back), which is what lets `nextDue`
stop being a promoted field: upcoming no longer reads it, §3.4's promotion
rule no longer applies, and the field goes back to being data.

**Confirmation — a plan is a question, not just a row.** A booking is a claim
about the future, and the future is under no obligation to comply. The plan
is answerable from the moment it is booked (a furnace serviced a day early
is fulfilled early, with the real `occurred_at`), and once `scheduled_at` has
passed while `status` is still `planned`, it becomes a *prompt*: the
upcoming list shows it as overdue and the badge asks one question — did it
happen? The notification surface reads plans directly — a query, not a rule,
because every overdue plan is worth asking about; that is an invariant, not a
condition — and the question clears only by being answered:

- **done** — opens the ordinary log form pre-filled from the plan (category,
  subject or item, `data`), `occurred_at` defaulting to `scheduled_at` and
  editable. Saving writes the event, sets `fulfilled_by`, and the ordinary
  path runs: stock bills, reminder clocks reset, tiles update. Confirming a
  booked vitamin dose is what takes the bottle down — the prompt is where
  record and plan finally meet.
- **reschedule** — a new `scheduled_at`, still `planned`; the question comes
  back on the new day.
- **missed** — it did not happen and will not. No event, no billing; the
  status *is* the fact, and a reportable one ("two missed doses this
  quarter") in a way a deleted or edited row never was. The `missed` option
  some categories offer as an event *type* stays for an ad-hoc miss nobody
  booked — two gestures, two representations, not one fact in two places.
- **cancel** — it is no longer expected at all; it leaves upcoming and keeps
  its history.

Fulfilment is never inferred. An unlinked event logged near a plan does not
quietly mark it done — the link is made by the person who knows whether the
garage actually came, either from the plan row or the pre-filled form.
Whether the log sheet should *suggest* the link when a fresh event matches an
open plan is §9; the first release asks instead of guesses.

## 4. The same journey, four times

The model's claim is that every tracked thing gets the same shape. Here is
that shape, walked end to end four ways: an infant, a dog, an adult, and a
car. Every journey is the identical pipeline — an action writes an event,
rules evaluate against the registry, surfaces update — and the only
differences are *data*: which categories, which fields, which items.

### 4.1 A baby: Nia, five months

**Setup.** Nia is added as `type: child, stage: infant`, so she starts with
the infant template's ten categories and her Quick Actions are pinned per
member. Stock on the shelf, already linked:

```jsonc
// items
{ name: 'Wipes tub',       kind: 'stock', quantity: 512, unit: 'count' }
{ name: 'Formula serving', kind: 'stock', quantity: 24,  unit: 'count' }
// inventory_consumption_rules
{ source_category: 'diapers', conditions: [], amount_per_use: 3 } // 3 per change
{ source_category: 'feeds',   conditions: [{ attr: 'type', values: ['bottle'] }], amount_per_use: 1 }
```

**A change and a feed.** Her parent logs a wet nappy and, twenty minutes
later, a 150 ml bottle. Two events, two documents:

```jsonc
{ category: 'diapers', subject_id: Nia, occurred_at: '…T14:10', data: { type: 'wet', consistency: 'soft' } }
{ category: 'feeds',   subject_id: Nia, occurred_at: '…T14:32', data: { type: 'bottle', amount: 150, unit: 'ml', duration: 22 } }
```

The diapers rule has no conditions, so the change bills it: the tub goes
512 → 509 and one `used` row lands in the ledger. The feed's rule matches
`type = bottle`, so a serving comes off the tin. (Phase 1 keeps feeds and
diapers behind their typed tables — the registry says where they live, and
neither the app nor the rules know or care which.)

**What fires next.**

- *Reminder.* The family's "no feed or pump in 3 hours" rule (conditions over
  `feeds` and `pumping`, `match: any`) reads Nia's newest matching event,
  finds 14:32, and is satisfied. At 17:32 it is overdue: the in-app badge
  shows one, and the digest email carries it — daily at 09:00 on the family's
  own clock, because timezone and send-hour are family settings that already
  exist. Logging the next feed clears it.
- *Upcoming.* The six-month checkup is *booked*, not future-logged:
  `{ category: 'medical', scheduled_at: '…12-14T09:00', data: { visitType: 'wellness' } }`
  lands in `plans` (§3.6), appears on the upcoming page and in the
  Monday-morning weekly email, and on the day "mark done" writes the medical
  event at 09:20 — the schedule and the actual time both kept, linked by
  `fulfilled_by`.
- *Reports.* The bottle merges with the breast feed forty minutes earlier into
  one feed for the rate (the grouping window), the "Last feed" tile reads
  14:32, and the wipes item now has real usage, so days-of-cover switches
  from "no usage recorded yet" to a number.

### 4.2 A dog: Maple

**Setup.** `type: pet` implies the pet stage: grooming and medication in,
nappies out. Stock: `Flea treatment ×3`, rule
`{ source_category: 'medication', conditions: [{ attr: 'type', values: ['dose'] }] }`.

**A dose and a trim.**

```jsonc
{ category: 'medication', subject_id: Maple, title: 'Flea treatment', data: { type: 'dose' } }
{ category: 'grooming',  subject_id: Maple, title: 'Nail trim',      data: { type: 'trim' } }
```

The dose bills the pack 3 → 2. Neither event is special: the same
`POST /events` call with a different category, validated by a different zod,
rendered by a different form descriptor — all projected from Maple's
registry entries.

**What fires next.** The low-stock rule on the pack (`quantity ≤ 1`) becomes
a notification and a line in the inventory email. The "grooming every 21
days" reminder starts its clock from the trim. And her rabies booster —
`{ category: 'vaccines', data: { route: 'subcutaneous', nextDue: '2027-10-01' } }`
— schedules the next dose as a plan (`origin_event_id` pointing back at the
dose that scheduled it), so the booster surfaces on upcoming fourteen months
out and `nextDue` stays plain data (§3.6).

### 4.3 An adult: Jennifer

**Setup.** Adult stage: medication, vitamins, appointments, medical,
vaccines, growth, routines, moods, journal. The stage editor sets what *new*
adults start with; Jennifer's own list is hers (the per-member Tracks).

**The original bug, now impossible.** She logs her vitamin:

```jsonc
{ category: 'vitamins', subject_id: Jennifer, title: 'Vitamin D', data: { type: 'dose', amount: 1000, unit: 'IU' } }
```

There is no `kind` column anywhere to misread, and no migration that can
reclassify this row as a routine: the category *is* the row. The
`Vitamin D ×90` rule takes it to 89, her daily-vitamins reminder resets, and
when the bottle crosses 20 the low-stock alert fires with a forecast built
from *her* rate — the same three rule kinds as Nia's wipes, different data.

### 4.4 A home asset: the Subaru, and the furnace

**Setup.** The home module's entities are items, not new tables:

```jsonc
{ name: '2022 Subaru',   kind: 'asset', data: { model: 'Outback', warranty_until: '2028-06-30' } }
{ name: 'Furnace',       kind: 'asset', data: { installed: '2021-10', filter_size: '16x25x1' } }
{ name: 'Furnace filters', kind: 'stock', quantity: 2 }
```

**A service.**

```jsonc
{ category: 'maintenance', item_id: Furnace, title: 'Annual service', data: { type: 'service' } }
```

The filters rule —
`{ source_category: 'maintenance', conditions: [{ attr: 'type', values: ['service'] }], units_per_use: 2, amount_per_use: 1 }`
— carries: the first service changes nothing, the second takes one filter.
The rule is scoped to the furnace the same way Nia's formula rule is scoped
to her, through the XOR in §3.5.

**What fires next.** The Subaru's `warranty_until` is an item-field alert
("within 60 days") — the low-stock engine watching a date instead of a
quantity. The "car maintenance every 180 days" reminder is the inactivity
rule again, scoped to the car item; the winter-tires swap is *booked* as a
maintenance plan (§3.6) and lands on the upcoming page like a dentist
appointment, then becomes an event when it is marked done. Seasonal-upkeep
templates, when the home module ships, are pre-seeded rows in the same three
rule tables — plus, for a booked instance, a plan.

### 4.5 What growth costs

A pool, a garden, a second home, a trailer: each is new *categories* and new
*item kinds* — registry entries and rows, not tables, routes, unions, or rule
engines. On the old model each of the four journeys above needed either a new
table or a new arm of the `kind` switch in every consumer. Here, the matrix
gains a row and nothing else changes.

## 5. What each subsystem looks like after Phase 1

| Subsystem | Today | After |
| --- | --- | --- |
| Log a vitamin | `POST /milestones` with `kind:'vitamins'` | `POST /events` with `category:'vitamins'`, body validated by the registry's zod |
| Inventory emit | 9 routes each call `emitActivity`; conformance fixtures keep them honest | The events route emits once, for everything in it; typed routes keep their call until Phase 2 |
| Upcoming | future-dated milestone rows only | `plans` where `status = 'planned'` — one query, every bookable category, overdue visible |
| "Did it happen?" | nothing — a future row silently becomes a past one | overdue plans prompt, answered with done / reschedule / missed / cancel (§3.6); `done` pre-fills the log form and links `fulfilled_by` |
| Future-dated log | accepted for every category, filtered out later by convention | refused at the edge by the registry's zod for record categories (§3.6); sorts are honest by construction |
| Summary tiles | one hand-written query per table; window-function query for the 8 kinds | one query over `events` for the migrated kinds; typed tables unchanged until Phase 2 |
| Activity history / search | union over tables + milestone kinds | one table for migrated kinds |
| Attachments | `ref_type='milestone'` for all 8 kinds | `ref_type='event'`, backfilled |
| Export/import | per-table sections | one `events` section for migrated kinds |
| Picker ("used up by") | one entry per table + `presetConditions` hack | one entry per `consumable` category |

## 6. Migration

Per-family SQLite, so this is a versioned migration that runs at open — the
machinery is the one that shipped v10 and v25.

**Phase 1 — remove the catch-all (the redesign):**

1. Create `events` (§3.1).
2. Backfill from `milestones`, one `INSERT … SELECT` per kind — past rows
   into events, future rows into plans, split at the now boundary so nobody's
   booked checkup becomes a fake "last visit":

```sql
INSERT INTO events (id, subject_id, category, occurred_at, title, notes, data, tags, created_by, created_at)
SELECT id, subject_id, 'vitamins', achieved_date, title, description,
       json_object('type', category), tags, created_by, created_at
FROM milestones WHERE kind = 'vitamins' AND achieved_date <= now;
-- …the same for routines, firsts, milestones, medical, medication,
-- appointments, grooming. Ids are preserved, so ref_ids stay valid.

INSERT INTO plans (subject_id, category, scheduled_at, title, notes, data, created_by, created_at)
SELECT subject_id, 'appointments', achieved_date, title, description,
       json_object('type', category), created_by, created_at
FROM milestones WHERE kind = 'appointments' AND achieved_date > now;
-- the same split for every bookable kind (§3.6): its future rows are
-- bookings, and plans take fresh ids.
```

   Every vaccination's `next_due_date` becomes a plan with
   `origin_event_id` set to the dose that scheduled it, so upcoming keeps
   working the day the promotion on `nextDue` is dropped. Attachments on
   future rows re-point to `ref_type = 'plan'`.

3. Rewrite the join keys: `inventory_consumption_rules` rows with
   `source_table='milestones'` become `source_category = <the folded kind>`
   (the `kind` condition collapses into the category; the rest of the
   conditions move across verbatim). `attachments` rows with
   `ref_type='milestone'` become `ref_type='event'`. Reminder conditions
   already name categories — untouched.
4. The milestones route becomes a thin alias for one release, then goes; the
   web ships in the same image, so no compatibility window is needed beyond
   our own caution. `DROP TABLE milestones` lands the release after, once a
   full deploy has run against `events` in preview and prod.
5. Delete `MILESTONE_CATEGORY_IDS`, `MILESTONE_KINDS`, the
   `MilestoneLogger` kind switches, and the `presetConditions` picker path.

**Phase 2 — fold the rest (optional, on demand):** journal and moods are
trivially envelope-shaped and move the moment a feature wants them. Feeds,
diapers, sleep, growth and vaccinations move to envelope + detail tables only
when a feature demands their unification (timeline search across everything,
say). The registry's `storage` makes both states first-class, so nothing is
blocked on Phase 2 — and if it never happens, the model still holds.

**Home module:** arrives as categories and an item kind, not as new tables.

## 7. What this gives up, honestly

- **Shape enforcement moves from schema to zod.** The database will not stop a
  malformed vitamin. The registry validates at the edge and a fixture-per-
  category test keeps each zod honest — the same discipline the consumption
  conformance test already proved workable. `CHECK`s still exist where
  invariants are structural (the subject/item XOR).
- **Attribute filters become `json_extract`.** "bottle feeds only" reads
  `json_extract(data,'$.type')='bottle'`. At family scale (thousands of rows,
  indexed on subject + time) this is noise; SQLite expression indexes exist
  the day a report disagrees.
- **Two storage locations during the transition.** The registry names which,
  per category, so no consumer branches on it — that is §3.4's whole job.
- **A larger blast radius than a rename.** It touches routes, registry, forms,
  and one migration. That is the cost of the model being wrong for eight
  categories; paying it once is cheaper than paying per-feature forever.

## 8. Non-goals

- **Append-only event sourcing.** Records are editable; the ledger stays.
- **Cross-family analytics.** The tenant boundary stays a file.
- **SQLite triggers** as the emit mechanism — rejected again, for the reasons
  `inventory-consumption-design.md` §4.2 recorded: logic in schema is logic
  nobody can read or test.
- **Per-category tables as the default answer.** They remain the *promotion*
  target (§3.4), not the starting point.
- **Plans are not a calendar.** No attendees, no invitations, no ICS feed — a
  plan is one family's booking, shared with exactly the people the app
  already shares everything with.

## 9. Open questions

- Do journal and moods fold in during Phase 1 (they are trivially shaped) or
  wait for Phase 2? Leaning Phase 2, to keep the first migration auditable.
- Edit/delete rebilling for consumption remains open exactly as before — the
  gate rows identify the event either way.
- Does `items.kind` land with the home module or early with the rename only?
  Leaning: rename early (it is one line), `kind` with the module.
- The offline queue's edit path (when it exists) must write through the
  registry's zod like every other writer.
- The skew tolerance for record timestamps (§3.6): minutes, as a constant in
  the registry — not a setting. Leaning five.
- Which categories are bookable beyond the obvious four (appointments,
  medical, vaccines, maintenance)? Grooming and routines can argue either
  way. Leaning: any category may declare `book`, ship with the obvious four.
- Recurring plans: does fulfilling a dentist plan generate the next one?
  Leaning yes (`recurring_every_days` on the plan); the alternative — a
  reminder rule — already exists and stays for cadence-without-a-date.
- Should the log sheet suggest linking a fresh event to an open plan when
  the two match (same category, same subject, near in time)? Leaning no for
  the first release: the overdue prompt already asks, and a wrong suggestion
  writes a fact nobody confirmed.
