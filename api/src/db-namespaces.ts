// db-namespaces.ts
// Phase A: SQLCipher-encrypted per-family SQLite namespaces plus the global
// registry DB (email -> familyId/userId routing, instance settings, platform
// admin flag). Built on db-core; consumed by later phases (auth, routes,
// provisioning). See .omo/plans/per-family-namespaces.md.
import fs from 'node:fs';
import path from 'node:path';
import { randomFillSync } from 'node:crypto';
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
];

// ---------------------------------------------------------------------------
// Clients
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
  if (familyClients.size >= 16) {
    const oldest = familyClients.keys().next().value;
    if (oldest !== undefined) {
      familyClients.get(oldest)?.close();
      familyClients.delete(oldest);
    }
  }
  familyClients.set(familyId, client);
  return client;
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
}