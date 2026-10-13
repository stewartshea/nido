// src/registry-view.test.ts
//
// Read-only registry view for the Admin tab. Like the overview it is admin-only
// and must never serialize the tokens or credentials sitting in the registry
// (verification/reset tokens, the SMTP password).
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

async function getRegistry(token: string) {
	const res = await app.fetch(new Request('http://localhost/api/v1/settings/registry', {
		headers: { Authorization: `Bearer ${token}` },
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('registry view', () => {
	let admin: Account;
	let member: Account;

	beforeAll(async () => {
		admin = await register('registry-admin@example.com');
		member = await register('registry-member@example.com');
		const registry = await getRegistryClient();
		await registry.execute({
			sql: 'UPDATE user_routing SET is_platform_admin = 1 WHERE user_id = ?',
			args: [admin.userId],
		});
	});

	it('refuses a non-admin', async () => {
		const res = await getRegistry(member.token);
		expect(res.status).toBe(403);
	});

	it('returns families, accounts, settings and leases to an admin', async () => {
		const res = await getRegistry(admin.token);
		expect(res.status).toBe(200);
		const registry = res.body.registry;

		expect(registry.families.length).toBeGreaterThanOrEqual(2);
		expect(registry.users.length).toBeGreaterThanOrEqual(2);

		const family = registry.families[0];
		expect(typeof family.familyId).toBe('string');
		expect(typeof family.name).toBe('string');
		expect(['active']).toContain(family.status);

		// Each family reports how many accounts route to it, which is what tells a
		// live family apart from a namespace retained with nobody in it.
		expect(typeof family.accountCount).toBe('number');
		for (const fam of registry.families as any[]) {
			const routed = registry.users.filter((u: any) => u.familyId === fam.familyId).length;
			expect(fam.accountCount).toBe(routed);
		}
		// Families with accounts sort before retained ones.
		const counts = (registry.families as any[]).map((f) => f.accountCount);
		expect(counts).toEqual([...counts].sort((a, b) => (a > 0 ? 0 : 1) - (b > 0 ? 0 : 1)));

		const user = registry.users.find((u: any) => u.userId === admin.userId);
		expect(user).toBeTruthy();
		expect(user.email).toBe('registry-admin@example.com');
		expect(user.isPlatformAdmin).toBe(true);

		expect(typeof registry.settings.smtpConfigured).toBe('boolean');
		expect(registry.settings.smtpPassSet).toBe(false);
	});

	it('never exposes tokens or credentials', async () => {
		const registry = await getRegistryClient();
		await registry.execute({
			sql: "UPDATE user_routing SET verification_token = 'VERIFY-SECRET', reset_token = 'RESET-SECRET' WHERE user_id = ?",
			args: [member.userId],
		});
		await registry.execute({
			sql: "UPDATE app_settings SET smtp_pass = 'SMTP-SECRET', smtp_user = 'mail-bot' WHERE id = 1",
			args: [],
		});
		const res = await getRegistry(admin.token);
		expect(res.status).toBe(200);
		const json = JSON.stringify(res.body);
		expect(json).not.toContain('VERIFY-SECRET');
		expect(json).not.toContain('RESET-SECRET');
		expect(json).not.toContain('SMTP-SECRET');
		// The presence of the username is reported without its value.
		expect(res.body.registry.settings.smtpUserSet).toBe(true);
		expect(res.body.registry.settings.smtpPassSet).toBe(true);
	});
});