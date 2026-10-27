// namespaces.ts
// Phase A runtime lifecycle for the two databases: the registry DB client
// (open-once) and the per-family encrypted SQLite clients (cache, open,
// provision, teardown, orphan-marking). The DDL itself lives in migrations.ts;
// this module applies it at open/provision time. See
// .omo/plans/per-family-namespaces.md.
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
} from './db-core';
import { FAMILY_MIGRATIONS, REGISTRY_MIGRATIONS } from './migrations';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — avoids confusion

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

/**
 * Mark a family `abandoned` when no account routes to it any more — the state a
 * family is left in when the only account that owned it joins another one. The
 * namespace and its data are kept; only the registry row changes, so the family
 * stops being counted as live and the scheduler stops opening it. A no-op when
 * another account still routes there, or when it is already marked.
 */
export async function markFamilyAbandonedIfUnoccupied(familyId: string): Promise<boolean> {
  assertFamilyId(familyId);
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: `UPDATE families
          SET status = 'abandoned', updated_at = ?
          WHERE family_id = ? AND status = 'active'
            AND NOT EXISTS (SELECT 1 FROM user_routing r WHERE r.family_id = families.family_id)`,
    args: [new Date().toISOString(), familyId],
  });
  if (Number(res.rowsAffected ?? 0) > 0) {
    log.info('family marked abandoned, no accounts remain', {
      event: 'db_family_abandoned',
      familyId,
    });
  }
  return Number(res.rowsAffected ?? 0) > 0;
}

