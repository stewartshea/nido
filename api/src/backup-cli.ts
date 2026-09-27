// backup-cli.ts
// Entrypoint for the backup container / cron job.
//   backup   --dest DIR [--keep N]     make a snapshot, then prune old ones
//   restore  --archive FILE            decrypt + verify + install into the data dir
//   prune    --dest DIR [--keep N]     delete old archives
//
// Secrets come from the environment: NIDO_MASTER_KEY (via db-core) and the
// optional NIDO_BACKUP_PASSPHRASE for at-rest archive encryption. Non-zero
// exit on failure so CronJob and cron surfaces the error.
import { backupDataDir, pruneBackups, restoreBackup } from './backup';
import { getDataDir } from './db-core';
import { log } from './logger';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function keepOrDefault(args: string[]): number {
  const raw = flag(args, 'keep');
  const keep = raw === undefined ? Number(process.env.NIDO_BACKUP_KEEP ?? '14') : Number(raw);
  return Number.isNaN(keep) ? 14 : keep;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case 'backup': {
        const dest = flag(args, 'dest') ?? process.env.NIDO_BACKUP_DIR;
        if (!dest) throw new Error('backup needs --dest DIR or NIDO_BACKUP_DIR');
        const passphrase = process.env.NIDO_BACKUP_PASSPHRASE;
        const result = await backupDataDir({
          destinationDir: dest,
          passphrase: passphrase || undefined,
        });
        pruneBackups(dest, keepOrDefault(args));
        log.info('backup complete', {
          event: 'backup_cli_ok',
          archivePath: result.archivePath,
        });
        break;
      }
      case 'restore': {
        const archive = flag(args, 'archive');
        if (!archive) throw new Error('restore needs --archive FILE');
        const passphrase = process.env.NIDO_BACKUP_PASSPHRASE;
        const restoreDir = getDataDir();
        const result = await restoreBackup({ archivePath: archive, restoreDir, passphrase: passphrase || undefined });
        log.info('restore verified and installed', {
          event: 'restore_cli_ok',
          databases: result.databases,
          photos: result.photos,
        });
        break;
      }
      case 'prune': {
        const dest = flag(args, 'dest') ?? process.env.NIDO_BACKUP_DIR;
        if (!dest) throw new Error('prune needs --dest DIR or NIDO_BACKUP_DIR');
        pruneBackups(dest, keepOrDefault(args));
        log.info('prune done', { event: 'backup_cli_prune' });
        break;
      }
      default:
        throw new Error(`unknown command "${command}" (expected backup|restore|prune)`);
    }
  } catch (error) {
    log.error('backup CLI failed', { event: 'backup_cli_error', error });
    process.exitCode = 1;
  }
}

void main();
