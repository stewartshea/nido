import { ensureRegistry } from './db-namespaces';

export async function isPlatformAdmin(userId: string | number | null | undefined): Promise<boolean> {
	if (userId === null || userId === undefined) return false;
	const registry = await ensureRegistry();
	const res = await registry.execute({
		sql: 'SELECT is_platform_admin FROM user_routing WHERE user_id = ? LIMIT 1',
		args: [String(userId)],
	});
	const row = res.rows[0] as { is_platform_admin: number } | undefined;
	return row ? Number(row.is_platform_admin ?? 0) === 1 : false;
}

// Designate the single platform admin.
// 1. ADMIN_EMAIL env var is the source of truth when its user exists.
// 2. Otherwise the first registered user becomes admin, so a fresh install is
//    never locked out.
// Enforces exactly one admin: whenever a user is promoted, everyone else is demoted.
export async function ensurePlatformAdmin(): Promise<void> {
	const registry = await ensureRegistry();

	const adminEmail = process.env.ADMIN_EMAIL;
	if (adminEmail) {
		const res = await registry.execute({ sql: 'SELECT user_id FROM user_routing WHERE lower(email) = lower(?) LIMIT 1', args: [adminEmail] });
		const row = res.rows[0] as { user_id: string } | undefined;
		if (row) {
			await registry.execute({ sql: 'UPDATE user_routing SET is_platform_admin = 0 WHERE is_platform_admin = 1', args: [] });
			await registry.execute({ sql: 'UPDATE user_routing SET is_platform_admin = 1, updated_at = ? WHERE user_id = ?', args: [new Date().toISOString(), row.user_id] });
			return;
		}
		// ADMIN_EMAIL user does not exist yet — leave current admin(s) alone; they
		// will be re-evaluated on the next startup after that account registers.
	}

	// No (matching) ADMIN_EMAIL: guarantee at least one admin exists.
	const adminRes = await registry.execute({ sql: 'SELECT user_id FROM user_routing WHERE is_platform_admin = 1 LIMIT 1', args: [] });
	if (adminRes.rows.length > 0) return;

	// created_at is ISO (ms, UTC, lexicographically sortable); rowid breaks ties.
	const firstRes = await registry.execute({ sql: 'SELECT user_id FROM user_routing ORDER BY created_at ASC, rowid ASC LIMIT 1', args: [] });
	if (firstRes.rows.length === 0) return; // no users yet
	const firstId = String((firstRes.rows[0] as { user_id: string }).user_id);
	await registry.execute({ sql: 'UPDATE user_routing SET is_platform_admin = 1, updated_at = ? WHERE user_id = ?', args: [new Date().toISOString(), firstId] });
}

export async function bootstrapAdmin(): Promise<void> {
	try {
		await ensurePlatformAdmin();
	} catch (e) {
		console.error('Failed to designate platform admin:', e);
	}
}