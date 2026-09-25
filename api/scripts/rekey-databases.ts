/**
 * Re-encrypt every per-family database and the registry under a new
 * key-derivation scheme, in place.
 *
 * Needed whenever a key-derivation input changes (HKDF salt/info, or the
 * master key itself). Because those inputs decide the SQLCipher raw key,
 * changing one makes existing files undecryptable; this script opens each file
 * with the OLD derived key and rewrites it with the NEW one.
 *
 * The previous scheme is supplied entirely through CLI flags, so this file
 * contains no hardcoded legacy values.
 *
 * Usage:
 *   npx tsx scripts/rekey-databases.ts \
 *     --data-dir ./data \
 *     --from-master-key <64-hex> \
 *     --from-db-info <old-info> \
 *     --from-registry-salt <old-salt> \
 *     --from-registry-info <old-info>
 *
 * Defaults describe the CURRENT scheme, so a dry run needs only --data-dir
 * plus the old master key. Add --dry-run to verify without writing.
 *
 * Stop the API first. This rewrites the primary database files in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { hkdfSync } from 'node:crypto';

interface Args {
  dataDir: string;
  fromMasterKey: string;
  fromDbInfo: string;
  fromRegistrySalt: string;
  fromRegistryInfo: string;
  toMasterKey: string;
  toDbInfo: string;
  toRegistrySalt: string;
  toRegistryInfo: string;
  dryRun: boolean;
}

const CURRENT = {
  dbInfo: 'nido:db',
  registrySalt: 'nido:registry',
  registryInfo: 'nido:registry',
};

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required flag --${name}`);
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const args: Args = {
    dataDir: get('data-dir', process.env.NIDO_DATA_DIR ?? './data'),
    fromMasterKey: get('from-master-key'),
    fromDbInfo: get('from-db-info'),
    fromRegistrySalt: get('from-registry-salt'),
    fromRegistryInfo: get('from-registry-info'),
    toMasterKey: get('to-master-key', process.env.NIDO_MASTER_KEY ?? ''),
    toDbInfo: get('to-db-info', CURRENT.dbInfo),
    toRegistrySalt: get('to-registry-salt', CURRENT.registrySalt),
    toRegistryInfo: get('to-registry-info', CURRENT.registryInfo),
    dryRun: has('dry-run'),
  };

  if (!/^[0-9a-fA-F]{2,}$/.test(args.fromMasterKey)) {
    throw new Error(
      `--from-master-key must be a hex string (got ${JSON.stringify(args.fromMasterKey)})`,
    );
  }
  for (const [flag, value] of [
    ['from-db-info', args.fromDbInfo],
    ['from-registry-salt', args.fromRegistrySalt],
    ['from-registry-info', args.fromRegistryInfo],
  ]) {
    if (!value) throw new Error(`--${flag} must not be empty`);
  }

  // Default the target master key to the source when only re-deriving salts.
  if (!args.toMasterKey) args.toMasterKey = args.fromMasterKey;
  if (!/^[0-9a-fA-F]{2,}$/.test(args.toMasterKey)) {
    throw new Error('--to-master-key must be a hex string');
  }

  return args;
}

function deriveKey(masterKeyHex: string, salt: string, info: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(masterKeyHex, 'hex'), salt, info, 32),
  ).toString('hex');
}

function openWithKey(dbPath: string, hexKey: string, fileMustExist: boolean) {
  const db = new Database(dbPath, fileMustExist ? { fileMustExist: true } : {});
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${hexKey}'"`);
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Confirms the key actually opens the file by reading its schema. */
function assertDecryptable(db: Database.Database, label: string): void {
  try {
    db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
  } catch (err) {
    throw new Error(
      `${label}: cannot decrypt with the supplied key (${(err as Error).message}). ` +
        'Check --from-master-key and the --from-* derivation inputs.',
    );
  }
}

function rekeyOne(
  label: string,
  dbPath: string,
  fromKey: string,
  toKey: string,
  dryRun: boolean,
): void {
  if (!fs.existsSync(dbPath)) {
    console.log(`  skip  ${label} (missing)`);
    return;
  }
  const db = openWithKey(dbPath, fromKey, true);
  try {
    assertDecryptable(db, label);
    if (dryRun) {
      console.log(`  ok    ${label} (decrypts; not written, --dry-run)`);
      return;
    }
    // Fold the WAL back into the main file so the rekeyed file is complete.
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma(`rekey = "x'${toKey}'"`);
    console.log(`  rekey ${label}`);
  } finally {
    db.close();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dbDir = path.join(args.dataDir, 'db');

  console.log(`data dir : ${args.dataDir}`);
  console.log(`mode     : ${args.dryRun ? 'DRY RUN (no writes)' : 'IN-PLACE REWRITE'}`);
  console.log('');

  console.log('registry.db');
  rekeyOne(
    'registry.db',
    path.join(args.dataDir, 'registry.db'),
    deriveKey(args.fromMasterKey, args.fromRegistrySalt, args.fromRegistryInfo),
    deriveKey(args.toMasterKey, args.toRegistrySalt, args.toRegistryInfo),
    args.dryRun,
  );

  console.log('');
  console.log('family databases');
  const familyIds = fs.existsSync(dbDir)
    ? fs
        .readdirSync(dbDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => f.slice(0, -'.db'.length))
        .sort()
    : [];
  if (familyIds.length === 0) console.log('  (none)');
  for (const familyId of familyIds) {
    rekeyOne(
      `${familyId}.db`,
      path.join(dbDir, `${familyId}.db`),
      deriveKey(args.fromMasterKey, familyId, args.fromDbInfo),
      deriveKey(args.toMasterKey, familyId, args.toDbInfo),
      args.dryRun,
    );
  }

  console.log('');
  console.log(args.dryRun ? 'Dry run complete.' : 'Rekey complete. Verify the app starts before discarding backups.');
}

main();
