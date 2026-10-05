// src/inventory-reset.test.ts
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

describe('inventory: making the numbers trustworthy again', () => {
	let token = '';
	let memberId = 0;

	async function newItem(over: Record<string, unknown> = {}) {
		const res = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Diapers', category: 'diapers', quantity: 50, unit: 'count', ...over,
		});
		expect(res.status).toBe(201);
		return res.body.item as any;
	}

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-reset@example.com', password: 'StrongP4ss!', firstName: 'Reset', lastName: 'Tester',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Reset Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('reports the ledger-derived count and how far it has drifted from the stored one', async () => {
		const item = await newItem({ quantity: 50 });
		await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, { change: -10, reason: 'manual' });

		const list = await call('GET', token, '/api/v1/inventory');
		const row = list.body.items.find((i: any) => i.id === item.id);
		expect(row.quantity).toBe(40);
		expect(row.ledgerQuantity).toBe(40);      // 50 opening -10
		expect(row.drift).toBe(0);
	});

	it('surfaces the drift that happens when auto-decrement hits the zero floor', async () => {
		// Linked to diaper changes, so logging more changes than stock clamps at 0.
		const item = await newItem({ quantity: 2, variant: 'drift', eventCategory: 'diapers', decrementPerEvent: 1 });
		for (let i = 0; i < 5; i++) {
			await call('POST', token, '/api/v1/diapers', { memberId, changeTime: new Date().toISOString(), type: 'wet' });
		}
		const list = await call('GET', token, '/api/v1/inventory');
		const row = list.body.items.find((i: any) => i.id === item.id);
		expect(row.quantity).toBe(0);            // clamped at the floor
		expect(row.ledgerQuantity).toBe(-3);     // the ledger kept the full history
		expect(row.drift).toBe(-3);              // which is exactly why a reset is needed
	});

	it('recounts to a counted number and records the correction rather than erasing it', async () => {
		const item = await newItem({ quantity: 20, variant: 'recount' });
		await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, { change: -5, reason: 'used' });

		const res = await call('POST', token, `/api/v1/inventory/${item.id}/recount`, {
			quantity: 14, note: 'Counted the cupboard',
		});
		expect(res.status).toBe(200);
		expect(res.body.item.quantity).toBe(14);

		// The discrepancy is in the ledger, not silently dropped.
		const ledger = await call('GET', token, `/api/v1/inventory/${item.id}/adjustments`);
		const correction = ledger.body.adjustments.find((a: any) => a.reason === 'correction');
		expect(Number(correction.change)).toBe(-1);
		expect(correction.note).toMatch(/cupboard/i);
	});

	it('resets an item history and restarts from the counted number', async () => {
		const item = await newItem({ quantity: 30, variant: 'resethist' });
		for (let i = 0; i < 10; i++) {
			await call('POST', token, `/api/v1/inventory/${item.id}/adjust`, { change: -1, reason: 'used' });
		}

		const res = await call('POST', token, `/api/v1/inventory/${item.id}/reset-history`, { quantity: 12 });
		expect(res.status).toBe(200);
		expect(res.body.item.quantity).toBe(12);

		const ledger = await call('GET', token, `/api/v1/inventory/${item.id}/adjustments`);
		// The ten "used" rows are gone; one auditable opening row replaced them.
		expect(ledger.body.adjustments.length).toBe(1);
		expect(ledger.body.adjustments[0].reason).toBe('purchase');
		expect(Number(ledger.body.adjustments[0].change)).toBe(12);

		// With no usage the forecast is unknown again rather than stale.
		const list = await call('GET', token, '/api/v1/inventory');
		const row = list.body.items.find((i: any) => i.id === item.id);
		expect(row.daysOfCover).toBeNull();
		expect(row.ledgerQuantity).toBe(12);
		expect(row.drift).toBe(0);
	});

	it('refuses a reset-all without the confirmation word', async () => {
		const bad = await call('POST', token, '/api/v1/inventory/reset', { confirm: 'yes' });
		expect(bad.status).toBe(400);
		const items = await call('GET', token, '/api/v1/inventory');
		expect(items.body.items.length).toBeGreaterThan(0);   // nothing was removed
	});

	it('clears items, history and rules on a confirmed reset-all', async () => {
		await call('POST', token, '/api/v1/inventory/rules', { signal: 'quantity', threshold: 2 });
		const res = await call('POST', token, '/api/v1/inventory/reset', { confirm: 'RESET' });
		expect(res.status).toBe(200);
		expect(res.body.message).toMatch(/reset/i);

		const items = await call('GET', token, '/api/v1/inventory');
		expect(items.body.items.length).toBe(0);
		const rules = await call('GET', token, '/api/v1/inventory/rules');
		expect(rules.body.rules.length).toBe(0);
	});

	it('decrements every item linked to the same event, not just the first', async () => {
		// Two sizes of the same consumable are driven by the same logged event.
		// A global uniqueness rule on (ref_table, ref_id) let whichever inserted
		// first swallow the change from the other.
		const a = await newItem({ quantity: 10, variant: 'shared-a', eventCategory: 'diapers', decrementPerEvent: 1 });
		const b = await newItem({ quantity: 10, variant: 'shared-b', eventCategory: 'diapers', decrementPerEvent: 1 });

		await call('POST', token, '/api/v1/diapers', { memberId, changeTime: new Date().toISOString(), type: 'wet' });
		await call('POST', token, '/api/v1/diapers', { memberId, changeTime: new Date().toISOString(), type: 'wet' });

		const list = await call('GET', token, '/api/v1/inventory');
		const ra = list.body.items.find((i: any) => i.id === a.id);
		const rb = list.body.items.find((i: any) => i.id === b.id);
		expect(ra.quantity).toBe(8);
		expect(rb.quantity).toBe(8);
	});

	it('still refuses to count the same logged event twice against one item', async () => {
		const item = await newItem({ quantity: 10, variant: 'once', eventCategory: 'diapers', decrementPerEvent: 1 });
		const first = await call('POST', token, '/api/v1/inventory/consume', { memberId, refTable: 'diapers', refId: 987654 });
		expect(first.body.applied.length).toBeGreaterThan(0);
		const second = await call('POST', token, '/api/v1/inventory/consume', { memberId, refTable: 'diapers', refId: 987654 });
		expect(second.body.applied).toEqual([]);

		const list = await call('GET', token, '/api/v1/inventory');
		const row = list.body.items.find((i: any) => i.id === item.id);
		// Exactly one unit lost from this item, despite two attempts.
		expect(row.quantity).toBe(9);
	});
});
