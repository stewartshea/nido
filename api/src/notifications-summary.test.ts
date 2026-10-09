// src/notifications-summary.test.ts
//
// The navigation badge is only useful if it agrees with the notifications page.
// This exercises the count it reads: activity rules and inventory alerts, and
// the two clearing paths.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const HOUR = 60 * 60 * 1000;
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();

let token = '';
let familyId = '';
let memberId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'summary@example.com', password: 'StrongP4ss!', firstName: 'Sum', lastName: 'Mary',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Baby', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	memberId = member.body.member.id;
});

describe('the notification summary counts what is firing', () => {
	it('is zero when nothing is watched', async () => {
		const res = await call('GET', token, '/api/v1/notifications/summary');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ total: 0, activity: 0, inventory: 0 });
	});

	it('counts a firing activity rule, and stops when it clears', async () => {
		const made = await call('POST', token, '/api/v1/reminders', {
			kind: 'inactivity', hours: 3, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'feeds', values: ['breast'] }],
		});
		expect(made.status).toBe(201);

		let res = await call('GET', token, '/api/v1/notifications/summary');
		expect(res.body.activity).toBe(1);
		expect(res.body.total).toBe(1);

		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'breast', side: 'left' });
		res = await call('GET', token, '/api/v1/notifications/summary');
		expect(res.body.activity).toBe(0);
		expect(res.body.total).toBe(0);
	});

	it('counts a firing inventory alert', async () => {
		const item = await call('POST', token, '/api/v1/inventory', {
			name: 'Wipes', category: 'baby_care', quantity: 1, unit: 'pack',
		});
		expect(item.status).toBe(201);
		const rule = await call('POST', token, '/api/v1/inventory/rules', {
			signal: 'quantity', comparator: 'lte', threshold: 5,
		});
		expect(rule.status).toBe(201);

		const res = await call('GET', token, '/api/v1/notifications/summary');
		expect(res.body.inventory).toBe(1);
		expect(res.body.total).toBe(1);
	});
});
