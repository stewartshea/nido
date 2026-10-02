// src/family-settings-permissions.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './db-namespaces';
import { NAMESPACE_HOUSEHOLD_ID } from './db-core';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';
const TS = '2026-01-01T00:00:00.000Z';

interface Account { email: string; token: string; userId: string; familyId: string }

async function postJson(path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function postAs(token: string, path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function putJson(token: string, path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
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

describe('family settings permissions', () => {
	let owner: Account;
	let guest: Account;

	beforeAll(async () => {
		owner = await register('settings-owner@example.com');
		guest = await register('settings-guest@example.com');
		const hostDb = getFamilyClient(owner.familyId);
		await hostDb.execute({
			sql: `INSERT INTO family_invitations (family_id, email, inviter_user_id, token, status, created_at)
			      VALUES (?, ?, ?, ?, 'pending', ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, guest.email, owner.userId, 'tok-settings', TS],
		});
		const joined = await postAs(guest.token, '/api/v1/families/join', { familyId: owner.familyId, token: 'tok-settings' });
		expect(joined.status).toBe(200);
		// The join endpoint reissues a token bound to the host family.
		guest.token = joined.body.token;
	});

	it('lets a plain member change the tracked categories', async () => {
		const res = await putJson(guest.token, '/api/v1/families/settings', {
			categories: ['feeds', 'diapers', 'routines'],
		});
		expect(res.status).toBe(200);
		expect(res.body.settings.categories).toEqual(['feeds', 'diapers', 'routines']);
	});

	it('lets a plain member change the category options', async () => {
		const res = await putJson(guest.token, '/api/v1/families/settings', {
			categoryOptions: { routines: { type: ['bath', 'story time', 'our own thing'] } },
		});
		expect(res.status).toBe(200);
		expect(res.body.settings.categoryOptions.routines.type).toContain('our own thing');
	});

	it('stops a plain member from changing anonymized sharing', async () => {
		const res = await putJson(guest.token, '/api/v1/families/settings', { shareAnonymizedDaily: true });
		expect(res.status).toBe(403);
		expect(String(res.body.error)).toMatch(/owner or admin/i);
	});

	it('still lets the owner change anonymized sharing', async () => {
		const res = await putJson(owner.token, '/api/v1/families/settings', { shareAnonymizedDaily: true });
		expect(res.status).toBe(200);
		expect(res.body.settings.shareAnonymizedDaily).toBe(true);
	});

	it('leaves the other settings alone when a member only sends categories', async () => {
		await putJson(owner.token, '/api/v1/families/settings', { shareAnonymizedDaily: false });
		await putJson(guest.token, '/api/v1/families/settings', { categories: ['feeds'] });
		const res = await putJson(owner.token, '/api/v1/families/settings', { categoryOptions: {} });
		expect(res.body.settings.categories).toEqual(['feeds']);
		expect(res.body.settings.shareAnonymizedDaily).toBe(false);
	});
});
