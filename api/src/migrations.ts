// migrations.ts
// The versioned DDL history of both databases: the instance registry DB
// (routing + instance settings) and the family namespace DB (all care data).
// Pure data, read once — applied by runMigrations from namespaces.ts. The two
// data-carrying JS migrations live beside the array entries that invoke them.
import {
  DEFAULT_FEED_GROUPING_MINUTES,
  type Migration,
} from './db-core';
import {
  CATEGORIES,
  EVENT_KIND_CATEGORIES,
  consumableCategories,
  type CategoryId,
} from './category-registry';

/**
 * A family every account has moved out of — the invite flow re-points the
 * joiner's routing at the host family — still owns its namespace, because the
 * file may hold records and member profiles the account left behind. It is
 * retained, but it is no longer a *live* family: nothing routes to it, so it
 * cannot be signed into and the digest sweep has no recipient to address.
 *
 * Marking it keeps the instance's family count honest (and lets the sweep skip
 * it) without destroying anything. This same statement is the one-time backfill
 * for databases written before the join handler marked the source family, which
 * is how an install that already accumulated phantom families self-corrects on
 * the next boot.
 */
export const MARK_ORPHANED_FAMILIES_SQL = `
  UPDATE families
  SET status = 'abandoned',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM user_routing r WHERE r.family_id = families.family_id
    );
`;

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
  {
    version: 3,
    name: 'registry-mark-orphaned-families',
    sql: MARK_ORPHANED_FAMILIES_SQL,
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
  {
    version: 28,
    name: 'digest-frequency',
    sql: `
      -- How often a family wants to be emailed. Until now the interval was one
      -- environment variable for the whole instance, so "weekly" was not
      -- expressible and every family got the same cadence.
      --
      -- NULL means hourly, which is what the scheduler already did, so an
      -- existing family's behaviour does not change on upgrade.
      ALTER TABLE family_settings ADD COLUMN digest_frequency TEXT;
      -- When the last digest actually reached someone. Gates the frequency: a
      -- family on weekly is evaluated every sweep but only sends once a week.
      ALTER TABLE family_settings ADD COLUMN digest_sent_at TEXT;
    `,
  },
  {
    version: 29,
    name: 'reminder-conditions',
    sql: `
      -- A rule can watch more than one thing. "No pump or feed in 3h" is two
      -- conditions, and a routine like a bath is a category the old hard-coded
      -- switch did not know. Stored as a JSON array of { category, values? };
      -- rows written before this column existed keep their single \`category\`
      -- and are read as one condition, so no backfill is needed and a rule
      -- created today is identical whether read before or after the upgrade.
      ALTER TABLE reminders ADD COLUMN conditions TEXT;
    `,
  },
  {
    version: 30,
    name: 'reminder-match-mode',
    // How a rule's conditions combine: 'any' (OR — either counts) or 'all'
    // (AND — only the whole set counts). Defaults to 'any', which is what a
    // single-condition rule already meant, so nothing existing changes.
    //
    // Guarded rather than plain SQL because `match_mode` briefly lived inside
    // migration 29 while this feature was unreleased, so some databases already
    // have the column at version 29. Plain `ADD COLUMN` would then fail and
    // block the whole family from opening; the check makes it idempotent.
    run: (raw) => {
      const columns = raw.pragma('table_info(reminders)') as Array<{ name: string }>;
      if (!columns.some((c) => c.name === 'match_mode')) {
        raw.exec("ALTER TABLE reminders ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'any'");
      }
    },
  },
  {
    version: 31,
    name: 'member-dashboard-tiles',
    // Which dashboard tiles to show for a member, and in what order. Stored per
    // member (not per account), so the panel follows the person across devices.
    //
    // Null means "follow the member's categories", which is how the panel has
    // always decided its tiles; a family that never customizes keeps getting
    // that. (The set of tiles on offer grew in the same change that added this
    // column, so the raw tile count does go up for members who track the newer
    // categories.)
    //
    // Guarded rather than plain SQL, the same reason migration 30 is: an
    // intermediate build can carry the column at an earlier user_version, and a
    // plain ADD COLUMN would then fail and block the whole family from opening.
    run: (raw) => {
      const columns = raw.pragma('table_info(family_members)') as Array<{ name: string }>;
      if (!columns.some((c) => c.name === 'dashboard_tiles')) {
        raw.exec('ALTER TABLE family_members ADD COLUMN dashboard_tiles TEXT');
      }
    },
  },
  {
    // Renumbered from 31 when member-dashboard-tiles (#33) landed first; two
    // migrations must never share a version, or the second is silently skipped
    // on any database that already ran the first.
    version: 32,
    name: 'appointment-notifications',
    // Guarded rather than plain SQL, like migration 30: a database that has had
    // its version rewound (or an interrupted upgrade) may already carry these
    // columns, and a plain ADD COLUMN would then throw and block the whole
    // family from opening. The check makes re-running harmless.
    run: (raw) => {
      const columns = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
      const has = (name: string) => columns.some((c) => c.name === name);
      // Opt-in weekly email about upcoming appointments. Off by default (0), so
      // an existing family's inbox behaviour does not change on upgrade.
      if (!has('appointment_notifications')) {
        raw.exec('ALTER TABLE family_settings ADD COLUMN appointment_notifications INTEGER NOT NULL DEFAULT 0');
      }
      // When the last appointment email actually reached someone. Gates the
      // weekly cadence the same way digest_sent_at gates the inventory digest.
      if (!has('appointment_notifications_sent_at')) {
        raw.exec('ALTER TABLE family_settings ADD COLUMN appointment_notifications_sent_at TEXT');
      }
    },
  },
  {
    version: 33,
    name: 'feed-grouping-window',
    // How wide a gap between two feeding rows still counts as one feed for the
    // feeds/day rate. A breast feed and the bottle that follows it are usually
    // minutes apart but are one feed; this is the window that merges them.
    //
    // Guarded like migration 32, for the same reason: a re-run (or a database
    // already carrying the column) must not throw and block the family opening.
    run: (raw) => {
      const columns = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
      if (!columns.some((c) => c.name === 'feed_grouping_minutes')) {
        raw.exec(`ALTER TABLE family_settings ADD COLUMN feed_grouping_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_FEED_GROUPING_MINUTES}`);
      }
    },
  },
  {
    version: 34,
    name: 'family-timezone',
    // The family's wall clock, as an IANA name ("America/New_York"). Stored as
    // an instant-agnostic display preference: every timestamp in the database
    // stays UTC, and this only decides which clock those instants are read on.
    //
    // NULL means "not chosen yet", which is not the same answer as UTC: the web
    // app treats an unset value as an invitation to detect the device's zone and
    // offer it, so a family is never silently shown the wrong day. A stored
    // value is always validated against the runtime's tz database on the way in.
    //
    // Guarded like migrations 32/33: a database carrying the column at an
    // earlier user_version must not throw and block the family from opening.
    run: (raw) => {
      const columns = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
      if (!columns.some((c) => c.name === 'timezone')) {
        raw.exec('ALTER TABLE family_settings ADD COLUMN timezone TEXT');
      }
    },
  },
  {
    version: 35,
    name: 'email-send-hour',
    // The local wall-clock hour each email should arrive, written next to the
    // family's timezone: "09" means 9am on the family's own clock, whatever the
    // API server thinks the time is.
    //
    // NULL is the important value and the default for every existing family: it
    // means "no local constraint, send whenever the cadence allows", which is
    // exactly what the scheduler did before this existed. An upgrade therefore
    // changes nobody's inbox, and a family only gets a local send time by
    // asking for one.
    //
    // Two columns rather than one shared hour, because the two emails have
    // different characters: an inventory alert is a report about something
    // already wrong, while the weekly appointment list is a forward-looking
    // nudge that reads better before the week starts. A family that wants its
    // appointments on Sunday evening need not also silence stock alerts until
    // then.
    //
    // Guarded like migrations 32-34: a database already carrying the columns at
    // an earlier user_version must not throw and block the family from opening.
    run: (raw) => {
      const columns = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
      const has = (name: string) => columns.some((c) => c.name === name);
      if (!has('digest_send_hour')) {
        raw.exec('ALTER TABLE family_settings ADD COLUMN digest_send_hour INTEGER');
      }
      if (!has('appointment_send_hour')) {
        raw.exec('ALTER TABLE family_settings ADD COLUMN appointment_send_hour INTEGER');
      }
    },
  },
  {
    version: 36,
    name: 'inventory-consumption-rule-columns',
    // An item's link to a logged activity grows from a boolean into a rule:
    // which activity (event_category, as before), optionally narrowed to one
    // option of it (event_option, e.g. a feed of type 'bottle'), how many
    // units of that activity make one whole use (units_per_decrement, so
    // 1 tablet per 4 bottles), and how far toward the next whole use the
    // logged events have accrued so far (consume_carry, so the fourth bottle
    // is what bills — not four quarters of one).
    //
    // inventory_consumption_events is the idempotency gate for events that do
    // not yet write a ledger row: the unique index on
    // inventory_adjustments(item_id, ref_table, ref_id) only fires once a
    // whole use accrues, so a retried event would otherwise add its partial
    // progress twice. It also records units, so a future activity that logs a
    // count ("washed 8 bottles") carries the same gate.
    //
    // Guarded like migration 32: a re-run (or a database already carrying the
    // columns) must not throw and block the family from opening.
    run: (raw) => {
      const columns = raw.pragma('table_info(inventory_items)') as Array<{ name: string }>;
      const has = (name: string) => columns.some((c) => c.name === name);
      if (!has('event_option')) {
        raw.exec('ALTER TABLE inventory_items ADD COLUMN event_option TEXT');
      }
      if (!has('units_per_decrement')) {
        raw.exec('ALTER TABLE inventory_items ADD COLUMN units_per_decrement INTEGER');
      }
      if (!has('consume_carry')) {
        raw.exec('ALTER TABLE inventory_items ADD COLUMN consume_carry REAL NOT NULL DEFAULT 0');
      }
      raw.exec(`
        CREATE TABLE IF NOT EXISTS inventory_consumption_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id     INTEGER NOT NULL,
          ref_table   TEXT NOT NULL,
          ref_id      INTEGER NOT NULL,
          units       REAL NOT NULL DEFAULT 1,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (item_id, ref_table, ref_id),
          FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 37,
    name: 'inventory-consumption-rules-table',
    run: (raw) => migrateToConsumptionRulesTable(raw),
  },
  {
    version: 38,
    name: 'events-and-plans',
    run: (raw) => migrateToEventsAndPlans(raw),
  },
  {
    version: 39,
    name: 'adult-medications-and-vitals',
    // The two shapes adult tracking needed and a milestone could not honestly
    // hold:
    //
    //   medications — a standing prescription, not a moment. Dose, frequency
    //   and start date are what make a reminder possible without somebody
    //   tapping "taken" by hand. Doses still write `events`, linked by
    //   data.medicationId, so history and stock billing are unchanged.
    //
    //   vitals — a measurement with its own numbers. Blood pressure is two
    //   values and a unit; squeezing it into a milestone title would make it
    //   unqueryable, and the whole point is seeing the trend.
    //
    // The backfill appends 'vitals' to adult profiles that already have a
    // curated list, because the feature would otherwise be invisible to every
    // adult who existed before this release. An empty array is left alone: it
    // is the family's explicit "nothing", which the resolver reads as the stage
    // template — appending would turn it into "only vitals".
    run: (raw) => {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS medications (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_id  INTEGER NOT NULL,
          name        TEXT NOT NULL,
          dose        TEXT,
          frequency   TEXT NOT NULL DEFAULT 'once_daily',
          start_date  TEXT NOT NULL,
          end_date    TEXT,
          notes       TEXT,
          active      INTEGER NOT NULL DEFAULT 1,
          created_by  TEXT,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_medications_subject ON medications(subject_id, active);

        CREATE TABLE IF NOT EXISTS vitals (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_id  INTEGER NOT NULL,
          recorded_at TEXT NOT NULL,
          kind        TEXT NOT NULL,
          systolic    INTEGER,
          diastolic   INTEGER,
          value       REAL,
          unit        TEXT,
          notes       TEXT,
          created_by  TEXT,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vitals_subject_time ON vitals(subject_id, recorded_at DESC);
      `);

      raw.exec(`
        UPDATE family_members
        SET categories = json_insert(categories, '$[#]', 'vitals')
        WHERE stage = 'adult'
          AND categories IS NOT NULL
          AND json_valid(categories)
          AND json_type(categories) = 'array'
          AND json_array_length(categories) > 0
          AND NOT EXISTS (
            SELECT 1 FROM json_each(family_members.categories) WHERE value = 'vitals'
          );

        UPDATE subjects
        SET categories = json_insert(categories, '$[#]', 'vitals')
        WHERE categories IS NOT NULL
          AND json_valid(categories)
          AND json_type(categories) = 'array'
          AND json_array_length(categories) > 0
          AND NOT EXISTS (
            SELECT 1 FROM json_each(subjects.categories) WHERE value = 'vitals'
          )
          AND id IN (
            SELECT COALESCE(fm.legacy_subject_id, fm.id)
            FROM family_members fm
            WHERE fm.stage = 'adult'
          );
      `);
    },
  },
  {
    version: 40,
    name: 'growth-updated-at',
    // PUT /growth/:id used to write its "updated timestamp" into created_at —
    // the only timestamp column the table had — so one edit rewrote the
    // measurement's provenance (issue #55). This gives the row the column the
    // route always meant to write; created_at from before the fix stays as it
    // is, honestly wrong rather than rewritten by us.
    run: (raw) => {
      const cols = raw.pragma('table_info(growth)') as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'updated_at')) {
        raw.exec('ALTER TABLE growth ADD COLUMN updated_at TEXT');
      }
    },
  },
  {
    version: 41,
    name: 'home-assets',
    // HOME module milestone 1 (issue #65): a home asset is a durable thing a
    // family owns that needs care — car, furnace, the house itself — and it
    // is deliberately NOT fields on inventory_items. Stock is countable and
    // consumable; an asset is neither. The two meet by reference instead:
    // maintenance entries consume inventory lines (PRD §6).
    //
    // category is a controlled vocabulary (vehicle, appliance, hvac,
    // structure, outdoor, other), not free text, so assets can be reported
    // on and a future category template (issue #71) can key off it.
    sql: `
      CREATE TABLE IF NOT EXISTS home_assets (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id   INTEGER NOT NULL,
        name           TEXT NOT NULL,
        category       TEXT NOT NULL,
        manufacturer   TEXT,
        model          TEXT,
        model_year     INTEGER,
        serial         TEXT,
        acquired_at    TEXT,
        purchase_price INTEGER,
        notes          TEXT,
        archived_at    TEXT,
        created_by     TEXT,
        created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_home_assets_family
        ON home_assets(household_id, archived_at);
    `,
  },
  {
    version: 42,
    name: 'home-assets-home-scoping',
    // HOME modules (issue #74, PRD §2.1): `homes` is the H — the residence
    // registry (address, timezone, member_homes) these modules grow around —
    // and an asset may say which residence it lives at. Nullable on purpose:
    // null = family-wide (the car is just "ours"), set = this home's furnace.
    // `structure` means improvements AT a residence (shed, fence, sump), so
    // the residence itself is a homes row, never an asset (§2.1, §10).
    //
    // Column-add is guarded like v40: SQLite has no ADD COLUMN IF NOT
    // EXISTS, and the idempotence tests re-run the chain on a rewound
    // user_version.
    run: (raw) => {
      const cols = raw.pragma('table_info(home_assets)') as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'home_id')) {
        raw.exec('ALTER TABLE home_assets ADD COLUMN home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL');
      }
      raw.exec('CREATE INDEX IF NOT EXISTS idx_home_assets_home ON home_assets(home_id)');
    },
  },
  {
    version: 43,
    name: 'homes-picture',
    // The homes registry grows a management surface (issue #76): names,
    // addresses, and a picture per residence. `picture` is the attachment-id
    // marker, the same shape `family_members.avatar` uses — the bytes live in
    // the encrypted blob store, attachments carries the row.
    run: (raw) => {
      const cols = raw.pragma('table_info(homes)') as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'picture')) {
        raw.exec('ALTER TABLE homes ADD COLUMN picture TEXT');
      }
    },
  },
];

/**
 * Move an item's consumption rule off the item and into its own table.
 *
 * Phase 1 of the generalized rules stored everything on inventory_items:
 * event_category, event_option, units_per_decrement, consume_carry. That caps
 * every item at exactly one rule and matches on one scalar option, so Phase 2
 * gives the rule a row of its own (inventory_consumption_rules) with a
 * condition document, per-rule carry, and a gate keyed by rule — which is
 * what lets one event bill several rules, and a household-scoped item follow
 * any member's events (subject_id NULL).
 *
 * Three moves, all forward-compatible with data written by Phase 1:
 *   1. Every linked item projects to exactly one rule row (conditions from
 *      event_option; the only attribute Phase 1 could filter on was a route-
 *      chosen single option, which both wired sources store in `type`).
 *   2. The idempotency gate re-keys (item_id, ref_table, ref_id) →
 *      (rule_id, ref_table, ref_id). Gate rows move onto the item's rule.
 *   3. inventory_adjustments gains a nullable rule_id: event-sourced rows
 *      backfill it, and the unique index becomes rule-scoped so two rules on
 *      one item can both bill the same event. The gate is the idempotency
 *      authority; the ledger keeps its (item_id, …) index dropped in favour
 *      of the partial rule-scoped one.
 *
 * Idempotent at every step (column checks, NOT EXISTS, shape checks), so a
 * re-run or a database already carrying the new shape must not throw and
 * block the family from opening. Exported for tests: a fresh database runs
 * this with no linked items, so the projection itself needs a seeded caller.
 */
export function migrateToConsumptionRulesTable(raw: {
  exec(sql: string): unknown;
  pragma(sql: string): unknown;
}) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS inventory_consumption_rules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id        INTEGER NOT NULL,
      source_table   TEXT NOT NULL,
      subject_id     INTEGER,
      match          TEXT NOT NULL DEFAULT 'all',
      conditions     TEXT,
      units_per_use  INTEGER NOT NULL DEFAULT 1,
      amount_per_use REAL NOT NULL DEFAULT 1,
      consume_carry  REAL NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_inv_consume_rules_item
      ON inventory_consumption_rules(item_id, active);
  `);

  // 1. Project linked items. An item that already has a rule is left alone,
  //    so a crashed migration resumes where it stopped.
  raw.exec(`
    INSERT INTO inventory_consumption_rules
      (item_id, source_table, subject_id, match, conditions,
       units_per_use, amount_per_use, consume_carry, created_at, updated_at)
    SELECT id, event_category, subject_id, 'all',
           CASE WHEN event_option IS NULL THEN NULL
                ELSE json_array(json_object('attr', 'type', 'values', json_array(event_option))) END,
           COALESCE(NULLIF(units_per_decrement, 0), 1),
           COALESCE(NULLIF(decrement_per_event, 0), 1),
           COALESCE(consume_carry, 0),
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM inventory_items
    WHERE event_category IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory_consumption_rules r WHERE r.item_id = inventory_items.id)
  `);

  // 2. Re-key the gate. A Phase-1 gate row moves onto its item's single rule;
  //    a row whose item lost its link is dropped with that link.
  const gate = raw.pragma('table_info(inventory_consumption_events)') as Array<{ name: string }>;
  if (gate.length === 0) {
    raw.exec(`
      CREATE TABLE IF NOT EXISTS inventory_consumption_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id    INTEGER NOT NULL,
        ref_table  TEXT NOT NULL,
        ref_id     INTEGER NOT NULL,
        units      REAL NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (rule_id, ref_table, ref_id),
        FOREIGN KEY (rule_id) REFERENCES inventory_consumption_rules(id) ON DELETE CASCADE
      );
    `);
  } else if (gate.some((c) => c.name === 'item_id')) {
    raw.exec(`
      CREATE TABLE inventory_consumption_events_v2 (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id    INTEGER NOT NULL,
        ref_table  TEXT NOT NULL,
        ref_id     INTEGER NOT NULL,
        units      REAL NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (rule_id, ref_table, ref_id),
        FOREIGN KEY (rule_id) REFERENCES inventory_consumption_rules(id) ON DELETE CASCADE
      );
      INSERT INTO inventory_consumption_events_v2 (rule_id, ref_table, ref_id, units, created_at)
        SELECT r.id, e.ref_table, e.ref_id, e.units, e.created_at
        FROM inventory_consumption_events e
        JOIN inventory_consumption_rules r ON r.item_id = e.item_id;
      DROP TABLE inventory_consumption_events;
      ALTER TABLE inventory_consumption_events_v2 RENAME TO inventory_consumption_events;
    `);
  }

  // 3. Ledger rows learn their rule. Rows carrying a ref were written by an
  //    event, and at migration time an item has at most one rule, so the
  //    subquery names it; manual and scheduled rows keep rule_id NULL.
  const adj = raw.pragma('table_info(inventory_adjustments)') as Array<{ name: string }>;
  if (adj.length > 0 && !adj.some((c) => c.name === 'rule_id')) {
    raw.exec(`
      ALTER TABLE inventory_adjustments ADD COLUMN rule_id INTEGER;
      UPDATE inventory_adjustments
      SET rule_id = (SELECT r.id FROM inventory_consumption_rules r WHERE r.item_id = inventory_adjustments.item_id)
      WHERE rule_id IS NULL AND ref_table IS NOT NULL AND ref_id IS NOT NULL;
      DROP INDEX IF EXISTS idx_inventory_adj_ref;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adj_rule_ref
        ON inventory_adjustments(rule_id, ref_table, ref_id) WHERE rule_id IS NOT NULL;
    `);
  }
}

/**
 * Phase 1b of the event model (docs/event-model-design.md §3.1, §3.6, §6):
 * records and plans become their own tables, and the milestone catch-all
 * empties into them, split at the now boundary.
 *
 * An event is a thing that happened; a plan is a thing that is going to. The
 * old table held both in one `achieved_date` column — past meant "happened",
 * future meant "scheduled" — which is why the Last tiles had to learn to
 * filter the future back out and why a booked checkup could sort as the last
 * medical entry. The split makes the tenses structural.
 *
 * Four moves, all id-preserving so every reference stays valid:
 *
 *   1. `events` and `plans` are created (§3.1, §3.6). `item_id` is a plain
 *      column with no foreign key yet: items are renamed in the home module,
 *      and an FK with ON DELETE would fight the subject/item CHECK the day
 *      an item is deleted. Nothing writes item events until then.
 *   2. Every milestone row moves: past rows into `events` (kind becomes the
 *      category; the option value moves from the `category` column into the
 *      data document under the kind's option key), future rows into `plans`
 *      as bookings with their `status` still `planned`. Ids are disjoint —
 *      a row is either past or future — so both tables keep them. The old
 *      rows stay in `milestones`, unread, until Phase 1c drops the table one
 *      release after this has run in production.
 *   3. Attachments flip `ref_type` from 'milestone' to 'event' or 'plan' by
 *      which table now owns the id.
 *   4. Consumption rules stop naming tables: `source_category` is added and
 *      backfilled. A rule that smuggled its kind inside a condition
 *      ('milestones' + kind: vitamins) folds into the category itself
 *      ('vitamins'), its option condition renames from the old column attr
 *      to the kind's data key, and a rule naming a plain table maps to the
 *      category that writes it. `source_table` lingers unread until 1c.
 *
 * Vaccination `next_due_date` deliberately does NOT become plans here:
 * vaccinations are still a typed table in this phase, so a plan would be a
 * second representation of a fact that lives in `vaccinations` — the exact
 * drift this migration exists to remove. It moves with vaccinations when
 * they fold into events (design §3.6's end state).
 *
 * Idempotent at every step (CREATE IF NOT EXISTS, NOT EXISTS, guarded ALTER),
 * so a re-run or a database already carrying the new shape must not throw
 * and block the family from opening. Exported for tests: a fresh database
 * runs this with an empty milestones table, so the backfill itself needs a
 * seeded caller.
 */
export function migrateToEventsAndPlans(raw: {
  exec(sql: string): unknown;
  pragma(sql: string): unknown;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
}) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id  INTEGER,
      item_id     INTEGER,
      category    TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      title       TEXT,
      notes       TEXT,
      data        TEXT NOT NULL DEFAULT '{}',
      tags        TEXT,
      created_by  TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      CHECK (subject_id IS NOT NULL OR item_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_events_subject_time ON events(subject_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category, occurred_at);

    CREATE TABLE IF NOT EXISTS plans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id      INTEGER,
      item_id         INTEGER,
      category        TEXT NOT NULL,
      scheduled_at    TEXT NOT NULL,
      title           TEXT,
      notes           TEXT,
      data            TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'planned',
      fulfilled_by    INTEGER,
      origin_event_id INTEGER,
      created_by      TEXT,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      CHECK (subject_id IS NOT NULL OR item_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_plans_due ON plans(status, scheduled_at);
  `);

  // The now boundary in SQL, so it is the migration's own run time, not the
  // process start. String comparison is honest here: a date-only value on a
  // future day sorts after any instant today, and one on a past day before.
  const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  for (const kind of EVENT_KIND_CATEGORIES) {
    const key = CATEGORIES[kind].optionKey;
    raw.exec(`
      INSERT INTO events (id, subject_id, category, occurred_at, title, notes, data, tags, created_by, created_at)
      SELECT id, subject_id, '${kind}', achieved_date, title, description,
             json_object('${key}', category), tags, created_by, created_at
      FROM milestones
      WHERE kind = '${kind}'
        AND achieved_date <= ${NOW}
        AND NOT EXISTS (SELECT 1 FROM events WHERE events.id = milestones.id);
    `);
    raw.exec(`
      INSERT INTO plans (id, subject_id, category, scheduled_at, title, notes, data, created_by, created_at)
      SELECT id, subject_id, '${kind}', achieved_date, title, description,
             json_object('${key}', category), created_by, created_at
      FROM milestones
      WHERE kind = '${kind}'
        AND achieved_date > ${NOW}
        AND NOT EXISTS (SELECT 1 FROM plans WHERE plans.id = milestones.id);
    `);
  }

  // Attachments follow their rows: 'milestone' splits on which table owns
  // the id now. Any ref_type still 'milestone' afterwards was already an
  // orphan and stays one, visibly rather than silently.
  raw.exec(`
    UPDATE attachments SET ref_type = 'event'
    WHERE ref_type = 'milestone' AND ref_id IN (SELECT id FROM events);
    UPDATE attachments SET ref_type = 'plan'
    WHERE ref_type = 'milestone' AND ref_id IN (SELECT id FROM plans);
  `);

  const ruleCols = raw.pragma('table_info(inventory_consumption_rules)') as Array<{ name: string }>;
  if (!ruleCols.some((c) => c.name === 'source_category')) {
    raw.exec('ALTER TABLE inventory_consumption_rules ADD COLUMN source_category TEXT');
  }
  // Which category writes each table: the first consumable one, which is how
  // the old per-table picker presented it (feeds, not pumping).
  const tableCategory: Record<string, string> = {};
  for (const source of consumableCategories()) {
    if (!(source.table in tableCategory)) tableCategory[source.table] = source.id;
  }
  const rules = raw.prepare('SELECT id, source_table, conditions FROM inventory_consumption_rules').all() as Array<{
    id: number;
    source_table: string;
    conditions: string | null;
  }>;
  const update = raw.prepare('UPDATE inventory_consumption_rules SET source_category = ?, conditions = ? WHERE id = ?');
  for (const rule of rules) {
    let category: string;
    let conditions: string | null = rule.conditions;
    if (rule.source_table === 'milestones') {
      let parsed: Array<{ attr?: string; values?: string[] }> = [];
      try {
        parsed = conditions ? JSON.parse(conditions) : [];
      } catch {
        parsed = [];
      }
      const kindCondition = parsed.find((c) => c && c.attr === 'kind');
      const kinds = kindCondition?.values ?? [];
      // One kind folds into the category it always meant. Several kinds
      // cannot: no events category spans them, so the rule widens to any
      // milestone — the honest reading, rather than a condition that would
      // silently never match.
      category = kinds.length === 1 ? kinds[0]! : 'milestones';
      const rest = parsed.filter((c) => c !== kindCondition);
      // The option condition named the old `category` column; on the events
      // table it lives in the data document under the kind's option key.
      const optionKey = CATEGORIES[category as CategoryId]?.optionKey;
      for (const condition of rest) {
        if (condition.attr === 'category' && optionKey && optionKey !== 'category') {
          condition.attr = optionKey;
        }
      }
      conditions = rest.length ? JSON.stringify(rest) : null;
    } else {
      category = tableCategory[rule.source_table] ?? rule.source_table;
    }
    update.run(category, conditions, rule.id);
  }
}
