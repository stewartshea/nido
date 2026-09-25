// db-core.ts
// Shared SQLite plumbing for Nido's per-family namespace strategy.
//
// Phase A foundation (.omo/plans/per-family-namespaces.md):
//   - better-sqlite3-multiple-ciphers replaces @libsql/client (Turso dropped).
//   - Each family gets its own SQLCipher-encrypted SQLite file.
//   - SqliteFacade mirrors the libsql execute() shape so existing route code
//     keeps working against the legacy single-file handle while it is swept
//     onto namespaces in later phases.
//
// This module is a dependency leaf: db-namespaces.ts (registry + family
// clients) imports from here.
import Database from 'better-sqlite3-multiple-ciphers';
import { hkdfSync } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

// The household row that scopes every record inside a family namespace DB.
// Legacy code used variable household ids; a namespace DB is one family, so
// every record hard-pins to this singleton household.
export const NAMESPACE_HOUSEHOLD_ID = 1;

// Opaque, server-generated family identifier carried in the JWT, used as the
// DB filename and path parameter. Never derived from user input.
export const FAMILY_ID_RE = /^[A-Za-z0-9-]{10,64}$/;

const MAX_FAMILY_CLIENTS = 16;

// ---------------------------------------------------------------------------
// Master key + HKDF key derivation
// ---------------------------------------------------------------------------
// Dev-only fallback so tests / local dev keep working without env. Family
// files would be encrypted with a known key — never acceptable in production.
//
// DO NOT CHANGE 'nido-dev-insecure-key' without a re-encryption migration. It
// is a key-derivation input, not branding: altering it changes every derived
// subkey, so any database already written with it becomes undecryptable.
const DEV_FALLBACK_MASTER_KEY = Buffer.from('nido-dev-insecure-key', 'utf8').toString('hex');

let cachedMasterKey: string | null = null;

export function getMasterKeyHex(): string {
  if (cachedMasterKey) return cachedMasterKey;
  // Changing this env var name does not break stored data (the master key is
  // whatever hex is supplied), but a deployment still setting the old name
  // would silently fall through to the insecure dev fallback below. Rename it
  // in the manifest and the environment together, never one alone.
  const env = process.env.NIDO_MASTER_KEY?.trim();
  if (env && /^[0-9a-fA-F]+$/.test(env)) {
    cachedMasterKey = env.toLowerCase();
    return cachedMasterKey;
  }
  if (env) {
    throw new Error(
      'NIDO_MASTER_KEY must be a hex string (generate with: openssl rand -hex 32)',
    );
  }
  console.warn(
    '[nido] NIDO_MASTER_KEY is not set — using an INSECURE development fallback key. ' +
      'Family databases would be encrypted with a known key. Set it in production (openssl rand -hex 32).',
  );
  cachedMasterKey = DEV_FALLBACK_MASTER_KEY;
  return cachedMasterKey;
}

export function getDataDir(): string {
  // Point this at a persisted volume in production; the default './data' is
  // container-local and is lost on recreate.
  return process.env.NIDO_DATA_DIR || './data';
}

// HKDF-SHA256 -> 32-byte SQLCipher raw key (64 lowercase hex). Distinct
// namespaces/uses derive distinct keys from the single master key via the
// info parameter, so one exposed subkey never compromises the others.
//
// DO NOT CHANGE the default info 'nido:db'. It is a key-derivation input:
// changing it re-derives every family subkey and makes existing databases
// undecryptable.
export function deriveKey(masterKeyHex: string, salt: string, info = 'nido:db'): string {
  const okm = hkdfSync('sha256', Buffer.from(masterKeyHex, 'hex'), salt, info, 32);
  // Node 25 returns an ArrayBuffer — wrap so .toString('hex') yields the key.
  return Buffer.from(okm).toString('hex');
}

export function assertFamilyId(familyId: string): void {
  if (!FAMILY_ID_RE.test(familyId)) {
    throw new Error(`Invalid familyId "${familyId}" — expected ${FAMILY_ID_RE}`);
  }
}

// ---------------------------------------------------------------------------
// Libsql-compatible facade over better-sqlite3
// ---------------------------------------------------------------------------
export type SqlRequest = { sql: string; args?: unknown[] };

export interface ResultSet {
  rows: Record<string, unknown>[];
  columns: string[];
  rowsAffected: number;
  lastInsertRowid: number;
  duration: number;
}

export type RawDatabase = InstanceType<typeof Database>;

export interface OpenDbOptions {
  fileMustExist?: boolean;
  /** Enable WAL journal mode. Defaults to true for encrypted namespaces. */
  wal?: boolean;
}

export class SqliteFacade {
  readonly raw: RawDatabase;

  constructor(raw: RawDatabase) {
    this.raw = raw;
  }

  async execute(request: string | SqlRequest): Promise<ResultSet> {
    const { sql, args } = typeof request === 'string' ? { sql: request, args: [] } : request;
    const params = args ?? [];
    const trimmed = sql.trimStart();

    // PRAGMA cannot be prepared normally in every fork build — route it
    // through the driver's pragma() helper, which returns row objects.
    if (/^PRAGMA\b/i.test(trimmed)) {
      const rows = this.raw.pragma(trimmed.replace(/^PRAGMA\s+/i, '')) as Record<
        string,
        unknown
      >[];
      return {
        rows,
        columns: rows.length ? Object.keys(rows[0] ?? {}) : [],
        rowsAffected: 0,
        lastInsertRowid: 0,
        duration: 0,
      };
    }

    const stmt = this.raw.prepare(sql);

    // Read-shaped statements return rows; everything else is a mutation that
    // reports changes + lastInsertRowid (the shape routes rely on).
    if (/^(SELECT|WITH|EXPLAIN)\b/i.test(trimmed) || /\bRETURNING\b/i.test(sql)) {
      const rows = params.length ? stmt.all(...params) : stmt.all();
      return {
        rows: rows as Record<string, unknown>[],
        columns: stmt.columns().map((c) => c.name),
        rowsAffected: 0,
        lastInsertRowid: 0,
        duration: 0,
      };
    }

    const info = params.length ? stmt.run(...params) : stmt.run();
    return {
      rows: [],
      columns: [],
      rowsAffected: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid),
      duration: 0,
    };
  }

  // Mirrors libsql's async transaction(fn). No legacy call sites exist; kept
  // correct for the async facade so later phases can use it safely.
  async transaction<T>(fn: (tx: SqliteFacade) => Promise<T>): Promise<T> {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(this);
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}

/**
 * Open a SQLite file. When hexKey is provided the file is opened as an
 * SQLCipher database using the raw 64-hex key (cipher=sqlcipher, legacy=4).
 */
export function openDb(
  dbPath: string,
  hexKey?: string | null,
  options: OpenDbOptions = {},
): SqliteFacade {
  const raw =
    options.fileMustExist === true
      ? new Database(dbPath, { fileMustExist: true })
      : new Database(dbPath);
  if (hexKey) {
    raw.pragma("cipher = 'sqlcipher'");
    raw.pragma('legacy = 4');
    raw.pragma(`key = "x'${hexKey}'"`);
  }
  if (options.wal ?? Boolean(hexKey)) {
    raw.pragma('journal_mode = WAL');
  }
  raw.pragma('busy_timeout = 5000');
  return new SqliteFacade(raw);
}

// ---------------------------------------------------------------------------
// Versioned migrations, gated by PRAGMA user_version
// ---------------------------------------------------------------------------
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Apply migrations whose version is above the DB's current user_version.
 * Each migration runs in its own transaction; failure rolls back and throws.
 * Sync, because better-sqlite3 is sync — safe to call from async contexts.
 */
export function runMigrations(raw: RawDatabase, migrations: readonly Migration[]): void {
  const row = raw.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  let current = row?.user_version ?? 0;
  for (const m of migrations) {
    if (m.version <= current) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(m.sql);
      raw.pragma(`user_version = ${m.version}`);
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
    current = m.version;
  }
}