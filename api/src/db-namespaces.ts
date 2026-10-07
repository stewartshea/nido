// db-namespaces.ts
// Phase A: SQLCipher-encrypted per-family SQLite namespaces plus the global
// registry DB (email -> familyId/userId routing, instance settings, platform
// admin flag). Built on db-core; consumed by later phases (auth, routes,
// provisioning). See .omo/plans/per-family-namespaces.md.
import fs from 'node:fs';
import path from 'node:path';
import { randomFillSync } from 'node:crypto';
import { log } from './logger';
import {
  NAMESPACE_HOUSEHOLD_ID,
  SqliteFacade,
  assertFamilyId,
  deriveKey,
  getDataDir,
  getMasterKeyHex,
  openDb,
  runMigrations,
  type Migration,
} from './db-core';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — avoids confusion

// ---------------------------------------------------------------------------
// Registry DB — global control plane shared by every family namespace.
// ---------------------------------------------------------------------------
export const REGISTRY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'registry-v1',
    sql: `
      CREATE TABLE IF NOT EXISTS families (
        family_id   TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        family_code TEXT UNIQUE,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS user_routing (
        id                   TEXT PRIMARY KEY,
        email                TEXT NOT NULL UNIQUE,
        family_id            TEXT NOT NULL REFERENCES families(family_id),
        user_id              TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'member',
        is_platform_admin    INTEGER NOT NULL DEFAULT 0,
        verification_token   TEXT,
        verification_expires TEXT,
        reset_token          TEXT,
        reset_expires        TEXT,
        created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        signup_enabled     INTEGER NOT NULL DEFAULT 1,
        email_verification INTEGER NOT NULL DEFAULT 0,
        smtp_host          TEXT,
        smtp_port          INTEGER NOT NULL DEFAULT 587,
        smtp_user          TEXT,
        smtp_pass          TEXT,
        smtp_from          TEXT,
        updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `,
  },
  {
    version: 2,
    name: 'registry-scheduler-leases',
    sql: `
      -- Which process currently owns a periodic job. Lives in the registry
      -- rather than a family database because the job spans every family, and
      -- because a single row is the cheapest possible coordination primitive
      -- when several replicas share one data volume.
      CREATE TABLE IF NOT EXISTS scheduler_leases (
        name        TEXT PRIMARY KEY,
        holder      TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
    `,
  },
];

// ---------------------------------------------------------------------------
// Family namespace DB — one encrypted file per family.
// ---------------------------------------------------------------------------
export const FAMILY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'family-v1',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        email          TEXT UNIQUE NOT NULL,
        password_hash  TEXT NOT NULL,
        first_name     TEXT NOT NULL,
        last_name      TEXT NOT NULL,
        email_verified INTEGER DEFAULT 0,
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS households (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS user_households (
        user_id      TEXT,
        household_id INTEGER,
        role         TEXT DEFAULT 'member',
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (household_id) REFERENCES households(id),
        UNIQUE(user_id, household_id)
      );
      CREATE TABLE IF NOT EXISTS babies (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id  INTEGER NOT NULL,
        name          TEXT NOT NULL,
        birth_date    TEXT,
        gender        TEXT,
        type          TEXT DEFAULT 'child',
        categories    TEXT,
        email         TEXT,
        avatar        TEXT,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      );
      CREATE TABLE IF NOT EXISTS family_invitations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id       INTEGER NOT NULL,
        email           TEXT NOT NULL,
        inviter_user_id TEXT,
        token           TEXT UNIQUE NOT NULL,
        status          TEXT DEFAULT 'pending',
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
        accepted_at     TEXT,
        FOREIGN KEY (family_id) REFERENCES households(id),
        UNIQUE(family_id, email)
      );
      CREATE TABLE IF NOT EXISTS feedings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id    INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time   TEXT,
        duration   INTEGER,
        amount     REAL,
        type       TEXT NOT NULL,
        side       TEXT,
        formula_id INTEGER,
        notes      TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS formulas (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id  INTEGER NOT NULL,
        name       TEXT NOT NULL,
        brand      TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES households(id)
      );
      CREATE TABLE IF NOT EXISTS photos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id   INTEGER NOT NULL,
        parent_type TEXT NOT NULL,
        parent_id   INTEGER NOT NULL,
        file_path   TEXT NOT NULL,
        mime        TEXT NOT NULL,
        added_by    TEXT,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES households(id)
      );
      CREATE INDEX IF NOT EXISTS idx_photos_family
        ON photos(family_id, parent_type, parent_id);
      CREATE TABLE IF NOT EXISTS family_settings (
        family_id        INTEGER PRIMARY KEY NOT NULL,
        categories       TEXT,
        category_options TEXT,
        created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES households(id)
      );
      CREATE TABLE IF NOT EXISTS diapers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id     INTEGER NOT NULL,
        change_time TEXT NOT NULL,
        type        TEXT NOT NULL,
        color       TEXT,
        consistency TEXT,
        notes       TEXT,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS sleep (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id    INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time   TEXT,
        duration   INTEGER,
        location   TEXT,
        notes      TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS growth (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id            INTEGER NOT NULL,
        measurement_date   TEXT NOT NULL,
        weight             REAL,
        height             REAL,
        head_circumference REAL,
        bmi                REAL,
        unit_system        TEXT DEFAULT 'imperial',
        notes              TEXT,
        created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS milestones (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id       INTEGER NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT,
        achieved_date TEXT NOT NULL,
        category      TEXT,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS vaccinations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id         INTEGER NOT NULL,
        name            TEXT NOT NULL,
        date_given      TEXT,
        next_due_date   TEXT,
        administered_by TEXT,
        notes           TEXT,
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS moods (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id     INTEGER NOT NULL,
        mood        TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        notes       TEXT,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        baby_id    INTEGER NOT NULL,
        title      TEXT,
        body       TEXT,
        entry_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (baby_id) REFERENCES babies(id)
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id     INTEGER NOT NULL,
        kind          TEXT NOT NULL,
        category      TEXT,
        target_type   TEXT DEFAULT 'member',
        target_id     INTEGER,
        label         TEXT,
        hours         INTEGER,
        interval_days INTEGER,
        last_at       TEXT,
        enabled       INTEGER DEFAULT 1,
        created_by    TEXT,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (family_id) REFERENCES households(id)
      );
      CREATE TABLE IF NOT EXISTS import_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_key TEXT NOT NULL,
        kind         TEXT NOT NULL,
        baby_id      INTEGER,
        run_id       INTEGER,
        record_id    INTEGER,
        record_table TEXT,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_import_log_dedup
        ON import_log(baby_id, activity_key);
      CREATE TABLE IF NOT EXISTS import_runs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        family_id        INTEGER NOT NULL,
        baby_id          INTEGER,
        importer_user_id TEXT,
        import_type      TEXT NOT NULL,
        filename         TEXT,
        created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
        counts           TEXT,
        FOREIGN KEY (family_id) REFERENCES households(id)
      );
    `,
  },
  {
    version: 2,
    name: 'family-v2-members-homes-sharing',
    sql: `
      ALTER TABLE formulas ADD COLUMN formula_type TEXT;
      ALTER TABLE family_settings ADD COLUMN share_anonymized_daily INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS family_members (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id   INTEGER NOT NULL,
        legacy_baby_id INTEGER,
        name           TEXT NOT NULL,
        member_type    TEXT NOT NULL DEFAULT 'child',
        birth_date     TEXT,
        gender         TEXT,
        email          TEXT,
        avatar         TEXT,
        categories     TEXT,
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id),
        FOREIGN KEY (legacy_baby_id) REFERENCES babies(id),
        UNIQUE(legacy_baby_id)
      );

      CREATE TABLE IF NOT EXISTS homes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL,
        name        TEXT NOT NULL,
        kind        TEXT DEFAULT 'residence',
        address     TEXT,
        timezone    TEXT,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id)
      );

      CREATE TABLE IF NOT EXISTS member_homes (
        member_id   INTEGER NOT NULL,
        home_id     INTEGER NOT NULL,
        relation    TEXT DEFAULT 'resident',
        is_primary  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES family_members(id),
        FOREIGN KEY (home_id) REFERENCES homes(id),
        UNIQUE(member_id, home_id)
      );

      CREATE TABLE IF NOT EXISTS account_members (
        user_id     TEXT NOT NULL,
        member_id   INTEGER NOT NULL,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (member_id) REFERENCES family_members(id),
        UNIQUE(user_id, member_id)
      );

      CREATE INDEX IF NOT EXISTS idx_family_members_household ON family_members(household_id, member_type);
      CREATE INDEX IF NOT EXISTS idx_family_members_email ON family_members(email);
      CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_member_homes_home ON member_homes(home_id);

      INSERT OR IGNORE INTO homes (household_id, name, kind, is_primary, created_at, updated_at)
      SELECT h.id, 'Primary Home', 'primary', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM households h;

      INSERT OR IGNORE INTO family_members (
        household_id, legacy_baby_id, name, member_type, birth_date, gender, email, avatar, categories, created_at, updated_at
      )
      SELECT
        b.household_id,
        b.id,
        b.name,
        CASE WHEN COALESCE(b.type, 'child') = 'adult' THEN 'adult' ELSE 'child' END,
        b.birth_date,
        b.gender,
        b.email,
        b.avatar,
        b.categories,
        COALESCE(b.created_at, CURRENT_TIMESTAMP),
        COALESCE(b.updated_at, CURRENT_TIMESTAMP)
      FROM babies b
      LEFT JOIN family_members fm ON fm.legacy_baby_id = b.id
      WHERE fm.id IS NULL;

      INSERT OR IGNORE INTO member_homes (member_id, home_id, relation, is_primary, created_at)
      SELECT
        fm.id,
        h.id,
        CASE WHEN fm.member_type = 'adult' THEN 'resident' ELSE 'child' END,
        1,
        CURRENT_TIMESTAMP
      FROM family_members fm
      JOIN homes h ON h.household_id = fm.household_id AND h.is_primary = 1;

      INSERT OR IGNORE INTO account_members (user_id, member_id, created_at)
      SELECT u.id, fm.id, CURRENT_TIMESTAMP
      FROM family_members fm
      JOIN users u ON lower(u.email) = lower(fm.email)
      WHERE fm.email IS NOT NULL AND trim(fm.email) <> '';

      UPDATE formulas
      SET formula_type = 'standard'
      WHERE formula_type IS NULL OR trim(formula_type) = '';
    `,
  },
  {
    version: 3,
    name: 'milestone-tags-and-reminders-index',
    sql: `
      ALTER TABLE milestones ADD COLUMN tags TEXT;
      CREATE INDEX IF NOT EXISTS idx_milestones_category ON milestones(category);
      CREATE INDEX IF NOT EXISTS idx_reminders_kind_category ON reminders(kind, category);
    `,
  },
  {
    version: 4,
    name: 'family-members-trackable',
    sql: `
      ALTER TABLE family_members ADD COLUMN trackable INTEGER NOT NULL DEFAULT 1;
      UPDATE family_members SET trackable = CASE WHEN legacy_baby_id IS NULL THEN 0 ELSE 1 END;
      CREATE INDEX IF NOT EXISTS idx_family_members_legacy ON family_members(legacy_baby_id);
    `,
  },
  {
    version: 5,
    name: 'restore-trackable-for-members-with-profiles',
    sql: `
      UPDATE family_members
      SET trackable = 1
      WHERE trackable = 0
        AND (legacy_baby_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM babies b WHERE b.id = family_members.id AND b.household_id = family_members.household_id));
    `,
  },
  {
    version: 6,
    name: 'records-created-by',
    sql: `
      ALTER TABLE feedings ADD COLUMN created_by TEXT;
      ALTER TABLE diapers ADD COLUMN created_by TEXT;
      ALTER TABLE sleep ADD COLUMN created_by TEXT;
      ALTER TABLE growth ADD COLUMN created_by TEXT;
      ALTER TABLE milestones ADD COLUMN created_by TEXT;
      ALTER TABLE vaccinations ADD COLUMN created_by TEXT;
      ALTER TABLE moods ADD COLUMN created_by TEXT;
      ALTER TABLE journal_entries ADD COLUMN created_by TEXT;
    `,
  },
   {
     version: 7,
     name: 'feeding-amount-unit',
     sql: `
       ALTER TABLE feedings ADD COLUMN amount_unit TEXT NOT NULL DEFAULT 'oz';
     `,
   },
   {
     version: 8,
     name: 'feeding-breast-timestamps',
     sql: `
       ALTER TABLE feedings ADD COLUMN left_breast_at TEXT;
       ALTER TABLE feedings ADD COLUMN right_breast_at TEXT;
     `,
   },
   {
     version: 9,
     name: 'feeding-breast-durations',
     sql: `
       ALTER TABLE feedings ADD COLUMN left_duration INTEGER;
       ALTER TABLE feedings ADD COLUMN right_duration INTEGER;
     `,
   },
   {
     version: 10,
     name: 'milestone-kind',
     sql: `
       ALTER TABLE milestones ADD COLUMN kind TEXT NOT NULL DEFAULT 'milestones';
       UPDATE milestones SET kind = 'firsts' WHERE category = 'firsts';
       UPDATE milestones SET kind = 'routines' WHERE category IN ('vitamin', 'medication', 'bath', 'tummy time', 'story time', 'walk', 'appointment');
       UPDATE milestones SET kind = 'medical' WHERE category = 'medical';
     `,
   },
   {
     version: 11,
     name: 'inventory',
     sql: `
       -- Inventory is household-scoped: baby_id is NULL for a home item (filters,
       -- batteries) and set for stock belonging to one member (diaper sizes).
       CREATE TABLE IF NOT EXISTS inventory_items (
         id                 INTEGER PRIMARY KEY AUTOINCREMENT,
         baby_id            INTEGER,
         name               TEXT NOT NULL,
         category           TEXT NOT NULL,
         variant            TEXT,
         quantity           REAL NOT NULL DEFAULT 0,
         unit               TEXT DEFAULT 'count',
         pack_size          REAL,
         lead_days          INTEGER,
         event_category     TEXT,
         decrement_per_event REAL,
         active             INTEGER DEFAULT 1,
         notes              TEXT,
         created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
         updated_at         TEXT DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (baby_id) REFERENCES babies(id) ON DELETE CASCADE
       );
       CREATE INDEX IF NOT EXISTS idx_inventory_items_baby ON inventory_items(baby_id, active);
       CREATE INDEX IF NOT EXISTS idx_inventory_items_event ON inventory_items(event_category, active);

       -- Every quantity change is a row here, so consumption rate is a query
       -- rather than a guess from the current number.
       CREATE TABLE IF NOT EXISTS inventory_adjustments (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         item_id     INTEGER NOT NULL,
         change      REAL NOT NULL,
         reason      TEXT NOT NULL DEFAULT 'manual',
         ref_table   TEXT,
         ref_id      INTEGER,
         note        TEXT,
         created_by  TEXT,
         created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
       );
       CREATE INDEX IF NOT EXISTS idx_inventory_adj_item ON inventory_adjustments(item_id, created_at);
       -- One event counts once per item, so a retry cannot double-count. The
       -- index must include item_id: two sizes of the same consumable are both
       -- driven by the same logged event, and a global (ref_table, ref_id) index
       -- let whichever inserted first swallow the event for the other.
       CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adj_ref ON inventory_adjustments(item_id, ref_table, ref_id) WHERE ref_table IS NOT NULL;

       CREATE TABLE IF NOT EXISTS diaper_sizes (
         id           INTEGER PRIMARY KEY AUTOINCREMENT,
         baby_id      INTEGER NOT NULL,
         size         TEXT NOT NULL,
         item_id      INTEGER,
         start_date   TEXT,
         active       INTEGER DEFAULT 1,
         created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (baby_id) REFERENCES babies(id) ON DELETE CASCADE,
         FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE SET NULL
       );
       CREATE INDEX IF NOT EXISTS idx_diaper_sizes_baby ON diaper_sizes(baby_id, active);
     `,
   },
   {
     version: 12,
     name: 'diaper-size-weight-band',
     sql: `
       -- Weight at which a size is expected to be outgrown. Nullable and
       -- per-row so the bands can be corrected, or omitted entirely.
       ALTER TABLE diaper_sizes ADD COLUMN weight_band_kg REAL;
     `,
   },
   {
     version: 13,
     name: 'inventory-rules',
     sql: `
       -- Categories are deliberately NOT a lookup table: a household can invent
       -- one whenever it needs to. The route seeds a starter list and otherwise
       -- accepts free text, so adding a category is data, not a migration.
       --
       -- A rule names a signal (see api/src/inventory-signals.ts) and a line to
       -- cross. item_id null plus a category applies the rule across that whole
       -- category, which is how "warn me about any filter change" is expressed.
       CREATE TABLE IF NOT EXISTS inventory_rules (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         family_id     INTEGER NOT NULL,
         item_id       INTEGER,
         category      TEXT,
         signal        TEXT NOT NULL,
         comparator    TEXT NOT NULL DEFAULT 'lte',
         threshold     REAL NOT NULL,
         repeat_days   INTEGER,
         enabled       INTEGER DEFAULT 1,
         label         TEXT,
         created_by    TEXT,
         created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (family_id) REFERENCES households(id)
       );
       CREATE INDEX IF NOT EXISTS idx_inventory_rules_family ON inventory_rules(family_id, enabled);

       -- Fired-at history, so a rule that is simply true stays quiet instead of
       -- alerting on every page load.
       CREATE TABLE IF NOT EXISTS inventory_rule_state (
         rule_id       INTEGER NOT NULL,
         item_id       INTEGER NOT NULL,
         last_fired_at TEXT,
         PRIMARY KEY (rule_id, item_id),
         FOREIGN KEY (rule_id) REFERENCES inventory_rules(id) ON DELETE CASCADE
       );
     `,
   },
   {
     version: 16,
     name: 'inventory-categories-and-per-item-ref',
     sql: `
       -- Items keep a free-text category so nothing is ever rejected, and this
       -- table is the household's own vocabulary of categories to pick from.
       -- Categories already used by items are unioned in at read time, so a
       -- pre-existing item is never orphaned by adding the list afterwards.
       --
       -- Deliberately not seeded here: the households row is written after
       -- migrations run, so a seed insert would fail the foreign key.
       CREATE TABLE IF NOT EXISTS inventory_categories (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         family_id   INTEGER NOT NULL,
         name        TEXT NOT NULL,
         sort_order  INTEGER NOT NULL DEFAULT 0,
         created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
         UNIQUE (family_id, name),
         FOREIGN KEY (family_id) REFERENCES households(id)
       );

       -- One logged event counts once per item. A global (ref_table, ref_id)
       -- index let one of two same-type items swallow the event from the other,
       -- so it is rebuilt per item wherever the narrower form is not in place.
       DROP INDEX IF EXISTS idx_inventory_adj_ref;
       CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adj_ref
         ON inventory_adjustments(item_id, ref_table, ref_id) WHERE ref_table IS NOT NULL;
     `,
   },
   {
     version: 17,
     name: 'inventory-scheduled-consumption',
     sql: `
       -- Some things are used up by the calendar rather than by something you
       -- log: a daily contact, a fortnightly filter. consume_interval_days is
       -- that cadence, consume_started_at the anchor, and cycles_applied records
       -- how far the ledger has been brought up to, so applying the catch-up is
       -- idempotent no matter how long the app was not opened.
       ALTER TABLE inventory_items ADD COLUMN consume_interval_days INTEGER;
       ALTER TABLE inventory_items ADD COLUMN consume_started_at TEXT;
       ALTER TABLE inventory_items ADD COLUMN consume_cycles_applied INTEGER NOT NULL DEFAULT 0;
     `,
   },
   {
     version: 18,
     name: 'inventory-expiry-and-adjustment-source',
     sql: `
       -- Optional shelf life. Drives the days_to_expiry signal, so "tell me a
       -- week before this expires" is a rule rather than bespoke code.
       ALTER TABLE inventory_items ADD COLUMN expires_at TEXT;

       -- Where each ledger row came from. A scheduled row is the app's own guess;
       -- an event or manual row is something the user actually told us, which is
       -- what "have they confirmed usage lately" has to be measured against.
ALTER TABLE inventory_adjustments ADD COLUMN source TEXT DEFAULT 'manual';
    `,
  },
  {
    version: 19,
    name: 'notification-audience-and-per-recipient-state',
    sql: `
      -- Who gets told. 'family' means every caregiver with an account; 'users'
      -- means the listed account ids and nobody else. Stored as a JSON array of
      -- ids rather than a child table because the set is small, always read
      -- whole, and never queried across rules.
      ALTER TABLE inventory_rules ADD COLUMN audience_kind TEXT NOT NULL DEFAULT 'family';
      ALTER TABLE inventory_rules ADD COLUMN audience_ids TEXT;

      -- Replaces inventory_rule_state, which recorded one timestamp per
      -- (rule, item) for the whole family. That could not express "Sam has been
      -- told but Alex has not", so one person's bounce silenced everyone. This
      -- keys the timestamp per recipient instead.
      --
      -- The old rows are dropped rather than migrated. They recorded a crossing
      -- under the previous broadcast-only behaviour, and there is no way to
      -- attribute them to a person. The cost is one digest after upgrade for
      -- whatever happens to be firing at that moment, which is the honest
      -- reading: nobody has been told about those yet.
      DROP TABLE IF EXISTS inventory_rule_state;
      CREATE TABLE IF NOT EXISTS inventory_rule_recipients (
        rule_id         INTEGER NOT NULL,
        item_id         INTEGER NOT NULL,
        user_id         TEXT NOT NULL,
        last_notified_at TEXT,
        PRIMARY KEY (rule_id, item_id, user_id),
        FOREIGN KEY (rule_id) REFERENCES inventory_rules(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 20,
    name: 'diaper-size-weight-band-max',
    sql: `
      -- A diaper size covers a *range* of weights, and the number that matters is
      -- its ceiling: a child sizes out of Size 1 at 6.5kg, not at the 3.5kg where
      -- they entered it. weight_band_kg was being stored as the floor and read as
      -- if it were the ceiling, so the forecast fired about a size early.
      --
      -- Existing rows keep a null max and the forecast falls back to the next
      -- size's floor, so nothing that already works changes behaviour.
      ALTER TABLE diaper_sizes ADD COLUMN weight_band_max_kg REAL;
    `,
  },
  {
    version: 21,
    name: 'owner-member-profile',
    sql: `
      -- An account that creates a family owns it, and is a member of it. Until
      -- this existed, only an *invited* user gained a member profile (on accept),
      -- so the person who signed up had an account but no profile at all: absent
      -- from the member list, unpickable for anything, and adding themselves by
      -- hand produced a second unlinked profile rather than linking the account
      -- they already had.
      --
      -- One row per account, keyed on the household's owner, linked so the
      -- account shows as connected. Accounts with no owner row, and accounts
      -- already reachable through a linked member, are left alone.
      INSERT OR IGNORE INTO family_members (
        household_id, legacy_baby_id, trackable, name, member_type, email, categories, created_at, updated_at
      )
      SELECT
        uh.household_id,
        NULL,
        0,
        COALESCE(NULLIF(trim(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), u.email),
        'adult',
        u.email,
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM user_households uh
      JOIN users u ON u.id = uh.user_id
      WHERE uh.role = 'owner'
        AND uh.household_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM family_members fm WHERE fm.household_id = uh.household_id AND lower(fm.email) = lower(u.email))
        AND NOT EXISTS (SELECT 1 FROM account_members am WHERE am.user_id = uh.user_id);

      INSERT OR IGNORE INTO member_homes (member_id, home_id, relation, is_primary, created_at)
      SELECT fm.id, h.id, 'resident', 1, CURRENT_TIMESTAMP
      FROM family_members fm
      JOIN homes h ON h.household_id = fm.household_id AND h.is_primary = 1
      JOIN user_households uh ON uh.household_id = fm.household_id AND uh.role = 'owner'
      JOIN users u ON u.id = uh.user_id AND lower(u.email) = lower(fm.email)
      WHERE NOT EXISTS (SELECT 1 FROM member_homes mh WHERE mh.member_id = fm.id);

      INSERT OR IGNORE INTO account_members (user_id, member_id, created_at)
      SELECT u.id, fm.id, CURRENT_TIMESTAMP
      FROM user_households uh
      JOIN users u ON u.id = uh.user_id
      JOIN family_members fm ON fm.household_id = uh.household_id AND lower(fm.email) = lower(u.email)
      WHERE uh.role = 'owner'
        AND NOT EXISTS (SELECT 1 FROM account_members am WHERE am.user_id = u.id);
    `,
  },
  {
    version: 22,
    name: 'member-stage',
    sql: `
      -- The life stage that decides which categories a profile starts with.
      -- Stored rather than inferred: a two-year-old and a twenty-year-old need
      -- different categories and age cannot distinguish them, and a pet has no
      -- birth date to infer from.
      --
      -- Existing members are only backfilled where the stage is unambiguous. A
      -- child is left NULL because an infant and a ten-year-old are both
      -- children, and guessing would silently change what half of them track.
      -- Their category lists are not touched either way.
      ALTER TABLE family_members ADD COLUMN stage TEXT;

      UPDATE family_members SET stage = 'adult' WHERE member_type = 'adult' AND stage IS NULL;
      UPDATE family_members SET stage = 'pet'   WHERE member_type = 'pet'   AND stage IS NULL;
    `,
  },
  {
    version: 23,
    name: 'family-stage-categories',
    sql: `
      -- A family's own version of a stage template. The built-in STAGE_CATEGORIES
      -- are a starting point, not a rule: a household that does not track moods
      -- for its dog should be able to say so once, for the stage, rather than
      -- turning it off on every pet they add. Null means "use the built-in set".
      ALTER TABLE family_settings ADD COLUMN stage_categories TEXT;
    `,
  },
  {
    version: 24,
    name: 'member-quick-links',
    sql: `
      -- The few things a person logs most, pinned as tiles.
      --
      -- Per member rather than per account, because the whole point is that the
      -- tiles follow the person: switching from a baby to yourself should change
      -- what is one tap away. Stored here rather than in a browser so the choice
      -- follows the person across devices.
      ALTER TABLE family_members ADD COLUMN quick_links TEXT;
    `,
  },
  {
    version: 25,
    name: 'subject-vocabulary',
    sql: `
      -- The thing a log hangs off is not always a baby. It is a child, an adult
      -- or a pet, and the table holding them was named for one kind of them.
      --
      -- Deliberately NOT renamed to 'members': family_members.id is already
      -- called member_id everywhere it is referenced (account_members.member_id,
      -- member_homes.member_id), and that is a different row that only sometimes
      -- coincides. Calling this member_id would let two ids be confused in a
      -- query that still runs, which is the worst kind of rename.
      ALTER TABLE babies RENAME TO subjects;

      ALTER TABLE feedings       RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE diapers        RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE sleep          RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE growth         RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE milestones     RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE vaccinations   RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE moods          RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE journal_entries RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE import_log     RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE import_runs    RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE inventory_items RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE diaper_sizes   RENAME COLUMN baby_id TO subject_id;
      ALTER TABLE family_members RENAME COLUMN legacy_baby_id TO legacy_subject_id;

      -- Column renames carry the indexes with them, but an index name that says
      -- 'baby' outlives the column it was named for.
      DROP INDEX IF EXISTS idx_inventory_items_baby;
      CREATE INDEX IF NOT EXISTS idx_inventory_items_subject ON inventory_items(subject_id, active);
      DROP INDEX IF EXISTS idx_diaper_sizes_baby;
      CREATE INDEX IF NOT EXISTS idx_diaper_sizes_subject ON diaper_sizes(subject_id, active);
    `,
  },
  {
    version: 26,
    name: 'attachments',
    sql: `
      -- A file attached to a record: a vet's vaccination report against the
      -- appointment, a photo of a rash against the feeding.
      --
      -- Bytes live in the encrypted blob store, not here; this row is the link
      -- and the metadata. The blob key is stored so a reader does not have to
      -- re-derive the date fan-out from created_at, and so a moved blob is
      -- detectable rather than silently missing.
      --
      -- ref_type is the table the row hangs off, not the tracking category: an
      -- appointment is a milestone row, so it is ref_type='milestone'.
      CREATE TABLE IF NOT EXISTS attachments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id   INTEGER,
        ref_type     TEXT NOT NULL,
        ref_id       INTEGER NOT NULL,
        blob_id      TEXT NOT NULL,
        storage_key  TEXT NOT NULL,
        filename     TEXT,
        content_type TEXT NOT NULL,
        size         INTEGER NOT NULL,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by   TEXT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id)
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_ref ON attachments(ref_type, ref_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_subject ON attachments(subject_id);
    `,
  },
  {
    version: 27,
    name: 'drop-dead-photos',
    sql: `
      -- The record-photo mechanism is gone: its only UI was a component that
      -- nothing rendered, and it stored files unencrypted on disk. Avatars moved
      -- onto the encrypted blob store as subject attachments, so nothing reads
      -- this table and nothing writes it. Leaving it would be a second file
      -- mechanism to reason about for no benefit.
      DROP TABLE IF EXISTS photos;
    `,
  },
];

// ---------------------------------------------------------------------------
let registryClient: SqliteFacade | null = null;

/** Open (once) and return the encrypted registry DB; creates dirs + schema. */
export async function ensureRegistry(): Promise<SqliteFacade> {
  if (registryClient) return registryClient;
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  // 'nido:registry' is an HKDF input, not branding: changing it makes an
  // existing registry.db unreadable.
  const client = openDb(
    path.join(dir, 'registry.db'),
    deriveKey(getMasterKeyHex(), 'nido:registry', 'nido:registry'),
  );
  runMigrations(client.raw, REGISTRY_MIGRATIONS);
  await client.execute({ sql: 'INSERT OR IGNORE INTO app_settings (id) VALUES (1)' });
  registryClient = client;
  log.info('registry database ready', { event: 'db_registry_open', dataDir: dir });
  return client;
}

/** Alias — later phases read routing from here before touching family DBs. */
export const getRegistryClient = ensureRegistry;

const familyClients = new Map<string, SqliteFacade>();

function familyDbPath(familyId: string): string {
  return path.join(getDataDir(), 'db', `${familyId}.db`);
}

/**
 * Return the (cached) encrypted client for a family namespace. The family DB
 * must already exist — provisionFamily() creates it. LRU-bounded with
 * close-on-evict so we never hold too many files open.
 */
export function getFamilyClient(familyId: string): SqliteFacade {
  assertFamilyId(familyId);
  const hit = familyClients.get(familyId);
  if (hit) {
    // Refresh recency.
    familyClients.delete(familyId);
    familyClients.set(familyId, hit);
    return hit;
  }
  if (!fs.existsSync(familyDbPath(familyId))) {
    throw new Error(`Family namespace not provisioned: ${familyId}`);
  }
  // The 'nido:db' info below MUST stay identical to the provisioning call
  // site further down. If the two drift, a family database opens on one path
  // and fails to decrypt on the other.
  const client = openDb(
    familyDbPath(familyId),
    deriveKey(getMasterKeyHex(), familyId, 'nido:db'),
    { fileMustExist: true },
  );
  // Migrations must run on every open: a family provisioned before a migration
  // existed otherwise keeps a frozen schema. Gated by PRAGMA user_version.
  runMigrations(client.raw, FAMILY_MIGRATIONS);
  if (familyClients.size >= 16) {
    const oldest = familyClients.keys().next().value;
    if (oldest !== undefined) {
      familyClients.get(oldest)?.close();
      familyClients.delete(oldest);
      log.debug('family database evicted from cache', {
        event: 'db_family_evict',
        familyId: oldest,
        cacheSize: familyClients.size,
      });
    }
  }
  familyClients.set(familyId, client);
  log.debug('family database opened', {
    event: 'db_family_open',
    familyId,
    cacheSize: familyClients.size,
  });
  return client;
}

/**
 * Close every cached handle. Called on SIGTERM: an open SQLCipher connection
 * holds a WAL file, and leaving one behind on every pod restart is how a
 * long-lived deployment accumulates `-wal`/`-shm` files that never checkpoint.
 */
export function closeAllClients(): void {
  for (const [familyId, client] of familyClients) {
    try {
      client.close();
    } catch (error) {
      log.warn('failed to close family database', {
        event: 'db_family_close_failed',
        familyId,
        err: error,
      });
    }
  }
  const evicted = familyClients.size;
  familyClients.clear();

  if (registryClient) {
    try {
      registryClient.close();
    } catch (error) {
      log.warn('failed to close registry database', {
        event: 'db_registry_close_failed',
        err: error,
      });
    }
    registryClient = null;
    log.info('registry database closed', { event: 'db_registry_close' });
  }

  log.info('database handles closed', { event: 'db_close_all', familyCount: evicted });
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------
async function nextRegistryFamilyCode(registry: SqliteFacade): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(6);
    randomFillSync(bytes);
    let body = '';
    for (const b of bytes) body += CODE_CHARS[b % CODE_CHARS.length];
    const code = `KZ-${body}`;
    const existing = await registry.execute({
      sql: 'SELECT family_id FROM families WHERE family_code = ? LIMIT 1',
      args: [code],
    });
    if (existing.rows.length === 0) return code;
  }
  // Fall back to a timestamp-anchored code — 5 collisions in a row is
  // effectively impossible.
  return `KZ-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Create (or re-open) a family namespace: encrypted SQLite file, schema,
 * singleton household, and its registry row. Idempotent per familyId —
 * concurrent provisioning of the same familyId is not supported in Phase A.
 */
export async function provisionFamily(familyId: string, name: string): Promise<SqliteFacade> {
  assertFamilyId(familyId);
  const registry = await ensureRegistry();
  fs.mkdirSync(path.join(getDataDir(), 'db'), { recursive: true });

  // Same 'nido:db' info as the attach path — see the note there.
  const client = openDb(
    familyDbPath(familyId),
    deriveKey(getMasterKeyHex(), familyId, 'nido:db'),
  );
  runMigrations(client.raw, FAMILY_MIGRATIONS);
  await client.execute({
    sql: 'INSERT OR IGNORE INTO households (id, name) VALUES (?, ?)',
    args: [NAMESPACE_HOUSEHOLD_ID, name],
  });

  const code = await nextRegistryFamilyCode(registry);
  await registry.execute({
    sql: 'INSERT OR IGNORE INTO families (family_id, name, family_code, status) VALUES (?, ?, ?, ?)',
    args: [familyId, name, code, 'active'],
  });

  log.info('family namespace provisioned', { event: 'db_family_provision', familyId });
  return client;
}

/**
 * Tear down a just-created family namespace: evict + close any cached client,
 * delete the encrypted file, and drop its registry rows. Register uses this to
 * roll back when a later step (owner row / routing row) fails, so a family
 * never exists without a routed owner. Phase D extends this into full family
 * deletion with photo cleanup.
 */
export async function removeFamily(familyId: string): Promise<void> {
  assertFamilyId(familyId);
  const cached = familyClients.get(familyId);
  if (cached) {
    cached.close();
    familyClients.delete(familyId);
  }
  fs.rmSync(familyDbPath(familyId), { force: true });
  const registry = await ensureRegistry();
  await registry.execute({ sql: 'DELETE FROM user_routing WHERE family_id = ?', args: [familyId] });
  await registry.execute({ sql: 'DELETE FROM families WHERE family_id = ?', args: [familyId] });
  log.info('family namespace removed', { event: 'db_family_remove', familyId });
}
