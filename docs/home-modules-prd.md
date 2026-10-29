# HOME Modules — PRD

*Nido grows from a family tracker into the keeper of the nest itself: the
things a home owns, the care they need, the paper trail they generate, and the
people who service them.*

**Status.** Draft PRD, opened for review. Nothing here is shipped. Scope
decisions were settled in conversation (2026-10-29): metered reminders, seasonal
checklist instances, OCR on scanned files, provider contacts, the home itself
as an asset, family-wide visibility. Anything still open is marked **Open**.

---

## 1. The problem

A family owns things that need care on a schedule the family does not keep in
its head: the car needs an oil change every 8,000 km *or* six months, whichever
comes first; the tires get swapped to winters every November and back every
April; the furnace filter is quarterly; the receipts for all of it live in a
shoebox. Nido already tracks feeds and diapers with reminders, schedules, and
encrypted attachments — the HOME modules point the same machinery at the
physical world around the family.

The modules are **HOME** as a backronym — but this is not a new concept
beside an existing "Homes module"; **the `homes` registry (§2.1) is the H**,
and these modules are the home module that grows around it:

1. **H — Homes & the asset registry** (§2.1, §3): residences already exist
   in the schema; assets are the durable things that belong to them
2. **O — Odometer & usage meters** (§5)
3. **M — Maintenance log & documents** (§6, §7)
4. **E — Events, schedules & seasonal checklists** (§8)
5. — plus **Service providers** (§9), which lost the backronym fair and square.

## 2. What exists that these modules build on

Nothing below is greenfield. Each module composes a piece the platform already
has, which is the strongest argument for the shape of this PRD.

| Existing capability | Where | HOME reuses it for |
| --- | --- | --- |
| **Homes (residences)** | `homes`, `member_homes` tables; seeded per family | **The H.** The residence registry already exists — address, timezone, primary flag. These modules grow around it; there is no separate future "Homes module" |
| Inventory items + categories | `api/src/inventory.ts` | Categories, audience, list UX — *not* the asset itself (see §4) |
| Reminder conditions | `api/src/reminder-conditions.ts` | Schedule triggers read the same condition grammar |
| Scheduler + email digests | `api/src/scheduler.ts`, `notifications.ts` | Maintenance reminders ride the existing timer loop |
| Encrypted attachments | `api/src/attachments.ts`, `blob-store.ts` | Bills, manuals, warranty scans |
| Event model | `docs/event-model-design.md` | Maintenance entries as events; templates instantiate against it |
| Appointments (forward-looking list) | `api/src/appointments.ts` | Booked service visits |

## 2.1 Homes and assets — one model, not two

The PRD's first draft scoped `home_assets` to the family alone and treated
"the house" as one more asset. Review caught the drift that invites: `homes`
already represents the residence (address, timezone, member links), and a
second house-shaped row in `home_assets` would be two representations of the
same physical thing — one with schedules, one with an address — guaranteed to
disagree.

- **`homes` is the residence.** Address, timezone, and "who lives here" are
  home concerns; `member_homes` already carries them.
- **`home_assets.home_id` is nullable.** Family-scoped by default — a car is
  just "ours" — but a family with a cabin or a rental says *which* home a
  furnace or a shed belongs to. The registry stays family-flat; home is a
  scope, not a hierarchy (asset nesting stays deferred, §10).
- **`category: structure` means improvements** — shed, fence, driveway, sump
  pump — the durable things *at* a residence. The residence itself is
  `homes`, never a `home_assets` row.
- **The `/home` page's "Homes" card becomes real**: residences, their
  members, and each home's assets. The placeholder copy ("multi-home
  tracking coming in a future module") retires with this PRD.

**Open (migration order):** the registry (issue #65) shipped family-scoped
before this section existed; `home_id` is an additive migration (v42) and the
routes/UI grow a `homeId` filter. Nothing already written is invalidated.

## 3. H — The home asset registry

A **home asset** is a durable thing the family owns that needs care: a car, a
furnace, the house itself, a lawnmower, a generator. It is *not* a consumable —
the spare oil and the winter tires-as-inventory stay in inventory.

### Fields (v1)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `family_id` | uuid | Family-scoped, like inventory |
| `home_id` | uuid, nullable | The residence this asset lives at (§2.1) — null = family-wide, no `homes` row for e.g. a storage locker |
| `name`, `notes` | text | "The Mazda", "VIN ends 4417" |
| `category` | enum | Controlled vocabulary (`vehicle`, `appliance`, `hvac`, `structure`, `outdoor`, `other`) — same registry pattern as inventory categories, not free text, so assets can be reported on |
| `manufacturer`, `model`, `model_year`, `serial` | text, int, text | The identity quartet. Optional, but it is what makes manuals (§7.4) and populated details (§7.5) possible |
| `acquired_at`, `purchase_price` | date, int | Optional; feeds cost-per-year views later |
| `archived_at` | date | Sold/disposed assets keep their history and leave the lists |

### The asset-vs-inventory question, answered

Two options were weighed; the decision is **a new first-class `home_assets`
table**.

**Option A — extend inventory items.**

- *Pros:* one list, one migration, one picker UI; the audience machinery and
  category registry are inherited for free; no new mental model for users.
- *Cons:* inventory items are *stock* — countable, consumable, depleted by
  activity events. An asset is none of those things. Bolting `last_serviced_at`,
  `odometer`, and a schedule onto `inventory_items` grows columns that are
  NULL for every box of wipes, and every future asset-only feature (cost
  totals, provider links, checklists) compounds the debt.

**Option B — new `home_assets` table.** ← chosen

- *Pros:* each table keeps its own invariants; inventory's consumption rules
  (`inventory-consume.ts`) never intersect asset schedules; the two meet by
  *reference* instead (§6.4: a maintenance entry can consume an inventory item,
  e.g. "1 × furnace filter from stock").
- *Cons:* a second list for users to learn, and one question to answer in the
  UI: the asset page must answer "is this in inventory?" without making the
  user remember the rule. Mitigated below.

**Future growth decided this.** The roadmap already carries pet tracking
(grooming, vet visits) and adult tracking (medications, appointments) — both
are "an entity with a care schedule and a paper trail." The asset table is the
dry run for that shape: entity → schedules → log entries → documents →
providers. If assets lived inside inventory, pets and adults would have no
home; as a first-class entity, the pattern generalizes.

**The one UX rule that makes it land:** inventory and assets are *not* merged
into one tab. Inventory answers "what do we have and how much is left"; assets
answer "what do we own and what does it need." The asset detail page links out
to inventory where relevant. **Open:** whether the new-tab placement is
top-level or nested under an existing "Home" grouping — resolve at design pass.

## 4. Visibility

**All family members see all home assets**, matching inventory's audience
behavior (`inventory-audience.test.ts`). No per-asset visibility flags in v1 —
**Open:** a sensitive-document concern is handled at the *document* layer
(§7.2), not the asset layer, because a car title scan is a document problem,
not a "who can see the car" problem. Revisit if a family asks for it.

## 5. O — Meters (odometer & usage hours)

Reminders fire on **time, odometer, or usage-hours, whichever comes first** —
the full metered scope from the start, because "every 8,000 km *or* 6 months"
is the *actual* language car owners think in, and a time-only v1 would have
users logging mileage into a notes field within a week.

A **meter** is a monotonic counter attached to an asset:

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `asset_id` | uuid | An asset may have several (a car: odometer; a generator: run-hours) |
| `kind` | enum | `distance` (km, per the existing metric-first growth work) / `time` (hours) / `count` (cycles, loads, starts) |
| `unit` | text | Derived from `kind`; free-form only for `count` |
| `value`, `recorded_at` | int, ts | Latest reading wins; **readings are interpolated**, not required per-interval |
| `source` | enum | `manual` / `inventory-event` (see below) |

**Interpolation is the whole design.** Nobody logs their odometer daily. A
reading on Oct 1 (82,100 km) and one on Dec 1 (85,900 km) means the "every
8,000 km" trigger is evaluated against a linear estimate *today*, and the
reminder fires when the estimate crosses the line — with the last confirmed
reading shown, so "you're ~due, last read 82,100 on Oct 1" is honest. A
confirmed reading always overrides the estimate.

**`inventory-event` source:** a reading can be posted from anywhere the client
already is (the maintenance entry form posts the new odometer along with the
oil-change log). This is the same "one shared helper, many callers" shape as
`applyEventConsumption()`.

**Open:** automatic import (e.g. from a car API) is explicitly **out of scope**
and always has been — it drags in per-manufacturer integrations and OAuth
against third parties. Meters stay manual in v1 and until someone begs.

## 6. M — The maintenance log

A **maintenance entry** is the unit of care: one thing done to one asset, once.

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `asset_id` | uuid | |
| `performed_at` | date | When the care happened |
| `schedule_item_id` | uuid, nullable | Which scheduled line this satisfies (§8) — NULL = ad-hoc ("fixed the squeaky door") |
| `task` | text | "Oil change", "Tire swap to winter" |
| `cost` | int, nullable | CAD cents; totals roll up per asset and per year |
| `provider_id` | uuid, nullable | Who did it (§9) — self/family is simply no provider |
| `notes` | text | |
| `consumed_items` | ref[] | Inventory lines consumed ("1 × furnace filter") — writes through the existing consumption rules so stock stays honest |
| `attachments` | ref[] | The bill, the scan, the before/after photo (§7) |

### 6.1 The seasonal checklist case — why entries + schedules beat checkboxes

The example that opened this PRD: *check off seasonal tire changes.* The chosen
model is **recurring checklist instances**, not a self-re-arming checkbox,
because a checkbox forgets and a history doesn't:

- "Tires swapped to winters" in 2024 and in 2025 are **two maintenance
  entries**, both linked to the same **schedule item** (§8). The asset page
  shows the history — when it was done, who did it, what it cost, where the
  receipt is.
- "Checked off" is therefore a *derived* state: the schedule item is satisfied
  for this season iff a qualifying entry exists in its window. Nothing is
  checked off that isn't backed by a record.

### 6.2 Ad-hoc care

Unplanned work ("replaced the burnt-out garage door opener capacitor") is an
entry with no `schedule_item_id`. It appears in the history and cost rollups;
it never appears in "what's due."

## 7. Documents — scanned files & bills

### 7.1 What a document is

A document is an **encrypted attachment (existing machinery) plus maintenance
context**: cost, vendor, and warranty metadata ride on the maintenance entry
it hangs from. No new blob storage — `attachments.ts` and `blob-store.ts` are
reused as-is.

| Field | Lives on | Notes |
| --- | --- | --- |
| Bill/receipt scan | attachment | Encrypted, per existing attachment model |
| `cost`, `provider_id` | maintenance entry | Costs are entry-level so totals and per-provider views fall out |
| `warranty_expires_at`, `warranty_notes` | **new** document metadata | Drives its own reminder condition ("warranty on the furnace work ends in 60 days") |

### 7.2 OCR / searchable text — phased, honestly

Scope said OCR in v1; this PRD phases it, because OCR quality is the
difference between "search my bills for 'Midtown Auto'" and a search box that
lies.

- **Phase 1 (v1):** OCR at upload, **best-effort**, server-side, stored as
  searchable text next to the attachment. Search matches on the text and
  *always shows the scan alongside*, so a bad extraction is visible, not
  silent. Language: English + the family's existing locale set.
- **Explicitly out:** anything that "intelligently extracts" fields (total,
  vendor, date) into structured data in v1. That is a model-quality commitment
  this PRD refuses to make on its users' behalf; users type cost and vendor on
  the entry, which takes ten seconds and is correct.
- **Cost note for self-hosters:** OCR runs CPU-side in the container; if the
  image is unavailable, upload still works and OCR is skipped with a visible
  "not searchable" badge — never a failed upload.

### 7.4 Manuals — the drawer, made real

Manuals are a **first-class need, not an afterthought**: when the furnace acts
up, the question is "where is the manual," and the answer is "on the furnace's
asset page." Manual storage takes two forms, both asset-level (not
entry-level):

| Form | Storage | Notes |
| --- | --- | --- |
| **Manual file** | attachment, `ref: asset` | The existing encrypted attachment machinery with a NULL entry reference — the same shape as §7.3's proposal, now committed rather than open |
| **Manual link** | `manual_url` on the asset | Many manuals live at stable manufacturer URLs; a link is cheaper than a scan and never rots *for the user* |

Both live behind one **"Manuals" section on the asset page**, so the user never
cares which form a given manual takes — tap, view. The QR-code-in-the-manual
PDF case (a link to a file) is a manual file, not a link; the distinction is
"does Nido hold the bytes."

**Open (design pass):** a manual *library* — the same manual covering two
assets (the furnace and the water heater share a venting manual) — is deferred
to a later phase; v1 duplicates the attachment and accepts the bytes twice.
Cheap to migrate once `ref` is a table with its own id.

### 7.5 Populated details — what "add a car" should feel like

When a user adds an asset, Nido should populate it with useful details, and
the honest way to do that is **suggest, never assert**:

- The identity quartet (`manufacturer`, `model`, `model_year`, `serial`) is
  optional input. Given it, **adding an asset suggests the schedule items that
  model typically needs** — a car pre-suggests oil change (time + meter),
  tire rotation, seasonal tire swap; a furnace pre-suggests filter changes.
- Suggestions arrive **unchecked**. Nido never silently writes a schedule the
  user didn't confirm — a wrong schedule is worse than an empty one, because
  the user trusts the reminders.
- v1 ships a **curated template set** per category (hand-maintained, in the
  repo, reviewed like any code). **Out of scope:** scraping manufacturer
  schedules from the web, or any third-party lookup integration. The
  templates are per-*category*, not per-*model* — "sedan: oil change every
  8,000 km or 6 months" is advice, and the user adjusts the number to what
  their manual says (§7.4, right there on the page).
- **Open:** per-model template packs (a maintained corpus of common models)
  is a content-contribution question, not a schema question — the schema
  below supports it without change.

## 8. E — Schedules, seasonal windows, and checklists

### 8.1 Schedule items

A **schedule item** is one recurring care obligation on one asset:

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `asset_id` | uuid | |
| `task` | text | "Oil change", "Swap to winter tires" |
| `trigger` | list of conditions | Reuses the reminder-condition grammar: one or more of `interval` (every N days/months), `meter` (every N km / N hours on meter X), `seasonal_window` (Nov 15 – Dec 15) |
| `match` | enum | `any` (whichever condition fires first) / `all` |
| `lead_days` | int | Reminders start this many days before due |
| `archived_at` | date | Retired obligations keep history |

`match: any` is the default and is the oil-change case verbatim: *every 8,000
km or 6 months, whichever comes first* is not two schedules, it is one schedule
item with two conditions and `match: any`.

### 8.2 Seasonal windows

`seasonal_window(start_month_day, end_month_day)` is a first-class trigger
condition, not a date interval, because it recurs every year without a
year-anchored cron row that someone must regenerate. A window opens, the
reminder fires with `lead_days`, and the window closes — overdue state is
"past window close and unsatisfied," which is visible and shaming in the right
amount.

### 8.3 Checklist instances

For assets with seasonal obligations (the car, the cabin, the house), the
schedule **instantiates** when its window opens: the asset page shows "Winter
2026 checklist" — one card per schedule item in an active window, each one
*checking off by being satisfied* (§6.1) — where satisfying means either a
maintenance entry in the window or an explicit "not this season" skip with a
reason. The instance is **derived state**, materialized at read time from
schedule items + entries, not a row that must be kept in sync.

### 8.4 What's due

A single "What's due" view — across all assets — is the dashboard surface for
HOME: overdue first, then within-`lead_days`, then within-window. It feeds the
existing notifications digest like every other reminder source, so a family
gets one email with feeds *and* furnace filters, not two systems to check.

## 9. Service providers

A small, family-scoped address book: `name`, `phone`, `email`, `website`,
`notes` ("ask for Ray"), and the back-reference of past maintenance entries.
No booking, no invoices, no integrations — a provider's job in v1 is to be
*selectable* on an entry and *clickable* on a phone. **Open:** nothing stops a
provider from also being a family *member* (Dad does the tire swaps); that is
fine and expected — entries simply record it as no-provider plus notes.

## 10. The home itself

~~The house is an asset with `category: structure`.~~ — **revised by §2.1:**
the house is `homes`, never a `home_assets` row. The furnace, the roof, the
gutters, and the sump pump are either schedule items on a structure asset
("gutter cleaning, seasonal Oct") or their own appliance assets — each
optionally carrying a `home_id`. **Open (needs design):** whether an asset can
*contain* another asset (furnace ⊂ house) — proposed as a nullable
`parent_asset_id` in a later phase if the flat list hurts; v1 ships flat.

## 11. Permissions & tenancy summary

- Family-scoped, all-members-visible, like inventory. No HOME-specific roles.
- Owners/admins can archive assets and edit schedules; members can log
  maintenance — **Open**, defaulting to "members can do everything except
  archive," mirroring inventory.

## 12. Non-goals

- Automatic meter import (car APIs, telematics) — manual + interpolated.
- Structured field extraction from bills beyond best-effort OCR text.
- Booking, invoicing, or payment with providers.
- Asset depreciation, resale value tracking, insurance claims tooling.
- Reminders that fire per-person — maintenance nudges are per-asset and land
  in the shared digest.

## 13. Machine access — the MCP future

There is a stated **future direction: an MCP server that lets an AI assistant
interact with this list and its resources** — "what maintenance is due on the
car," "find the furnace manual," "log the oil change from this receipt." This
PRD does not ship it, but it is a *schema constraint*, and the schema obeys it:

- **Machine-readable from day one.** The controlled-vocabulary categories
  (§3), the meter `kind` enum (§5), the condition grammar (§8.1), and the
  identity quartet (§3) exist *instead of* free text because enums and
  structured fields are what make the list answerable by a tool, not just
  renderable by a page. Every "why not free text" decision above is a
  machine-access decision in disguise.
- **The API is the MCP.** The read surface an MCP server needs — list assets,
  read schedules and due-ness, read maintenance history, fetch a manual,
  search document text (§7.2) — is exactly the existing `/api/v1` family-scoped
  JWT surface. An MCP server is a *client* of the API, not a peer of it. No
  second API, no "AI-specific" endpoints.
- **Writes stay human-shaped in v1.** An MCP server writing maintenance
  entries is natural (the API is the same one the web client uses), but v1
  makes no read-write-API promises — **Open**, revisited when the MCP work
  starts.
- **What this rules out now:** nothing that would embarrass later. Free-text
  categories, schedules as UI-only state, and OCR text kept out of the
  database (or unsearchable) are the three decisions this section exists to
  keep from happening.

## 14. Milestones (proposed)

1. **Registry** — `home_assets` table, CRUD, categories, identity quartet, archive, tab.
2. **Meters** — meter readings, interpolation, estimate-based triggers.
3. **Schedules & reminders** — schedule items, condition grammar additions, "What's due," digest integration.
4. **Maintenance log** — entries, cost/provider/consumed-items, checklist instances, history views.
5. **Documents** — attachment reuse, document metadata, best-effort OCR, **manuals (§7.4): asset-level file + link forms behind one Manuals section**.
6. **Providers** — address book + entry linkage.
7. **Templates** — the curated per-category suggestion set (§7.5), the "add a car" populate moment.

Each milestone ships user-visible on its own; none is a big-bang release.

---

*Grilled, answered, and written in one sitting. The opens above are the
questions for the design pass, not for this PRD.*