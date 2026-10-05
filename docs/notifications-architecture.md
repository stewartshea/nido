# Notifications & Digest Scheduler — Architecture

How Nido decides what to tell you, what it emails, and what runs when nobody has
the app open.

The design goal was that a self-hosted install (one API container, one volume)
gets automatic notification email with no extra process, while leaving a clean
seam for a hosted deployment that outgrows a timer.

---

## 1. Scope: everything is family-wide

There is exactly one scope. A rule belongs to a family, not to a person.

This was a deliberate correction. Rules were originally configurable from two
different Settings tabs and fired in three different places, and nothing on
screen said whose rules you were looking at. `created_by` was written to the
database but never returned, so a rule your partner created looked like it
belonged to whoever happened to be looking at the page.

So the UI now states the scope explicitly rather than leaving it to be inferred,
and both rule endpoints return `createdByName` so every rule is attributed:

- `api/src/routes/reminders.ts` — tracking rules (inactivity, interval)
- `api/src/routes/inventory.ts` — inventory rules

**Who a rule is emailed to is a separate question.** Every rule is family-wide and
visible to everyone; what you choose per rule is the audience that receives
email — the whole family, or named caregivers. See §3.

## 2. Firing and being told are two different things

Two questions that were originally conflated into one:

| | Meaning |
| --- | --- |
| **Firing** | The condition is true right now. |
| **Notified** | A particular person has not yet been told about this crossing. |

`evaluateRules` is now a pure function of current values: it reports what
matches and writes nothing. Notification state lives entirely in
`inventory_rule_recipients`, keyed `(rule_id, item_id, user_id)`, and is only
ever written by the delivery path.

Two bugs fell out of conflating them, and both are why the split matters:

1. **Reading the page consumed the notification.** `GET /api/v1/inventory`
   persisted a "last fired" timestamp, so opening the page before the sweep made
   the digest believe the family had already been told — and it never sent the
   email. The read path now writes nothing.
2. **One person's bounce silenced everyone.** State was keyed `(rule_id,
   item_id)` for the whole family, so if Sam's address bounced, the alert was
   marked told and Alex never got it either. It is now keyed per recipient, and
   only written for someone a message actually reached.

A rule with no `repeat_days` notifies each person once, until the rule clears; a
rule with `repeat_days` re-notifies each person on that cadence. Clearing the
condition forgets the rows, so the next crossing counts as a first one.

## 3. Who gets told

Per rule, one of:

- **Everyone in the family** — every caregiver with an account (the default, and
  what every pre-existing rule gets).
- **Named caregivers** — only those account ids.

Deliberate decisions:

- **Only confirmed addresses are emailed.** An unconfirmed address is either a
  typo or someone else's, and the picker says so inline rather than letting a
  caregiver pick someone who will silently never hear about it.
- **Narrowing to nobody is refused** with an explanation, because "tell no one" is
  almost always someone who forgot to tick a box.
- **The audience governs email only.** Every caregiver still sees every rule and
  every firing alert, because the stock is shared: hiding a low-stock rule from
  the household because one person owns it helps nobody, and the information
  disappears exactly when that person is away.
- **The audience is stored as account ids, not member ids.** Delivery needs a
  confirmed address, and an account is the only thing that has one. Nido also
  models people as `family_members`, but the two sets barely overlap: registration
  creates no member row for the owner at all, so member ids would make the owner
  un-targetable. Targeting people would first mean backfilling a member row for
  every account — a migration through the tenant model that still could not email
  a member who has no account.
- **A caregiver is listed under the name the family uses**, taken from a linked
  member profile when one exists, falling back to the name they signed up with.
  Picking between people should not depend on which string they typed first.

## 4. What a digest contains — and what it does not

`runFamilyDigest` in `api/src/notifications.ts` emails **inventory alerts only**.

Tracking reminders (no feed in 3h, change the furnace filter) are evaluated and
shown in the UI, and they fire in-app, but they are **not** in the email digest.
This is stated on the Notifications page rather than papered over.

Adding them is a change to `runFamilyDigest`, not to the scheduler.

## 5. The scheduler

An in-process timer in the **API** container. Not the web container, not a third
container.

- Starts after `ensureRegistry()` succeeds, so it never races boot migrations.
- First run 15s after boot (grace period), then on the interval.
- `unref()`'d, so the timer can never hold the process open.
- `stopScheduler()` runs **before** `closeAllClients()` on SIGTERM, so a sweep
  in flight cannot outlive the database handles it reads through.
- Config from `NOTIFY_ENABLED` and `NOTIFY_INTERVAL_MINUTES` (default `60`).
  A malformed value warns and falls back — it never blocks boot.

Evaluating is cheap: local SQLite, and families with no enabled rules are skipped
*before* any stock is read. That is the difference between a sweep that costs
nothing and one that opens every family's database.

Why a timer rather than a queue: a self-hosted install is one API container and
one volume. A queue would add an operator-managed dependency for no benefit at
that size.

## 6. Crossing the tenant boundary

The digest normally runs inside a request, where `familyId` comes from a verified
JWT. A scheduler has no request, so this is the part that is genuinely different
from every other route:

```
registry.db
  SELECT family_id FROM families WHERE status = 'active'
        │
        ├─► getFamilyClient(familyId)  ──► db/<familyId>.db   (encrypted)
        │        runFamilyDigest(familyId)  inside that family only
        └─► next family
```

Each family is opened, evaluated and closed independently. **There is no query
that spans families.** `runFamilyDigest` receives a `familyId` and reaches
nothing else — the tenant boundary is still the file, exactly as
`AGENTS.md` requires. Enumerating the registry to learn *which* families exist
is not the same as reading across them, and the digest never does the latter.

Because the sweep applies consumption cadences, it writes `inventory_adjustments`
rows with `created_by = NULL`: nobody recorded that use. A fabricated user id in
the ledger would be a lie the UI later repeats.

One family's failure is caught, counted and logged; the sweep continues. A single
unreachable tenant cannot stall everyone else's email.

## 7. Scaling out

Two independent guards, because they cover different failures:

| Mechanism | Covers | Fails when |
| --- | --- | --- |
| Lease row in `registry.db` | Replicas **sharing a volume** — the second cannot acquire a live lease, so no double-send. Released at the end of each sweep; a crashed holder is superseded once the lease expires (`max(2 × interval, 10 min)`). | Registry is not shared |
| `NOTIFY_ENABLED=false` | Replicas on **separate volumes**, which have separate registries and genuinely cannot see each other | — |

Set `NOTIFY_ENABLED=false` on all but one replica. This is the documented
mechanism, not the lease: the lease is defence in depth for the shared-volume
case, and should not be relied on to pick a winner.

A re-entrancy guard also stops one process overlapping two sweeps.

## 8. The queue seam

The unit of work is:

```ts
runFamilyDigest(familyId, opts?) → Promise<DigestOutcome>
```

It takes a family id and nothing else — no request, no session, no user — and
opens its own client. `POST /api/v1/inventory/notify` and the timer both call
it, so there is exactly one implementation of a digest.

To move to a queue: a consumer calls `runFamilyDigest(familyId)` per job and
`scheduler.ts` is deleted. Nothing else changes — no route, no evaluator, no
schema. That is the test of whether this boundary is in the right place.

## 9. Observability

Structured logs, greppable by `event`:

| `event` | Meaning |
| --- | --- |
| `scheduler_started` | Timer armed; includes `intervalMinutes` and `holder` |
| `scheduler_disabled` | `NOTIFY_ENABLED=false` |
| `scheduler_sweep` | Sweep finished; `families`, `firing`, `sent`, `failed`, `errors` |
| `scheduler_lease_held` | Another holder owns it; skipped |
| `scheduler_family_failed` | One tenant threw; the rest continued |

`GET /api/v1/notifications/status` returns `{ enabled, running, intervalMinutes }`
so the UI can describe the actual schedule instead of guessing. It is instance
level, not family level: one timer sweeps every family.

## 10. Deliberately not built

- **Cron expressions / per-timezone send times.** `NOTIFY_INTERVAL_MINUTES` is a
  fixed interval. "07:00 in the family's timezone" is a different feature and a
  real design question, not a small addition.
- **A queue or broker.** See §8.
- **Per-person rules nobody else can see.** See §3 — the audience exists, but the
  rule and its state stay shared.
- **Tracking reminders in the digest.** See §4.

## 11. Files

| File | Role |
| --- | --- |
| `api/src/scheduler.ts` | Timer, config, lease, sweep. The only thing a queue replaces. |
| `api/src/notifications.ts` | `runFamilyDigest(familyId)` — the unit of work. |
| `api/src/inventory-eval.ts` | Family-scoped evaluation, plus audience resolution and per-recipient notification state. |
| `api/src/inventory-audience.test.ts` | Audience, verified-address filtering, per-recipient state. |
| `api/src/inventory-signals.ts` | Signal registry and `evaluateRules` (firing vs notified). |
| `api/src/routes/notification-status.ts` | `GET /notifications/status` for the UI. |
| `api/src/scheduler.test.ts` | Config, lease exclusion, enumeration, error isolation. |
| `api/src/routes/families.ts` | `GET /families/accounts` — the caregivers a rule can address. |
| `web/src/lib/components/logging/AudiencePicker.svelte` | Whole-family vs named caregivers. |
| `web/src/routes/notifications/` | The one page: firing now, email, both rule sets. |
