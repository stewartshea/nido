// src/inventory-diaper-billing.test.ts
//
// A diaper change bills the size the child is wearing. The event itself has
// only a type (wet/dirty/both/dry), so without a pin every size linked to the
// member came down together: two open packs, two decrements, one change.
// The ladder's current band decides which one was actually used.
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

describe('inventory: a diaper change bills one size', () => {
	let token = '';
	let familyId = '';

	async function child(name: string): Promise<number> {
		const res = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name, birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		expect(res.status).toBe(201);
		return res.body.member.id as number;
	}

	async function diaperStock(memberId: number, over: Record<string, unknown> = {}) {
		const res = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Diapers', category: 'diapers', quantity: 40, unit: 'count',
			eventCategory: 'diapers', decrementPerEvent: 1, ...over,
		});
		expect(res.status).toBe(201);
		return res.body.item as any;
	}

	async function wipes(memberId: number) {
		const res = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Wipes', category: 'baby_care', quantity: 90, unit: 'count',
			eventCategory: 'diapers', decrementPerEvent: 3,
		});
		expect(res.status).toBe(201);
		return res.body.item as any;
	}

	async function sizeBand(memberId: number, size: string, itemId: number | null, min: number | null, max: number | null, startDate?: string) {
		const res = await call('POST', token, '/api/v1/inventory/diaper-sizes', {
			memberId, size, itemId, weightBandMinKg: min, weightBandMaxKg: max,
			...(startDate ? { startDate } : {}),
		});
		expect(res.status).toBe(201);
	}

	async function weigh(memberId: number, weight: number, at: string, unitSystem = 'metric') {
		const res = await call('POST', token, '/api/v1/growth', { memberId, measurementDate: at, weight, unitSystem });
		expect(res.status).toBe(200);
	}

	async function change(memberId: number) {
		const res = await call('POST', token, '/api/v1/diapers', {
			memberId, changeTime: new Date().toISOString(), type: 'wet',
		});
		expect(res.status).toBe(200);
	}

	async function quantity(id: number): Promise<number> {
		const res = await call('GET', token, '/api/v1/inventory');
		expect(res.status).toBe(200);
		return res.body.items.find((i: any) => i.id === id).quantity as number;
	}

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-diaper-size@example.com', password: 'StrongP4ss!',
			firstName: 'Diaper', lastName: 'Billing',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('bills the size the weight points at, not every linked size', async () => {
		const memberId = await child('Band Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		const wipeStock = await wipes(memberId);
		await sizeBand(memberId, '3', small.id, 5.5, 7.0);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0);
		// Size 3 is 5.5-7.0kg; this child is inside it.
		await weigh(memberId, 6.3, '2026-01-01T00:00:00.000Z');

		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(40);
		// The pin is scoped to diapers: the wipes still come down 3 per change.
		expect(await quantity(wipeStock.id)).toBe(87);

		await change(memberId);
		expect(await quantity(small.id)).toBe(38);
		expect(await quantity(large.id)).toBe(40);
		expect(await quantity(wipeStock.id)).toBe(84);
	});

	it('moves billing to the next size when the weight crosses its floor', async () => {
		const memberId = await child('Growing Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		await sizeBand(memberId, '3', small.id, 5.5, 7.0);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0);
		await weigh(memberId, 6.3, '2026-01-01T00:00:00.000Z');
		await change(memberId);

		// A newer measurement puts the child over the 7.0kg floor.
		await weigh(memberId, 7.5, '2026-02-01T00:00:00.000Z');
		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(39);
	});

	it('bills no diaper stock when the size in use has no linked item', async () => {
		const memberId = await child('Untracked Size Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		await sizeBand(memberId, '3', small.id, 5.5, 7.0);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0);
		// The child has moved into a size whose pack is not linked to stock.
		await sizeBand(memberId, '5', null, 9.0, 11.0);
		await weigh(memberId, 9.5, '2026-01-01T00:00:00.000Z');

		await change(memberId);
		expect(await quantity(small.id)).toBe(40);
		expect(await quantity(large.id)).toBe(40);
	});

	it('leaves billing alone when only one size names stock', async () => {
		// The fallback: a ladder with a single linked size has nothing to
		// disambiguate, so the older behaviour stands even if the weight has
		// moved past it.
		const memberId = await child('Single Link Baby');
		const only = await diaperStock(memberId, { variant: '3' });
		await sizeBand(memberId, '3', only.id, 5.5, 7.0);
		await sizeBand(memberId, '4', null, 7.0, 9.0);
		await weigh(memberId, 7.5, '2026-01-01T00:00:00.000Z');

		await change(memberId);
		expect(await quantity(only.id)).toBe(39);
	});

	it('reads a weight in pounds as kilograms', async () => {
		const memberId = await child('Imperial Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		await sizeBand(memberId, '3', small.id, 5.5, 7.0);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0);
		// 13.2lb is 5.99kg, inside Size 3. Read as kilograms it would be off
		// the top of the ladder and bill Size 4 instead.
		await weigh(memberId, 13.2, '2026-01-01T00:00:00.000Z', 'imperial');

		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(40);
	});

	it('uses the smallest band when there is no weight at all', async () => {
		const memberId = await child('No Weight Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		// A preloaded ladder stamps every row at once; the tie must not pick
		// the largest size.
		const same = '2026-01-01T00:00:00.000Z';
		await sizeBand(memberId, '3', small.id, 5.5, 7.0, same);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0, same);

		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(40);
	});

	it('picks among linked packs when a preloaded ladder has no weight yet', async () => {
		// Preload creates the whole ladder unlinked. Once the family links the
		// packs they own, a change must still bill one of them.
		const memberId = await child('Preload Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		const same = '2026-01-01T00:00:00.000Z';
		await sizeBand(memberId, '1', null, 2.0, 4.0, same);
		await sizeBand(memberId, '2', null, 4.0, 5.5, same);
		await sizeBand(memberId, '3', small.id, 5.5, 7.0, same);
		await sizeBand(memberId, '4', large.id, 7.0, 9.0, same);

		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(40);
	});

	it('still bills one linked size when the ladder has no weight bands', async () => {
		// Bands are optional; a family that linked packs before filling them in
		// should not lose billing the moment a weight is recorded.
		const memberId = await child('No Bands Baby');
		const small = await diaperStock(memberId, { variant: '3' });
		const large = await diaperStock(memberId, { variant: '4' });
		const same = '2026-01-01T00:00:00.000Z';
		await sizeBand(memberId, '3', small.id, null, null, same);
		await sizeBand(memberId, '4', large.id, null, null, same);
		await weigh(memberId, 6.3, '2026-01-01T00:00:00.000Z');

		await change(memberId);
		expect(await quantity(small.id)).toBe(39);
		expect(await quantity(large.id)).toBe(40);
	});
});
