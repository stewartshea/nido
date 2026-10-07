// src/backup.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveKey, openDb } from './db-core';
import { backupDataDir, pruneBackups, restoreBackup } from './backup';

const MASTER = '0123456789abcdef'.repeat(4);
const REGISTRY_INFO = 'nido:registry';

let root: string;
let dataDir: string;
let blobDir: string;
let destDir: string;

function keyedRegistry() {
  return deriveKey(MASTER, REGISTRY_INFO, REGISTRY_INFO);
}

function keyedFamily(familyId: string) {
  return deriveKey(MASTER, familyId, 'nido:db');
}

function buildFamilyDb(familyId: string, preCheckpoint: number, walOnly: number) {
  const dbPath = path.join(dataDir, 'db', `${familyId}.db`);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath, keyedFamily(familyId));
  db.raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const ins = db.raw.prepare('INSERT INTO t (v) VALUES (?)');
  for (let i = 0; i < preCheckpoint; i++) ins.run(`main-${i}`);
  db.raw.pragma('wal_checkpoint(TRUNCATE)');
  for (let i = 0; i < walOnly; i++) ins.run(`wal-${i}`);
  return db;
}

describe('backupDataDir + restoreBackup', () => {
  beforeAll(() => {
    root = mkdtempSync('nido-backup-test-');
    dataDir = path.join(root, 'data');
    blobDir = path.join(root, 'blobs');
    destDir = path.join(root, 'backups');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(blobDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });

    // A real registry: encrypted, WAL, a table + row.
    const reg = openDb(path.join(dataDir, 'registry.db'), keyedRegistry());
    reg.raw.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, v TEXT)');
    reg.raw.prepare('INSERT INTO settings (v) VALUES (?)').run('registry-row');
    reg.raw.pragma('wal_checkpoint(TRUNCATE)');
    reg.close();
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('captures WAL-only rows, blobs, and a valid manifest in a tar.gz', async () => {
    // Open family DBs and keep them open: their recent rows live only in the
    // -wal file until the connection checkpoints or closes.
    const famA = buildFamilyDb('fam-aaaalphanumeric000001', 5, 5);
    const famB = buildFamilyDb('fam-bbbalphanumeric000001', 0, 3);

    const blobBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    writeFileSync(path.join(blobDir, 'one.jpg'), blobBytes);
    const nested = path.join(blobDir, 'events');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'two.jpg'), Buffer.alloc(4096, 0xaa));

    const result = await backupDataDir({
      dataDir,
      blobDir,
      destinationDir: destDir,
      masterKeyHex: MASTER,
      now: new Date('2026-01-02T03:04:05Z'),
    });

    // Gzip magic: 1f 8b.
    const head = readFileSync(result.archivePath).subarray(0, 2);
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);

    // The manifest and blobs are in the archive.
    const dbEntries = result.manifest.entries.filter((e) => e.kind === 'database');
    const blobEntries = result.manifest.entries.filter((e) => e.kind === 'blob');
    expect(dbEntries.map((e) => e.path).sort()).toEqual(
      ['db/fam-aaaalphanumeric000001.db', 'db/fam-bbbalphanumeric000001.db', 'registry.db'].sort(),
    );
    expect(blobEntries.map((e) => e.path).sort()).toEqual(['blobs/events/two.jpg', 'blobs/one.jpg'].sort());
    expect(result.manifest.totals.blobs).toBe(2);
    expect(result.manifest.totals.databases).toBe(3);

    // No secret material in the manifest.
    const manifestText = JSON.stringify(result.manifest);
    expect(manifestText).not.toContain(MASTER);
    expect(manifestText).not.toContain(keyedRegistry());
    expect(manifestText).not.toContain(keyedFamily('fam-aaaalphanumeric000001'));

    // Each database entry has a hash and a user_version.
    for (const e of dbEntries) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.userVersion).toBeGreaterThanOrEqual(0);
    }

    // Restore, then prove rows survived, including the WAL-only ones.
    const restoreDir = path.join(root, 'restore-a');
    const restored = await restoreBackup({
      archivePath: result.archivePath,
      restoreDir,
      masterKeyHex: MASTER,
    });
    expect(restored.databases).toBe(3);
    expect(restored.blobs).toBe(2);

    const a = openDb(path.join(restoreDir, 'data', 'db', 'fam-aaaalphanumeric000001.db'), keyedFamily('fam-aaaalphanumeric000001'), {
      fileMustExist: true,
    });
    const rowsA = a.raw.prepare('SELECT count(*) c FROM t').get() as { c: number };
    expect(rowsA.c).toBe(10); // 5 main + 5 wal-only
    const b = openDb(path.join(restoreDir, 'data', 'db', 'fam-bbbalphanumeric000001.db'), keyedFamily('fam-bbbalphanumeric000001'), {
      fileMustExist: true,
    });
    const rowsB = b.raw.prepare('SELECT count(*) c FROM t').get() as { c: number };
    expect(rowsB.c).toBe(3); // all three were wal-only
    a.close();
    b.close();

    const restoredBlob = path.join(restoreDir, 'data', 'blobs', 'one.jpg');
    expect(Buffer.from(readFileSync(restoredBlob))).toEqual(Buffer.from(blobBytes));

    // The restore dir now has data/, and index entries match the archive list.
    const restoredPaths = restored.entries.map((e) => `data/${e.path}`).sort();
    expect(restoredPaths.length).toBe(dbEntries.length + blobEntries.length);

    famA.close();
    famB.close();
  }, 30_000);

  it('encrypts the archive and restores through the same passphrase', async () => {
    const famC = buildFamilyDb('fam-cccalphanumeric000001', 2, 1);

    const plain = await backupDataDir({
      dataDir,
      blobDir,
      destinationDir: destDir,
      masterKeyHex: MASTER,
      now: new Date('2026-02-03T04:05:06Z'),
    });

    const ciphered = await backupDataDir({
      dataDir,
      blobDir,
      destinationDir: destDir,
      masterKeyHex: MASTER,
      passphrase: 'correct horse battery staple',
      now: new Date('2026-02-03T04:05:06Z'),
    });

    // The ciphered archive is not a gzip stream and looks random (no magic).
    const cipheredHead = readFileSync(ciphered.archivePath).subarray(0, 2);
    expect([cipheredHead[0], cipheredHead[1]]).not.toEqual([0x1f, 0x8b]);
    expect(ciphered.archivePath).toMatch(/\.tar\.gz$/);
    expect(ciphered.manifest.encrypted).toBe(true);
    expect(plain.manifest.encrypted).toBe(false);

    // Restoring the ciphered archive requires the passphrase.
    const restoreDir = path.join(root, 'restore-c');
    await restoreBackup({
      archivePath: ciphered.archivePath,
      restoreDir,
      masterKeyHex: MASTER,
      passphrase: 'correct horse battery staple',
    });

    const c = openDb(path.join(restoreDir, 'data', 'db', 'fam-cccalphanumeric000001.db'), keyedFamily('fam-cccalphanumeric000001'), {
      fileMustExist: true,
    });
    const rowsC = c.raw.prepare('SELECT count(*) c FROM t').get() as { c: number };
    expect(rowsC.c).toBe(3);
    c.close();

    famC.close();
  }, 30_000);
});
describe('pruneBackups', () => {
  it('keeps only the N newest nido-backup archives, ignoring other files', () => {
    const dir = mkdtempSync('nido-prune-test-');
    const stamps = ['2026-01-01T00-00-00-000Z', '2026-01-02T00-00-00-000Z', '2026-01-03T00-00-00-000Z', '2026-01-04T00-00-00-000Z'];
    for (const s of stamps) writeFileSync(path.join(dir, `nido-backup-${s}.tar.gz`), 'x');
    writeFileSync(path.join(dir, 'unrelated.txt'), 'keep me');

    const removed = pruneBackups(dir, 2);

    expect(removed.sort()).toEqual([
      'nido-backup-2026-01-01T00-00-00-000Z.tar.gz',
      'nido-backup-2026-01-02T00-00-00-000Z.tar.gz',
    ]);
    expect(existsSync(path.join(dir, 'nido-backup-2026-01-03T00-00-00-000Z.tar.gz'))).toBe(true);
    expect(existsSync(path.join(dir, 'nido-backup-2026-01-04T00-00-00-000Z.tar.gz'))).toBe(true);
    expect(existsSync(path.join(dir, 'nido-backup-2026-01-01T00-00-00-000Z.tar.gz'))).toBe(false);
    expect(existsSync(path.join(dir, 'unrelated.txt'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats keep=0 as delete everything and never removes non-archives', () => {
    const dir = mkdtempSync('nido-prune-test-');
    writeFileSync(path.join(dir, 'nido-backup-2026-01-01T00-00-00-000Z.tar.gz'), 'x');
    writeFileSync(path.join(dir, 'keep.png'), 'x');
    const removed = pruneBackups(dir, 0);
    expect(removed).toEqual(['nido-backup-2026-01-01T00-00-00-000Z.tar.gz']);
    expect(existsSync(path.join(dir, 'keep.png'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
