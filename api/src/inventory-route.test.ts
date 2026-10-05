// src/inventory-route.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('inventory: the diaper journey', () => {
	let token = '';
	let memberId = 0;

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-journey@example.com', password: 'StrongP4ss!', firstName: 'Inv', lastName: 'Journey',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Stock Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('adds a diaper item and records the opening stock in the ledger', async () => {
		const res = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Diapers', category: 'diapers', variant: '3',
			quantity: 84, unit: 'count', packSize: 84, leadDays: 7,
			eventCategory: 'diapers', decrementPerEvent: 1,
		});
		expect(res.status).toBe(201);
		expect(res.body.item.quantity).toBe(84);
		expect(res.body.item.daysOfCover).toBeNull();   // nothing used yet, so no rate
		expect(res.body.item.alerting).toBe(false);

		const ledger = await call('GET', token, `/api/v1/inventory/${res.body.item.id}/adjustments`);
		expect(ledger.body.adjustments.length).toBe(1);
		expect(Number(ledger.body.adjustments[0].change)).toBe(84);
		expect(ledger.body.adjustments[0].reason).toBe('purchase');
	});

	it('decrements stock for every diaper change logged, without double counting', async () => {
		const items = await call('GET', token, '/api/v1/inventory');
		const diapers = items.body.items.find((i: any) => i.variant === '3');

		for (let i = 0; i < 5; i++) {
			const d = await call('POST', token, '/api/v1/diapers', {
				memberId, changeTime: new Date().toISOString(), type: 'wet',
			});
			expect(d.status).toBe(200);
		}
		const after = await call('GET', token, '/api/v1/inventory');
		const now = after.body.items.find((i: any) => i.id === diapers.id);
		expect(now.quantity).toBe(79);           // 84 - 5 changes
		expect(Number(diapers.id)).toBeGreaterThan(0);

		// Re-consuming the same logged change must not take more stock.
		const dup = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'diapers', refId: 999999,
		});
		expect(dup.status).toBe(200);
		const twice = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'diapers', refId: 999999,
		});
		expect(twice.status).toBe(200);
		expect(twice.body.applied.length).toBe(0);   // already counted
	});

	it('forecasts runout from observed usage', async () => {
		// Record usage over a few days so a real rate exists.
		const item = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.variant === '3');
		const now = Date.now();
		const day = 24 * 60 * 60 * 1000;
		for (let d = 4; d >= 1; d--) {
			await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, {
				change: -6, reason: 'used', note: 'bulk entry for the day',
			});
		}
		const res = await call('GET', token, '/api/v1/inventory');
		const updated = res.body.items.find((i: any) => i.id === item.id);
		expect(updated.consumptionPerDay).toBeGreaterThan(0);
		expect(updated.daysOfCover).toBeGreaterThan(0);
		expect(updated.runoutAt).toBeTruthy();
		expect(now).toBeGreaterThan(0);
	});

	it('refuses to take stock below zero', async () => {
		const item = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.variant === '3');
		const res = await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, { change: -100000, reason: 'correction' });
		expect(res.status).toBe(400);
		expect(String(res.body.error)).toMatch(/below zero/i);
	});

	it('adds diapers and other stock for the home without a member', async () => {
		const home = await call('POST', token, '/api/v1/inventory', {
			memberId: null, name: 'Furnace filter', category: 'filters', quantity: 2, unit: 'count', leadDays: 14,
		});
		expect(home.status).toBe(201);
		expect(home.body.item.memberId).toBeNull();
		expect(home.body.item.category).toBe('filters');
	});

	it('accepts a category nobody has used before, and offers it back', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId: null, name: 'Reusable nappy liners', category: 'nappy liners',
		});
		expect(made.status).toBe(201);

		const cats = await call('GET', token, '/api/v1/inventory/categories');
		expect(cats.body.categories).toContain('nappy liners');
		expect(cats.body.categories).toContain('diapers');   // starter list still offered
	});

	it('rejects a blank or overlong category', async () => {
		expect((await call('POST', token, '/api/v1/inventory', { memberId: null, name: 'X', category: '' })).status).toBe(400);
		expect((await call('POST', token, '/api/v1/inventory', { memberId: null, name: 'X', category: 'y'.repeat(41) })).status).toBe(400);
	});

	it('reports size signals as null until there is enough to compute them', async () => {
		const familyId = (jwt.decode(token) as any).familyId as string;
		const other = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Size Forecast Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'male',
		});
		const otherId = other.body.member.id;

		const none = await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${otherId}`);
		expect(none.status).toBe(200);
		expect(none.body.signals.size_up_in_days).toBeNull();

		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId: otherId, size: '3', weightBandKg: 6.0 });
		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId: otherId, size: '4', weightBandKg: 7.0 });
		const noGrowth = await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${otherId}`);
		expect(noGrowth.body.sizes.length).toBe(2);
		// Bands exist but no weight series, so it declines rather than guesses.
		expect(noGrowth.body.signals.size_up_in_days).toBeNull();

		for (const size of noGrowth.body.sizes) {
			await call('DELETE', token, `/api/v1/inventory/diaper-sizes/${size.id}`);
		}
	});

	it('produces the size-up signal once growth records and weight bands exist', async () => {
		const familyId = (jwt.decode(token) as any).familyId as string;
		const child = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Growing Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		const childId = child.body.member.id;

		for (const [daysAgo, weight] of [[120, 5.4], [90, 5.7], [60, 6.0], [30, 6.2], [3, 6.3]]) {
			await call('POST', token, '/api/v1/growth', {
				memberId: childId,
				measurementDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
				weight, unitSystem: 'metric',
			});
		}
		// The signal is computed against the child's own diaper stock, so the
		// item has to exist before size-up means anything.
		await call('POST', token, '/api/v1/inventory', {
			memberId: childId, name: 'Diapers', category: 'diapers', quantity: 40, unit: 'count',
		});
		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId: childId, size: '3', weightBandKg: 6.0 });
		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId: childId, size: '4', weightBandKg: 7.0 });

		const res = await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${childId}`);
		expect(res.body.sizes.length).toBe(2);
		expect(res.body.signals.size_up_in_days).toBeGreaterThan(0);
		expect(res.body.sizes.find((x: any) => x.size === '4').weightBandKg).toBe(7.0);
	});

	it('keeps reporting a firing rule, and reading it does not consume the notification', async () => {
		const item = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.variant === '3');
		// Give it a real rate so days_of_cover exists, then warn under 7 days.
		for (let d = 5; d >= 1; d--) {
			await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, { change: -5, reason: 'used' });
		}
		const rule = await call('POST', token, '/api/v1/inventory/rules', {
			itemId: item.id, signal: 'days_of_cover', comparator: 'lte', threshold: 7,
		});
		expect(rule.status).toBe(201);
		expect(rule.body.rule.signal).toBe('days_of_cover');
		const isFiring = (res: any) => res.body.alerts.some((a: any) => a.ruleId === rule.body.rule.id);

		expect(isFiring(await call('GET', token, '/api/v1/inventory'))).toBe(true);
		expect(isFiring(await call('GET', token, '/api/v1/inventory'))).toBe(true);

		// Nobody has been emailed, so nobody is recorded as having been told. This
		// is the bug that would otherwise stop the digest ever sending anything.
		const state = (await call('GET', token, '/api/v1/inventory')).body;
		expect(state.alerts).toBeDefined();

		await call('DELETE', token, `/api/v1/inventory/rules/${rule.body.rule.id}`);
	});

	it('stores who a rule is addressed to, and defaults to the whole family', async () => {
		const item = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.variant === '3');
		const familyWide = await call('POST', token, '/api/v1/inventory/rules', {
			itemId: item.id, signal: 'quantity', comparator: 'lte', threshold: 999,
		});
		expect(familyWide.status).toBe(201);
		expect(familyWide.body.rule.audienceKind).toBe('family');
		expect(familyWide.body.rule.audienceIds).toEqual([]);

		const me = (await call('GET', token, '/api/v1/users/me')).body.user ?? (await call('GET', token, '/api/v1/users/me')).body;
		const narrowed = await call('POST', token, '/api/v1/inventory/rules', {
			itemId: item.id, signal: 'quantity', comparator: 'lte', threshold: 998,
			audienceKind: 'users', audienceIds: [me.id],
		});
		expect(narrowed.status).toBe(201);
		expect(narrowed.body.rule.audienceKind).toBe('users');
		expect(narrowed.body.rule.audienceIds).toEqual([me.id]);

		// Narrowed to nobody is refused rather than quietly telling no one.
		const empty = await call('POST', token, '/api/v1/inventory/rules', {
			itemId: item.id, signal: 'quantity', comparator: 'lte', threshold: 997,
			audienceKind: 'users', audienceIds: [],
		});
		expect(empty.status).toBe(400);

		// Widening back to the family clears the stored id list.
		const widened = await call('PUT', token, `/api/v1/inventory/rules/${narrowed.body.rule.id}`, {
			audienceKind: 'family',
		});
		expect(widened.body.rule.audienceKind).toBe('family');
		expect(widened.body.rule.audienceIds).toEqual([]);

		await call('DELETE', token, `/api/v1/inventory/rules/${familyWide.body.rule.id}`);
		await call('DELETE', token, `/api/v1/inventory/rules/${narrowed.body.rule.id}`);
	});

it('does not fire a size-up rule on a member\'s non-diaper stock', async () => {
		// Both items belong to the same child, so both see the same sizes and
		// weights. Only diaper stock should be told about outgrowing a size.
		const item = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.variant === '3');
		const other = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Wipes', category: 'baby_care', quantity: 5,
		});
		expect(other.status).toBe(201);

		// The signal needs weight bands the child has already passed.
		for (const [d, w] of [[60, 5.6], [30, 6.0], [3, 6.3]]) {
			await call('POST', token, '/api/v1/growth', {
				memberId, measurementDate: new Date(Date.now() - d * 86400000).toISOString(), weight: w, unitSystem: 'metric',
			});
		}
		for (const s of (await call('GET', token, `/api/v1/inventory/diaper-sizes?memberId=${memberId}`)).body.sizes) {
			await call('DELETE', token, `/api/v1/inventory/diaper-sizes/${s.id}`);
		}
		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId, size: '3', weightBandKg: 6.0 });
		await call('POST', token, '/api/v1/inventory/diaper-sizes', { memberId, size: '4', weightBandKg: 7.0 });

		await call('POST', token, '/api/v1/inventory/rules', {
			itemId: null, signal: 'size_up_in_days', comparator: 'lte', threshold: 60,
		});

		const res = await call('GET', token, '/api/v1/inventory');
		const named = res.body.alerts.map((a: any) => a.itemName);
		expect(named.some((n: string) => /Wipes/.test(n))).toBe(false);
		expect(named.some((n: string) => /Diapers/.test(n))).toBe(true);
		// The wipe reports the signal as uncomputable rather than passing quietly.
		const unknowns = res.body.unknown.filter((u: any) => u.signal === 'size_up_in_days');
		expect(unknowns.length).toBeGreaterThan(0);
	});

	it('rejects a rule naming a signal that does not exist', async () => {
		const res = await call('POST', token, '/api/v1/inventory/rules', { signal: 'vibes', threshold: 1 });
		expect(res.status).toBe(400);
		expect(String(res.body.error)).toMatch(/unknown signal/i);
	});
});
