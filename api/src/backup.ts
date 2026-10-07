// backup.ts
// Consistent, encryption-preserving backup of a Nido data directory.
//
// Why this is not `tar` over the data dir: the databases are WAL-mode
// SQLCipher files. Recent commits live in the `-wal` sidecar until a
// checkpoint, so a file-level copy can capture a torn database or silently
// drop the newest writes. Each database is instead snapshotted through
// `VACUUM INTO`, which reads a transactionally consistent view (WAL included)
// and writes a standalone file with the same cipher applied.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { deriveKey, getDataDir, getMasterKeyHex } from './db-core';
import { log } from './logger';
import { sha256File, writeTarGz, type TarEntry } from './tar';

const REGISTRY_FILE = 'registry.db';
const FAMILY_DIR = 'db';
const CIPHER_MAGIC = Buffer.from('NIDOBAK1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface BackupOptions {
  /** Where the archive is written. Created if absent. */
  destinationDir: string;
  dataDir?: string;
  blobDir?: string;
  masterKeyHex?: string;
  /** Encrypts the finished archive. Blobs inside it are already encrypted. */
  passphrase?: string;
  now?: Date;
}

export interface ManifestEntry {
  path: string;
  kind: 'database' | 'blob';
  bytes: number;
  sha256: string;
  familyId?: string;
  userVersion?: number;
  tables?: number;
}

export interface BackupManifest {
  manifestVersion: 1;
  createdAt: string;
  encrypted: boolean;
  totals: { databases: number; blobs: number; bytes: number };
  entries: ManifestEntry[];
}

export interface BackupResult {
  archivePath: string;
  manifest: BackupManifest;
}

type Raw = InstanceType<typeof Database>;

function openKeyed(dbPath: string, hexKey: string, fileMustExist: boolean): Raw {
  const raw = fileMustExist
    ? new Database(dbPath, { fileMustExist: true })
    : new Database(dbPath);
  // Order matters: cipher settings must precede the key, as in openDb().
  raw.pragma("cipher = 'sqlcipher'");
  raw.pragma('legacy = 4');
  raw.pragma(`key = "x'${hexKey}'"`);
  return raw;
}

function countTables(raw: Raw): number {
  const row = raw
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
    .get() as { c: number } | undefined;
  return row?.c ?? 0;
}

function readUserVersion(raw: Raw): number {
  const row = raw.pragma('user_version') as { user_version?: number }[] | undefined;
  return row?.[0]?.user_version ?? 0;
}

/**
 * Prove a snapshot database is sound by reopening it with the same key and
 * running integrity_check. A backup nobody has ever restored is a rumour, and
 * this is the only moment corruption is cheap to discover.
 */
export function verifySnapshot(
  destPath: string,
  hexKey: string,
  relativePath: string,
): { userVersion: number; tables: number } {
  const check = openKeyed(destPath, hexKey, true);
  try {
    const integrityRow = check.pragma('integrity_check') as { integrity_check?: string }[] | undefined;
    if (integrityRow?.[0]?.integrity_check !== 'ok') {
      throw new Error(`integrity_check failed for ${relativePath}: ${String(integrityRow?.[0]?.integrity_check)}`);
    }
    return { userVersion: readUserVersion(check), tables: countTables(check) };
  } finally {
    check.close();
  }
}

/**
 * Snapshot one database and prove the copy is sound.
 */
async function snapshotDatabase(
  sourcePath: string,
  destPath: string,
  hexKey: string,
  relativePath: string,
  familyId: string | undefined,
): Promise<ManifestEntry> {
  const source = openKeyed(sourcePath, hexKey, true);
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    // VACUUM INTO refuses to overwrite, which is what we want for a fresh
    // staging path. It is the only snapshot route that works here: this
    // SQLCipher fork rejects the online backup() API as "incompatible source
    // and target databases".
    source.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  const verified = verifySnapshot(destPath, hexKey, relativePath);

  return {
    path: relativePath,
    kind: 'database',
    bytes: fs.statSync(destPath).size,
    sha256: await sha256File(destPath),
    familyId,
    userVersion: verified.userVersion,
    tables: verified.tables,
  };
}

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function encryptFile(source: string, dest: string, passphrase: string): void {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = fs.readFileSync(source);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  fs.writeFileSync(dest, Buffer.concat([CIPHER_MAGIC, salt, iv, cipher.getAuthTag(), encrypted]));
  if (dest !== source) fs.rmSync(source, { force: true });
}

export function decryptFile(source: string, dest: string, passphrase: string): void {
  const raw = fs.readFileSync(source);
  const header = CIPHER_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (raw.subarray(0, CIPHER_MAGIC.length).compare(CIPHER_MAGIC) !== 0) {
    throw new Error('not a Nido encrypted backup (bad magic)');
  }
  let offset = CIPHER_MAGIC.length;
  const salt = raw.subarray(offset, (offset += SALT_BYTES));
  const iv = raw.subarray(offset, (offset += IV_BYTES));
  const tag = raw.subarray(offset, (offset += TAG_BYTES));
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  fs.writeFileSync(dest, Buffer.concat([decipher.update(raw.subarray(offset)), decipher.final()]));
}

export interface RestoreOptions {
  archivePath: string;
  /** Where registry.db, db/ and blobs/ land after extraction. */
  restoreDir: string;
  masterKeyHex?: string;
  passphrase?: string;
}

export interface RestoreResult {
  databases: number;
  blobs: number;
  entries: ManifestEntry[];
}

/**
 * Decrypt (if passphrased), extract, and verify a backup archive. Verification
 * reopens every restored database with its derived key and runs
 * integrity_check, so a restore is proven before the original is touched.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const masterKeyHex = options.masterKeyHex ?? getMasterKeyHex();
  const started = Date.now();
  fs.mkdirSync(options.restoreDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(options.restoreDir, '.restore-'));

  try {
    let source = options.archivePath;
    if (options.passphrase) {
      const plain = path.join(workDir, 'backup.tar.gz');
      decryptFile(options.archivePath, plain, options.passphrase);
      source = plain;
    }

    const { execFile } = await import('node:child_process');
    try {
      const proc = await execFile('tar', ['-xzf', source, '-C', workDir], { timeout: 300_000 });
      for (const stream of [proc.stdout, proc.stderr]) {
        if (!stream) continue;
        for await (const _ of stream) {
        }
      }
    } catch (error) {
      throw new Error(`tar extraction failed (is GNU/BSD tar installed?): ${String(error)}`);
    }

    const manifestPath = path.join(workDir, 'MANIFEST.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('MANIFEST.json missing from archive — not a Nido backup');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

    for (const entry of manifest.entries) {
      if (entry.kind !== 'database') continue;
      const hexKey =
        entry.path === REGISTRY_FILE
          ? deriveKey(masterKeyHex, 'nido:registry', 'nido:registry')
          : deriveKey(masterKeyHex, entry.familyId ?? '', 'nido:db');
      verifySnapshot(path.join(workDir, entry.path), hexKey, entry.path);
    }

    const staged = path.join(workDir, 'data');
    fs.mkdirSync(staged, { recursive: true });
    for (const entry of manifest.entries) {
      const from = path.join(workDir, entry.path);
      const to = path.join(staged, entry.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }

    const databases = manifest.entries.filter((e) => e.kind === 'database').length;
    const blobs = manifest.entries.filter((e) => e.kind === 'blob').length;
    log.info('restore verified', {
      event: 'restore_verified',
      databases,
      blobs,
      durationMs: Date.now() - started,
    });

    // Move the staged `data/` into place only after every check passed, so a
    // corrupt archive never wipes what it was meant to replace.
    const finalDataDir = path.join(options.restoreDir, 'data');
    fs.rmSync(finalDataDir, { recursive: true, force: true });
    fs.renameSync(staged, finalDataDir);

    return { databases, blobs, entries: manifest.entries };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Back up every database and blob under the data directory into a single
 * gzipped tar. The archive is self-describing via an embedded MANIFEST.json.
 */
export async function backupDataDir(options: BackupOptions): Promise<BackupResult> {
  const started = Date.now();
  const dataDir = options.dataDir ?? getDataDir();
  const blobDir = options.blobDir ?? process.env.NIDO_BLOB_DIR ?? path.join(dataDir, 'blobs');
  const masterKeyHex = options.masterKeyHex ?? getMasterKeyHex();
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');

  const stageDir = path.join(options.destinationDir, `.stage-${stamp}`);
  fs.mkdirSync(stageDir, { recursive: true });

  const entries: ManifestEntry[] = [];
  const tarEntries: TarEntry[] = [];

  try {
    // Registry first: it routes every family, so losing it orphans all the
    // rest even if the per-family files survive.
    const registrySrc = path.join(dataDir, REGISTRY_FILE);
    if (fs.existsSync(registrySrc)) {
      const rel = REGISTRY_FILE;
      const dest = path.join(stageDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      entries.push(
        await snapshotDatabase(
          registrySrc,
          dest,
          deriveKey(masterKeyHex, 'nido:registry', 'nido:registry'),
          rel,
          undefined,
        ),
      );
      tarEntries.push({ name: rel, sourcePath: dest, size: fs.statSync(dest).size });
    }

    const familyRoot = path.join(dataDir, FAMILY_DIR);
    const familyFiles = fs.existsSync(familyRoot)
      ? fs.readdirSync(familyRoot).filter((f) => f.endsWith('.db')).sort()
      : [];
    for (const file of familyFiles) {
      const familyId = file.slice(0, -'.db'.length);
      const rel = `${FAMILY_DIR}/${file}`;
      const dest = path.join(stageDir, rel);
      // Salt is the familyId and info is the shared 'nido:db' label — both
      // must match db-namespaces.ts or the snapshot will not open.
      entries.push(
        await snapshotDatabase(
          path.join(familyRoot, file),
          dest,
          deriveKey(masterKeyHex, familyId, 'nido:db'),
          rel,
          familyId,
        ),
      );
      tarEntries.push({ name: rel, sourcePath: dest, size: fs.statSync(dest).size });
    }

    // Blobs are the encrypted bytes behind every attachment and avatar. They are
    // already encrypted under the master key, so they are copied as-is — the
    // archive's own encryption is a second layer, not a replacement.
    for (const file of collectFiles(blobDir)) {
      const rel = `blobs/${path.relative(blobDir, file).split(path.sep).join('/')}`;
      const dest = path.join(stageDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      entries.push({
        path: rel,
        kind: 'blob',
        bytes: fs.statSync(dest).size,
        sha256: await sha256File(dest),
      });
      tarEntries.push({ name: rel, sourcePath: dest, size: fs.statSync(dest).size });
    }

    const manifest: BackupManifest = {
      manifestVersion: 1,
      createdAt: now.toISOString(),
      encrypted: Boolean(options.passphrase),
      totals: {
        databases: entries.filter((e) => e.kind === 'database').length,
        blobs: entries.filter((e) => e.kind === 'blob').length,
        bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
      },
      entries,
    };

    // The manifest records paths, sizes and hashes only. NIDO_MASTER_KEY must
    // never reach a backup or a log line; it is stored separately, as
    // db-core.ts already warns.
    const manifestPath = path.join(stageDir, 'MANIFEST.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    tarEntries.push({
      name: 'MANIFEST.json',
      sourcePath: manifestPath,
      size: fs.statSync(manifestPath).size,
    });

    const archivePath = path.join(options.destinationDir, `nido-backup-${stamp}.tar.gz`);
    await writeTarGz(tarEntries, archivePath);
    if (options.passphrase) encryptFile(archivePath, archivePath, options.passphrase);

    log.info('backup complete', {
      event: 'backup_complete',
      archivePath,
      databases: manifest.totals.databases,
      blobs: manifest.totals.blobs,
      bytes: manifest.totals.bytes,
      encrypted: manifest.encrypted,
      durationMs: Date.now() - started,
    });

    return { archivePath, manifest };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

export const BACKUP_GLOB = /^nido-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.tar\.gz$/;

/**
 * Delete the oldest `nido-backup-*.tar.gz` files, keeping only the `keep`
 * newest, so an unattended cron job cannot fill its volume. Returns the
 * archives that were removed.
 */
export function pruneBackups(backupDir: string, keep: number): string[] {
  const archives = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isFile() && BACKUP_GLOB.test(e.name))
    .map((e) => ({ name: e.name, mtime: statMtime(path.join(backupDir, e.name)) }))
    .sort((a, b) => a.mtime - b.mtime);

  const doomed = archives.slice(0, Math.max(0, archives.length - keep));
  for (const entry of doomed) {
    fs.rmSync(path.join(backupDir, entry.name), { force: true });
  }
  if (doomed.length > 0) {
    log.info('pruned old backups', {
      event: 'backup_prune',
      removed: doomed.map((d) => d.name),
      kept: archives.length - doomed.length,
    });
  }
  return doomed.map((d) => d.name);
}

function statMtime(filePath: string): number {
  return fs.statSync(filePath).mtime.getTime();
}
