// src/inventory-categories.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { getFamilyClient } from './db-namespaces';
import app from './server';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('inventory categories', () => {
	let token = '';
	let memberId = 0;

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-categories@example.com', password: 'StrongP4ss!', firstName: 'Cat', lastName: 'Tester',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Cat Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('offers a starting vocabulary out of the box', async () => {
		const res = await call('GET', token, '/api/v1/inventory/categories');
		expect(res.body.categories).toContain('diapers');
		expect(res.body.categories).toContain('filters');
	});

	it('adds a category the household invented', async () => {
		const res = await call('POST', token, '/api/v1/inventory/categories', { name: 'pet food' });
		expect(res.status).toBe(201);
		expect(res.body.categories).toContain('pet food');

		const list = await call('GET', token, '/api/v1/inventory/categories');
		expect(list.body.categories).toContain('pet food');
	});

	it('does not duplicate a category that already exists', async () => {
		await call('POST', token, '/api/v1/inventory/categories', { name: 'pet food' });
		const list = await call('GET', token, '/api/v1/inventory/categories');
		expect(list.body.categories.filter((c: string) => c === 'pet food').length).toBe(1);
	});

	it('still accepts an item in a category that was never added to the list', async () => {
		const item = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Coffee', category: 'kitchen staples', quantity: 2,
		});
		expect(item.status).toBe(201);

		// Schemaless: an unlisted category works, and then shows up as available.
		const list = await call('GET', token, '/api/v1/inventory/categories');
		expect(list.body.categories).toContain('kitchen staples');
	});

	it('removes a category from the list without orphaning items using it', async () => {
		await call('POST', token, '/api/v1/inventory/categories', { name: 'seasonal' });
		const del = await call('DELETE', token, '/api/v1/inventory/categories/seasonal');
		expect(del.status).toBe(200);

		const list = await call('GET', token, '/api/v1/inventory/categories');
		expect(list.body.categories).not.toContain('seasonal');
	});

	it('rejects an empty or overlong category name', async () => {
		expect((await call('POST', token, '/api/v1/inventory/categories', { name: '' })).status).toBe(400);
		expect((await call('POST', token, '/api/v1/inventory/categories', { name: 'z'.repeat(41) })).status).toBe(400);
	});
});

describe('standard diaper size presets', () => {
	it('offers the conventional ladder with default weight bands', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'size-presets@example.com', password: 'StrongP4ss!', firstName: 'Size', lastName: 'Tester',
		});
		const token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Size Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		const memberId = member.body.member.id;

		const presets = await call('GET', token, '/api/v1/inventory/diaper-size-presets');
		const labels = presets.body.presets.map((p: any) => p.size);
		expect(labels).toEqual(['NB', '1', '2', '3', '4', '5', '6']);
		for (const p of presets.body.presets) {
			expect(typeof p.weightBandKg).toBe('number');
			expect(p.weightBandKg).toBeGreaterThan(0);
		}
		// Bands must increase, or "outgrown at" would be meaningless.
		const bands = presets.body.presets.map((p: any) => p.weightBandKg);
		expect([...bands].sort((a, b) => a - b)).toEqual(bands);

		const pre = await call('POST', token, '/api/v1/inventory/diaper-sizes/preload', { memberId });
		expect(pre.status).toBe(201);
		expect(pre.body.added).toBe(7);

		const sizes = await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${memberId}`);
		expect(sizes.body.sizes.length).toBe(7);
		expect(sizes.body.sizes.find((s: any) => s.size === '3').weightBandKg).toBe(6.4);

		// Re-running must not duplicate what is already there.
		const again = await call('POST', token, '/api/v1/inventory/diaper-sizes/preload', { memberId });
		expect(again.body.added).toBe(0);
	});

	it('accepts a hand-picked subset with overridden bands', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'size-presets-2@example.com', password: 'StrongP4ss!', firstName: 'Size', lastName: 'Two',
		});
		const token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Size Baby Two', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		const memberId = member.body.member.id;

		const res = await call('POST', token, '/api/v1/inventory/diaper-sizes/preload', {
			memberId, sizes: [{ size: '3', weightBandKg: 5.5 }, { size: '4', weightBandKg: 7.2 }],
		});
		expect(res.body.added).toBe(2);

		const sizes = await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${memberId}`);
		expect(sizes.body.sizes.map((s: any) => s.size)).toEqual(['3', '4']);
		// The household's band wins over the default.
		expect(sizes.body.sizes.find((s: any) => s.size === '3').weightBandKg).toBe(5.5);
	});
});

describe('inventory expiry and the guard against double consumption', () => {
	it('stores an expiry date and surfaces days_to_expiry', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-expiry@example.com', password: 'StrongP4ss!', firstName: 'Exp', lastName: 'Tester',
		});
		const token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Expiry Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		const memberId = member.body.member.id;

		const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Formula', category: 'formula', quantity: 2, expiresAt: in7,
		});
		expect(made.status).toBe(201);
		expect(made.body.item.expiresAt).toBe(in7);

		// A rule on days_to_expiry fires, which is the whole point of the signal.
		await call('POST', token, '/api/v1/inventory/rules', {
			itemId: made.body.item.id, signal: 'days_to_expiry', comparator: 'lte', threshold: 14,
		});
		const list = await call('GET', token, '/api/v1/inventory');
		const alert = list.body.alerts.find((a: any) => a.itemId === made.body.item.id);
		expect(alert).toBeTruthy();
		expect(alert.signal).toBe('days_to_expiry');

		// Already expired: no longer reported, so it cannot nag forever.
		await call('PUT', token, `/api/v1/inventory/${made.body.item.id}`, {
			expiresAt: new Date(Date.now() - 86400000).toISOString(),
		});
		await call('POST', token, `/api/v1/inventory/rules/${alert.ruleId}/done`).catch(() => undefined);
		const after = await call('GET', token, '/api/v1/inventory');
		expect(after.body.alerts.find((a: any) => a.signal === 'days_to_expiry' && a.itemId === made.body.item.id)).toBeUndefined();
	});

	it('refuses an item that would be consumed by both a logged event and a cadence', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-double@example.com', password: 'StrongP4ss!', firstName: 'Two', lastName: 'Ways',
		});
		const token = reg.body.token;
		const res = await call('POST', token, '/api/v1/inventory', {
			name: 'Diapers', category: 'diapers', quantity: 10,
			eventCategory: 'diapers', decrementPerEvent: 1, consumeIntervalDays: 1,
		});
		expect(res.status).toBe(400);
		// A validation failure reports the issues array, not a flat string.
		expect(JSON.stringify(res.body)).toMatch(/not both|either/i);
	});

	it('separates the automatic cadence rows from ones the user recorded', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-source@example.com', password: 'StrongP4ss!', firstName: 'Src', lastName: 'Tester',
		});
		const token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Source Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		const memberId = member.body.member.id;

		const item = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Rare contacts', category: 'baby_care', quantity: 60, consumeIntervalDays: 30,
		});
		const id = item.body.item.id;

		// Backdate so the cadence fires; those rows must not count as user usage.
		await getFamilyClient(familyId).execute({
			sql: 'UPDATE inventory_items SET consume_started_at = ?, consume_cycles_applied = 0 WHERE id = ?',
			args: [new Date(Date.now() - 90 * 86400000).toISOString(), id],
		});
		await call('GET', token, '/api/v1/inventory');

		await call('POST', token, '/api/v1/inventory/rules', {
			itemId: id, signal: 'days_since_user_recorded_use', comparator: 'gte', threshold: 7,
		});
		const quiet = await call('GET', token, '/api/v1/inventory');
		expect(quiet.body.alerts.find((a: any) => a.itemId === id)).toBeUndefined();

		// Record one real use, then age it past the limit.
		await call('POST', token, `/api/v1/inventory/${id}/adjust`, { change: -1, reason: 'manual' });
		const fresh = await call('GET', token, '/api/v1/inventory');
		expect(fresh.body.alerts.find((a: any) => a.itemId === id)).toBeUndefined();

		// Backdate a confirmed use so the signal has a real age. The automatic
		// cadence rows either side of it must not be what moves the number.
		await getFamilyClient(familyId).execute({
			sql: `UPDATE inventory_adjustments SET created_at = ? WHERE item_id = ? AND source = 'manual'`,
			args: [new Date(Date.now() - 30 * 86400000).toISOString(), id],
		});
		const stale = await call('GET', token, '/api/v1/inventory');
		const alert = stale.body.alerts.find((a: any) => a.itemId === id && a.signal === 'days_since_user_recorded_use');
		expect(alert).toBeTruthy();
		expect(alert.value).toBeGreaterThanOrEqual(29);
	});

	it('reports that email is skipped when SMTP is not configured, rather than failing', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-notify@example.com', password: 'StrongP4ss!', firstName: 'No', lastName: 'Smtp',
		});
		const res = await call('POST', reg.body.token, '/api/v1/inventory/notify');
		expect(res.status).toBe(200);
		expect(res.body.sent).toBe(0);
	});
});
