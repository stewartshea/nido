// src/inventory-consumption.test.ts
//
// The shape from issue #40: "subtract x from this when we log Y activity" as
// data on the item — activity, option filter, and an every-N ratio — with the
// remainder carried so only whole uses reach the ledger.
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

describe('inventory: any linked activity can consume stock, at any ratio', () => {
	let token = '';
	let memberId = 0;

	const logFeed = (type: string) =>
		call('POST', token, '/api/v1/feedings', {
			memberId, startTime: new Date().toISOString(), type,
		});

	const findItem = async (id: number) => {
		const res = await call('GET', token, '/api/v1/inventory');
		return res.body.items.find((i: any) => i.id === id);
	};

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'consume-rules@example.com', password: 'StrongP4ss!', firstName: 'Con', lastName: 'Rume',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Rule Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('offers only the activities whose routes actually bill stock', async () => {
		const res = await call('GET', token, '/api/v1/inventory/activities');
		expect(res.status).toBe(200);
		const tables = res.body.activities.map((a: any) => a.table);
		expect(tables).toContain('diapers');
		expect(tables).toContain('feedings');

		const feeds = res.body.activities.find((a: any) => a.table === 'feedings');
		expect(feeds.options).toContain('bottle');
		const diapers = res.body.activities.find((a: any) => a.table === 'diapers');
		// 'dry' is a loggable diaper type; a picker missing it could never be
		// narrowed to those changes.
		expect(diapers.options).toContain('dry');
	});

	it('refuses an option filter or an every-N ratio with no activity behind it', async () => {
		const noActivity = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Loose rule', category: 'cleaning', quantity: 5,
			eventOption: 'bottle',
		});
		expect(noActivity.status).toBe(400);

		const noRatio = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Loose ratio', category: 'cleaning', quantity: 5,
			unitsPerDecrement: 4,
		});
		expect(noRatio.status).toBe(400);
	});

	it('takes one tablet off every fourth bottle feed, carrying the rest', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Dishwasher tablets', category: 'cleaning', quantity: 60,
			eventCategory: 'feedings', eventOption: 'bottle',
			unitsPerDecrement: 4, decrementPerEvent: 1,
		});
		expect(made.status).toBe(201);
		const itemId = made.body.item.id;
		expect(made.body.item.eventOption).toBe('bottle');
		expect(made.body.item.unitsPerDecrement).toBe(4);

		await logFeed('bottle');
		await logFeed('bottle');
		await logFeed('bottle');
		let item = await findItem(itemId);
		expect(item.quantity).toBe(60);      // three carried, nothing billed yet

		await logFeed('breast');             // option filter: not a bottle
		item = await findItem(itemId);
		expect(item.quantity).toBe(60);

		await logFeed('bottle');             // the fourth bottle bills one
		item = await findItem(itemId);
		expect(item.quantity).toBe(59);

		const ledger = await call('GET', token, `/api/v1/inventory/${itemId}/adjustments`);
		const used = ledger.body.adjustments.filter((a: any) => a.reason === 'used');
		expect(used.length).toBe(1);
		expect(Number(used[0].change)).toBe(-1);
		expect(used[0].ref_table).toBe('feedings');
	});

	it('bills an unfiltered link on every event of that activity, at its own rate', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Cloth wipes', category: 'baby_care', quantity: 30,
			eventCategory: 'feedings', decrementPerEvent: 3,
		});
		expect(made.status).toBe(201);
		const itemId = made.body.item.id;

		await logFeed('breast');
		await logFeed('breast');
		const item = await findItem(itemId);
		expect(item.quantity).toBe(24);      // 30 − 3 per feed × 2
	});

	it('bills a retried event only once, even before a whole use accrues', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Rinse aid', category: 'cleaning', quantity: 10,
			eventCategory: 'feedings', eventOption: 'bottle',
			unitsPerDecrement: 4, decrementPerEvent: 1,
		});
		expect(made.status).toBe(201);
		const itemId = made.body.item.id;

		const body = { memberId, refTable: 'feedings', refId: 424242, option: 'bottle' };
		const first = await call('POST', token, '/api/v1/inventory/consume', body);
		expect(first.status).toBe(200);
		expect(first.body.applied).toContain('Rinse aid');
		expect((await findItem(itemId)).quantity).toBe(10);   // 1 of 4 carried, not billed

		const second = await call('POST', token, '/api/v1/inventory/consume', body);
		expect(second.status).toBe(200);
		expect(second.body.applied).toEqual([]);              // every linked item already gated
		expect((await findItem(itemId)).quantity).toBe(10);

		// Three more distinct events complete the ratio.
		for (const refId of [424243, 424244, 424245]) {
			await call('POST', token, '/api/v1/inventory/consume', { ...body, refId });
		}
		expect((await findItem(itemId)).quantity).toBe(9);
	});

	it('keeps the diaper journey on the same helper', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Night diapers', category: 'diapers', variant: '4',
			quantity: 20, eventCategory: 'diapers', decrementPerEvent: 1,
		});
		expect(made.status).toBe(201);
		const itemId = made.body.item.id;

		await call('POST', token, '/api/v1/diapers', {
			memberId, changeTime: new Date().toISOString(), type: 'wet',
		});
		await call('POST', token, '/api/v1/diapers', {
			memberId, changeTime: new Date().toISOString(), type: 'dry',
		});
		const item = await findItem(itemId);
		expect(item.quantity).toBe(18);
	});
});
