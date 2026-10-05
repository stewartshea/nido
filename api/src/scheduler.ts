import { getRegistryClient } from './db-namespaces';
import { runFamilyDigest } from './notifications';
import { log } from './logger';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Periodic notification digests, in-process in the API container.
 *
 * A self-hosted install is one API container and one volume, so a timer is the
 * whole feature. What that timer must not become is a per-replica timer, because
 * the second replica to pick up a new replica count would send the same email
 * twice. Two guards: a lease row in the shared registry stops two processes that
 * can see each other, and NOTIFY_ENABLED exists for the case where they cannot.
 *
 * The seam for scaling further is runDigestSweep and runFamilyDigest — a queue
 * consumer would call the latter per job and drop the timer entirely.
 */

const LEASE_NAME = 'inventory-notification-digest';

export interface SchedulerConfig {
	enabled: boolean;
	intervalMs: number;
	/** How long a crashed holder blocks the next attempt. */
	leaseMs: number;
}

const DEFAULT_INTERVAL_MINUTES = 60;

export const schedulerHolder = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
	if (raw === undefined || raw.trim() === '') return fallback;
	const v = raw.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(v)) return true;
	if (['0', 'false', 'no', 'off'].includes(v)) return false;
	return fallback;
}

/**
 * A malformed value must not stop the API from booting, so anything
 * unparseable falls back to the default and says so in the log.
 */
function readMinutes(name: string, raw: string | undefined, fallbackMinutes: number): number {
	if (raw === undefined || raw.trim() === '') return fallbackMinutes;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		log.warn('ignoring unparseable scheduler setting', { event: 'scheduler_config_invalid', setting: name, value: raw });
		return fallbackMinutes;
	}
	return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): SchedulerConfig {
	const intervalMinutes = readMinutes('NOTIFY_INTERVAL_MINUTES', env.NOTIFY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES);
	const intervalMs = Math.max(1, Math.round(intervalMinutes * 60_000));
	return {
		enabled: readBoolean(env.NOTIFY_ENABLED, true),
		intervalMs,
		// Twice the interval so a sweep that overruns is never cut short, while a
		// process that dies holding the lease is superseded within two ticks.
		leaseMs: Math.max(intervalMs * 2, 10 * 60_000),
	};
}

async function acquireLease(registry: any, holder: string, leaseMs: number, nowMs: number): Promise<boolean> {
	const now = new Date(nowMs).toISOString();
	const res = await registry.execute({
		sql: `INSERT INTO scheduler_leases (name, holder, acquired_at, expires_at)
		      VALUES (?, ?, ?, ?)
		      ON CONFLICT(name) DO UPDATE SET
		        holder = excluded.holder,
		        acquired_at = excluded.acquired_at,
		        expires_at = excluded.expires_at
		      WHERE scheduler_leases.expires_at <= ? OR scheduler_leases.holder = ?`,
		args: [LEASE_NAME, holder, now, new Date(nowMs + leaseMs).toISOString(), now, holder],
	});
	return Number(res.rowsAffected ?? 0) > 0;
}

async function releaseLease(registry: any, holder: string, nowMs: number): Promise<void> {
	await registry.execute({
		sql: 'UPDATE scheduler_leases SET expires_at = ? WHERE name = ? AND holder = ?',
		args: [new Date(nowMs).toISOString(), LEASE_NAME, holder],
	});
}

export async function listActiveFamilies(): Promise<string[]> {
	const registry = await getRegistryClient();
	const rows = (await registry.execute({
		sql: "SELECT family_id FROM families WHERE status = 'active' ORDER BY family_id",
		args: [],
	})).rows as any[];
	return rows.map((r) => String(r.family_id));
}

export interface SweepResult {
	skipped?: 'disabled' | 'in-progress' | 'lease-held';
	families: number;
	/** Families with something firing, whether or not it had already been emailed. */
	firing: number;
	/** Digests actually emailed in this sweep. */
	sent: number;
	failed: number;
	errors: number;
}

let sweeping = false;

export async function runDigestSweep(
	opts: { config?: SchedulerConfig; holder?: string; nowMs?: number } = {},
): Promise<SweepResult> {
	const config = opts.config ?? readConfig();
	const holder = opts.holder ?? schedulerHolder;
	const empty: SweepResult = { families: 0, firing: 0, sent: 0, failed: 0, errors: 0 };

	if (!config.enabled) return { ...empty, skipped: 'disabled' };
	// A slow sweep must not overlap itself and double-send inside one process.
	if (sweeping) return { ...empty, skipped: 'in-progress' };
	sweeping = true;

	try {
		const registry = await getRegistryClient();
		const nowMs = opts.nowMs ?? Date.now();
		if (!await acquireLease(registry, holder, config.leaseMs, nowMs)) {
			log.debug('notification sweep skipped, lease held elsewhere', { event: 'scheduler_lease_held' });
			return { ...empty, skipped: 'lease-held' };
		}

		try {
			const families = await listActiveFamilies();
			const summary: SweepResult = { ...empty, families: families.length };
			for (const familyId of families) {
				// One family's failure must never strand the rest of the sweep.
				try {
					const outcome = await runFamilyDigest(familyId, { logger: log });
					if (outcome.firing > 0) summary.firing += 1;
					if (outcome.sent > 0) summary.sent += 1;
					if (outcome.failed.length > 0) summary.failed += 1;
				} catch (err: any) {
					summary.errors += 1;
					log.error('notification digest failed for family', { event: 'scheduler_family_failed', familyId, err });
				}
			}
			log.info('notification sweep complete', {
				event: 'scheduler_sweep', families: summary.families,
				firing: summary.firing, sent: summary.sent, failed: summary.failed, errors: summary.errors,
			});
			return summary;
		} finally {
			await releaseLease(registry, holder, Date.now());
		}
	} finally {
		sweeping = false;
	}
}

let intervalTimer: NodeJS.Timeout | null = null;
let graceTimer: NodeJS.Timeout | null = null;
let activeConfig: SchedulerConfig | null = null;

export function startScheduler(env: NodeJS.ProcessEnv = process.env): void {
	const config = readConfig(env);
	if (intervalTimer) return;
	if (!config.enabled) {
		log.info('notification scheduler disabled', { event: 'scheduler_disabled' });
		return;
	}
	activeConfig = config;
	// Grace period so the sweep never competes with boot migrations for the DB.
	graceTimer = setTimeout(() => { void runDigestSweep({ config }).catch(() => {}); }, 15_000);
	intervalTimer = setInterval(() => { void runDigestSweep({ config }).catch(() => {}); }, config.intervalMs);
	// Never hold the process open on the timer's account.
	graceTimer.unref?.();
	intervalTimer.unref?.();
	log.info('notification scheduler started', {
		event: 'scheduler_started',
		intervalMinutes: Math.round(config.intervalMs / 60_000),
		holder: schedulerHolder,
	});
}

export function stopScheduler(): void {
	if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
	if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
	if (activeConfig) {
		log.info('notification scheduler stopped', { event: 'scheduler_stopped', holder: schedulerHolder });
		activeConfig = null;
	}
}

/** What the UI needs to tell the truth about its own schedule. */
export function schedulerStatus(): { enabled: boolean; running: boolean; intervalMinutes: number } {
	const config = activeConfig ?? readConfig();
	return {
		enabled: config.enabled,
		running: intervalTimer !== null,
		intervalMinutes: Math.round(config.intervalMs / 60_000),
	};
}

/** Test seam: the re-entrancy guard is module state. */
export function __resetSweepGuard(): void { sweeping = false; }
