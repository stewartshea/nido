// src/system-overview.test.ts
//
// The Admin tab's roll-up endpoint. It must stay admin-only and must never leak
// a credential (the app_settings row holds the SMTP password) while still
// reporting the instance's storage and component health.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getRegistryClient, getFamilyClient } from './namespaces';
import { MARK_ORPHANED_FAMILIES_SQL } from './migrations';
import { NAMESPACE_HOUSEHOLD_ID } from './db-core';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';

interface Account { email: string; token: string; userId: string; familyId: string }

async function postJson(path: string, body: unknown, token?: string) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function register(email: string): Promise<Account> {
	const { status, body } = await postJson('/api/v1/auth/register', {
		email, password: 'TestPass123!', firstName: 'Ada', lastName: 'Lovelace',
	});
	expect(status).toBe(200);
	const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
	return { email, token: body.token, userId: String(decoded.userId), familyId: String(decoded.familyId) };
}

async function seedInvitation(hostFamilyId: string, email: string, inviterId: string, token: string) {
	const hostDb = getFamilyClient(hostFamilyId);
	await hostDb.execute({
		sql: `INSERT INTO family_invitations (family_id, email, inviter_user_id, token, status, created_at)
		      VALUES (?, ?, ?, ?, 'pending', ?)`,
		args: [NAMESPACE_HOUSEHOLD_ID, email, inviterId, token, '2026-01-01T00:00:00.000Z'],
	});
	return token;
}

async function getOverview(token: string) {
	const res = await app.fetch(new Request('http://localhost/api/v1/settings/overview', {
		headers: { Authorization: `Bearer ${token}` },
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('system overview', () => {
	let admin: Account;
	let member: Account;

	beforeAll(async () => {
		admin = await register('overview-admin@example.com');
		member = await register('overview-member@example.com');
		const registry = await getRegistryClient();
		await registry.execute({
			sql: 'UPDATE user_routing SET is_platform_admin = 1 WHERE user_id = ?',
			args: [admin.userId],
		});
	});

	it('refuses a non-admin', async () => {
		const res = await getOverview(member.token);
		expect(res.status).toBe(403);
	});

	it('returns roll-up stats and component health to an admin', async () => {
		const res = await getOverview(admin.token);
		expect(res.status).toBe(200);
		const overview = res.body.overview;
		expect(overview).toBeTruthy();

		// Roll-up: at least the two families created in beforeAll are counted.
		expect(Number(overview.rollup.families)).toBeGreaterThanOrEqual(2);
		expect(Number(overview.rollup.accounts)).toBeGreaterThanOrEqual(2);
		expect(Number(overview.rollup.familyDbFiles)).toBeGreaterThanOrEqual(2);
		expect(Number(overview.rollup.platformAdmins)).toBeGreaterThanOrEqual(1);
		// The family DB bytes are a real, positive number, not a placeholder.
		expect(Number(overview.rollup.familyDbBytes)).toBeGreaterThan(0);

		// Every component the panel renders is present and well-formed.
		const keys = (overview.components as any[]).map((c) => c.key);
		for (const expected of ['api', 'registry', 'families', 'attachments', 'disk-data', 'mail', 'scheduler']) {
			expect(keys).toContain(expected);
		}
		for (const component of overview.components as any[]) {
			expect(['ok', 'warn', 'down']).toContain(component.status);
			expect(typeof component.name).toBe('string');
			expect(typeof component.summary).toBe('string');
			expect(Array.isArray(component.metrics)).toBe(true);
		}
	});

	// A family whose only account joined another one keeps its namespace but has
	// no one routed to it. It must not be counted among the live families, which
	// is what made the roll-up read as one family per account.
	it('counts a vacated family as retained, not live', async () => {
		const host = await register('overview-orphan-host@example.com');
		const leaver = await register('overview-orphan-leaver@example.com');
		const inviteToken = await seedInvitation(host.familyId, leaver.email, host.userId, 'tok-overview-orphan');
		const joined = await postJson('/api/v1/families/join', {
			familyId: host.familyId, token: inviteToken,
		}, leaver.token);
		expect(joined.status).toBe(200);

		const res = await getOverview(admin.token);
		expect(res.status).toBe(200);
		const rollup = res.body.overview.rollup;
		expect(Number(rollup.orphanedFamilies)).toBeGreaterThanOrEqual(1);
		expect(Number(rollup.activeFamilies)).toBeLessThan(Number(rollup.families));

		const registryComponent = (res.body.overview.components as any[])
			.find((c) => c.key === 'registry');
		const labels = (registryComponent.metrics as any[]).map((m) => m.label);
		expect(labels).toContain('No accounts');
	});

	it('never exposes the SMTP password', async () => {
		const registry = await getRegistryClient();
		await registry.execute({
			sql: "UPDATE app_settings SET smtp_pass = 'super-secret-app-password' WHERE id = 1",
			args: [],
		});
		const res = await getOverview(admin.token);
		expect(res.status).toBe(200);
		expect(JSON.stringify(res.body)).not.toContain('super-secret-app-password');
	});

	// The one-time upgrade path: a database written before the join handler marked
	// vacated families already accumulated account-less rows, and the migration
	// statement has to flag every one of them so the counts self-correct.
	it('backfill marks pre-existing account-less families abandoned', async () => {
		const registry = await getRegistryClient();
		const orphanId = 'feedface-0000-4000-8000-000000000001';
		await registry.execute({
			sql: "INSERT OR IGNORE INTO families (family_id, name, family_code, status) VALUES (?, ?, ?, 'active')",
			args: [orphanId, 'Legacy Shell', 'KZ-LEGACYORPHAN'],
		});
		const before = await registry.execute({
			sql: 'SELECT status FROM families WHERE family_id = ?',
			args: [orphanId],
		});
		expect(String(before.rows[0]?.status)).toBe('active');

		await registry.execute({ sql: MARK_ORPHANED_FAMILIES_SQL, args: [] });

		const after = await registry.execute({
			sql: 'SELECT status FROM families WHERE family_id = ?',
			args: [orphanId],
		});
		expect(String(after.rows[0]?.status)).toBe('abandoned');

		// A family that still has an account must be left alone.
		const live = await registry.execute({
			sql: 'SELECT status FROM families WHERE family_id = ?',
			args: [admin.familyId],
		});
		expect(String(live.rows[0]?.status)).toBe('active');
	});
});
