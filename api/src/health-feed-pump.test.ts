// src/health-feed-pump.test.ts
//
// A pump is the parent expressing, not the baby feeding. Both are rows in
// `feedings`, so the summary has to keep them apart — otherwise "Last Feed" is
// really "last time anything was in that table", and a pump hides a bottle.
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

const MIN = 60_000;
const minsAgo = (n: number) => new Date(Date.now() - n * MIN).toISOString();

let token = '';

async function newMember(name: string): Promise<number> {
	const familyId = (jwt.decode(token) as any).familyId as string;
	const res = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name, stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	return res.body.member.id;
}

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'feedpump@example.com', password: 'StrongP4ss!', firstName: 'Feed', lastName: 'Pump',
	});
	token = reg.body.token;
});

describe('the feed and the pump are different facts', () => {
	it('does not report a pump as the last feed', async () => {
		const id = await newMember('Bottle then pump');
		await call('POST', token, '/api/v1/feedings', { memberId: id, startTime: minsAgo(60), type: 'bottle', amount: 4 });
		// The pump is more recent, which is exactly when the old query picked it.
		await call('POST', token, '/api/v1/feedings', { memberId: id, startTime: minsAgo(10), type: 'pump', amount: 120, amountUnit: 'ml' });

		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		const { latestFeeding, latestPump } = res.body.summary;
		expect(latestFeeding.type).toBe('bottle');
		expect(latestPump.type).toBe('pump');
		// The baby's last feed is an hour ago, not ten minutes ago.
		expect(new Date(latestFeeding.start_time).getTime()).toBeLessThan(new Date(latestPump.start_time).getTime());
	});

	it('leaves the last feed empty when only a pump has happened', async () => {
		const id = await newMember('Pump only');
		await call('POST', token, '/api/v1/feedings', { memberId: id, startTime: minsAgo(20), type: 'pump', amount: 90, amountUnit: 'ml' });

		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		// "No feed recorded" is the truth; showing the pump here would claim the
		// baby ate at a time they did not.
		expect(res.body.summary.latestFeeding).toBeNull();
		expect(res.body.summary.latestPump.type).toBe('pump');
	});

	it('keeps a formula or solids feed in the feed, since the baby did eat', async () => {
		for (const type of ['formula', 'breast', 'solid']) {
			const id = await newMember(`Feed ${type}`);
			await call('POST', token, '/api/v1/feedings', { memberId: id, startTime: minsAgo(15), type });
			const res = await call('GET', token, `/api/v1/health/summary/${id}`);
			expect(res.body.summary.latestFeeding.type).toBe(type);
			expect(res.body.summary.latestPump).toBeNull();
		}
	});
});
