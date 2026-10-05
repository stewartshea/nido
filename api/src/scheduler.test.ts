import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureRegistry, getRegistryClient } from './db-namespaces';
import { runFamilyDigest } from './notifications';
import { readConfig, runDigestSweep, listActiveFamilies, __resetSweepGuard } from './scheduler';

vi.mock('./notifications', () => ({
	runFamilyDigest: vi.fn(),
}));

const digest = vi.mocked(runFamilyDigest);

async function addFamily(familyId: string, status = 'active'): Promise<void> {
	const registry = await getRegistryClient();
	await registry.execute({
		sql: 'INSERT OR REPLACE INTO families (family_id, name, status) VALUES (?, ?, ?)',
		args: [familyId, familyId, status],
	});
}

function quiet(firing = 0, sent = 0) {
	return { familyId: 'x', firing, alerts: firing, sent, failed: [], message: 'ok' } as any;
}

beforeEach(async () => {
	digest.mockReset();
	digest.mockResolvedValue(quiet());
	__resetSweepGuard();
	// The registry is shared across every test in this file, and a lease left
	// behind by one test would otherwise veto all the others.
	const registry = await getRegistryClient();
	await registry.execute({ sql: 'DELETE FROM scheduler_leases', args: [] });
});

describe('readConfig', () => {
	it('defaults to enabled on the hour', () => {
		const config = readConfig({} as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(true);
		expect(config.intervalMs).toBe(60 * 60_000);
	});

	it('honours an explicit interval', () => {
		expect(readConfig({ NOTIFY_INTERVAL_MINUTES: '5' } as NodeJS.ProcessEnv).intervalMs).toBe(5 * 60_000);
	});

	it.each(['false', '0', 'off', 'no'])('treats %s as disabled', (value) => {
		expect(readConfig({ NOTIFY_ENABLED: value } as NodeJS.ProcessEnv).enabled).toBe(false);
	});

	it.each(['1', 'true', 'on', 'yes'])('treats %s as enabled', (value) => {
		expect(readConfig({ NOTIFY_ENABLED: value } as NodeJS.ProcessEnv).enabled).toBe(true);
	});

	it('falls back rather than crash on an unparseable interval', () => {
		expect(readConfig({ NOTIFY_INTERVAL_MINUTES: 'soon' } as NodeJS.ProcessEnv).intervalMs).toBe(60 * 60_000);
		expect(readConfig({ NOTIFY_INTERVAL_MINUTES: '-5' } as NodeJS.ProcessEnv).intervalMs).toBe(60 * 60_000);
	});

	it('gives a lease longer than one interval, so a slow sweep is never cut short', () => {
		const config = readConfig({ NOTIFY_INTERVAL_MINUTES: '30' } as NodeJS.ProcessEnv);
		expect(config.leaseMs).toBeGreaterThan(config.intervalMs);
	});
});

describe('listActiveFamilies', () => {
	it('returns only active families', async () => {
		await addFamily('fam-active');
		await addFamily('fam-suspended', 'suspended');
		expect(await listActiveFamilies()).toContain('fam-active');
		expect(await listActiveFamilies()).not.toContain('fam-suspended');
	});
});

describe('runDigestSweep', () => {
	it('does nothing when disabled', async () => {
		const result = await runDigestSweep({ config: readConfig({ NOTIFY_ENABLED: 'false' } as NodeJS.ProcessEnv) });
		expect(result.skipped).toBe('disabled');
		expect(digest).not.toHaveBeenCalled();
	});

	it('visits every active family', async () => {
		await addFamily('fam-one');
		await addFamily('fam-two');
		const result = await runDigestSweep({ holder: 'holder-a' });
		expect(result.skipped).toBeUndefined();
		expect(result.families).toBeGreaterThanOrEqual(2);
		const visited = digest.mock.calls.map((c) => c[0]);
		expect(visited).toContain('fam-one');
		expect(visited).toContain('fam-two');
	});

	it('keeps going when one family throws, so one bad tenant cannot stall the rest', async () => {
		await addFamily('fam-bad');
		await addFamily('fam-good');
		digest.mockImplementation(async (familyId: string) => {
			if (familyId === 'fam-bad') throw new Error('database is locked');
			return quiet(1, 1);
		});

		const result = await runDigestSweep({ holder: 'holder-errors' });

		expect(result.errors).toBe(1);
		expect(result.sent).toBeGreaterThanOrEqual(1);
		expect(digest.mock.calls.map((c) => c[0])).toContain('fam-good');
	});

	it('counts a family with something firing even when nothing needed emailing', async () => {
		await addFamily('fam-quiet');
		digest.mockResolvedValue(quiet(3, 0));
		const result = await runDigestSweep({ holder: 'holder-firing' });
		expect(result.firing).toBeGreaterThanOrEqual(1);
		expect(result.sent).toBe(0);
	});

	it('refuses a second holder while the lease is live, so replicas cannot double-send', async () => {
		await addFamily('fam-lease');
		const now = Date.now();

		const first = await runDigestSweep({ holder: 'replica-1', nowMs: now });
		expect(first.skipped).toBeUndefined();

		// A second replica tries while replica-1's lease is still valid. Inserting
		// a live lease by hand is what a concurrent process would find.
		const registry = await getRegistryClient();
		await registry.execute({
			sql: 'UPDATE scheduler_leases SET holder = ?, acquired_at = ?, expires_at = ? WHERE name = ?',
			args: ['replica-1', new Date(now).toISOString(), new Date(now + 3_600_000).toISOString(), 'inventory-notification-digest'],
		});

		digest.mockClear();
		const second = await runDigestSweep({ holder: 'replica-2', nowMs: now + 1_000 });
		expect(second.skipped).toBe('lease-held');
		expect(digest).not.toHaveBeenCalled();
	});

	it('takes over a lease left behind by a process that died', async () => {
		await addFamily('fam-stale');
		const registry = await getRegistryClient();
		const now = Date.now();
		await registry.execute({
			sql: 'INSERT OR REPLACE INTO scheduler_leases (name, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
			args: ['inventory-notification-digest', 'dead-process', new Date(now - 7_200_000).toISOString(), new Date(now - 3_600_000).toISOString()],
		});

		const result = await runDigestSweep({ holder: 'replica-3', nowMs: now });
		expect(result.skipped).toBeUndefined();

		const row = (await registry.execute({ sql: 'SELECT holder FROM scheduler_leases WHERE name = ?', args: ['inventory-notification-digest'] })).rows[0] as any;
		expect(row.holder).toBe('replica-3');
	});

	it('releases the lease when it is done, so the next tick is not blocked', async () => {
		await addFamily('fam-release');
		const now = Date.now();
		await runDigestSweep({ holder: 'replica-4', nowMs: now });

		const registry = await getRegistryClient();
		const row = (await registry.execute({ sql: 'SELECT expires_at FROM scheduler_leases WHERE name = ?', args: ['inventory-notification-digest'] })).rows[0] as any;
		expect(new Date(row.expires_at).getTime()).toBeLessThanOrEqual(now);
	});

	it('refuses to re-enter itself rather than overlapping two sweeps', async () => {
		await addFamily('fam-guard');
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => { release = resolve; });
		digest.mockImplementation(async () => { await held; return quiet(); });

		const first = runDigestSweep({ holder: 'replica-5' });
		// Let the first sweep reach the digest call before the second starts.
		await new Promise((r) => setTimeout(r, 20));
		const second = await runDigestSweep({ holder: 'replica-5' });
		expect(second.skipped).toBe('in-progress');

		release();
		await first;
	});
});

describe('registry schema', () => {
	it('carries the lease table', async () => {
		await ensureRegistry();
		const registry = await getRegistryClient();
		const rows = (await registry.execute({
			sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduler_leases'",
			args: [],
		})).rows as any[];
		expect(rows.length).toBe(1);
	});
});
