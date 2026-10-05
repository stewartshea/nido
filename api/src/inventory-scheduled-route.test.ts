// src/inventory-scheduled-route.test.ts
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

async function backdate(itemId: number, startedIso: string, applied: number) {
	const { getFamilyClient } = await import('./db-namespaces');
	const famId = (jwt.decode(token) as any).familyId as string;
	await getFamilyClient(famId).execute({
		sql: 'UPDATE inventory_items SET consume_started_at = ?, consume_cycles_applied = ? WHERE id = ?',
		args: [startedIso, applied, itemId],
	});
}

let token = '';

describe('inventory: scheduled consumption', () => {
	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'inventory-scheduled@example.com', password: 'StrongP4ss!', firstName: 'Sched', lastName: 'Tester',
		});
		token = reg.body.token;
	});

	it('records nothing before the first cycle is up', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Daily contacts', category: 'baby_care', quantity: 30, consumeIntervalDays: 1,
		});
		expect(made.status).toBe(201);
		expect(made.body.item.consumeIntervalDays).toBe(1);
		expect(made.body.item.consumeStartedAt).toBeTruthy();

		const list = await call('GET', token, '/api/v1/inventory');
		const row = list.body.items.find((i: any) => i.id === made.body.item.id);
		expect(row.quantity).toBe(30);
		expect(row.ledgerQuantity).toBe(30);
	});

	it('decrements by one after each day, without anything being logged', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Contacts A', category: 'baby_care', quantity: 30, consumeIntervalDays: 1,
		});
		const id = made.body.item.id;
		await backdate(id, new Date(Date.now() - 1 * 86400000).toISOString(), 0);

		const list = await call('GET', token, '/api/v1/inventory');
		expect(list.body.items.find((i: any) => i.id === id).quantity).toBe(29);
	});

	it('does not decrement again when the page is simply reloaded', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Contacts B', category: 'baby_care', quantity: 30, consumeIntervalDays: 1,
		});
		const id = made.body.item.id;
		await backdate(id, new Date(Date.now() - 1 * 86400000).toISOString(), 0);

		await call('GET', token, '/api/v1/inventory');
		await call('GET', token, '/api/v1/inventory');
		const list = await call('GET', token, '/api/v1/inventory');
		expect(list.body.items.find((i: any) => i.id === id).quantity).toBe(29);
	});

	it('catches up every missed day rather than billing just one', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Contacts C', category: 'baby_care', quantity: 30, consumeIntervalDays: 1,
		});
		const id = made.body.item.id;
		await backdate(id, new Date(Date.now() - 10 * 86400000).toISOString(), 0);

		const list = await call('GET', token, '/api/v1/inventory');
		expect(list.body.items.find((i: any) => i.id === id).quantity).toBe(20);
	});

	it('leaves a fortnightly item alone until a fortnight has passed', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Contacts biweekly', category: 'baby_care', quantity: 6, consumeIntervalDays: 14,
		});
		const id = made.body.item.id;
		await backdate(id, new Date(Date.now() - 13 * 86400000).toISOString(), 0);
		expect((await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === id).quantity).toBe(6);

		await backdate(id, new Date(Date.now() - 14 * 86400000).toISOString(), 0);
		expect((await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === id).quantity).toBe(5);
	});

	it('counts the missed cycles towards the forecast rate', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Contacts D', category: 'baby_care', quantity: 30, consumeIntervalDays: 1,
		});
		const id = made.body.item.id;
		await backdate(id, new Date(Date.now() - 30 * 86400000).toISOString(), 0);

		const row = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === id);
		expect(row.consumptionPerDay).toBeCloseTo(1, 1);
		expect(row.daysOfCover).toBeCloseTo(0, 0);   // all 30 used
	});

	it('leaves an event-linked item on its logged path', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			name: 'Diapers', category: 'diapers', quantity: 10, eventCategory: 'diapers', decrementPerEvent: 1,
		});
		const row = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === made.body.item.id);
		expect(row.consumeIntervalDays).toBeNull();
		expect(row.quantity).toBe(10);
	});
});
