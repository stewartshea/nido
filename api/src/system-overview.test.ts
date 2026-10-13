// src/system-overview.test.ts
//
// The Admin tab's roll-up endpoint. It must stay admin-only and must never leak
// a credential (the app_settings row holds the SMTP password) while still
// reporting the instance's storage and component health.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getRegistryClient } from './db-namespaces';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';

interface Account { email: string; token: string; userId: string }

async function postJson(path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function register(email: string): Promise<Account> {
	const { status, body } = await postJson('/api/v1/auth/register', {
		email, password: 'TestPass123!', firstName: 'Ada', lastName: 'Lovelace',
	});
	expect(status).toBe(200);
	const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
	return { email, token: body.token, userId: String(decoded.userId) };
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
});
