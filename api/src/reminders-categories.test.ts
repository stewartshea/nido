// src/reminders-categories.test.ts
//
// Three neighbouring questions that look the same and are not:
//
//   feeds           - when did the BABY last eat. A bottle, formula or solids
//                     count; a pump does not.
//   pumping         - when did the pump last run.
//   breast_or_pump  - when was the breast last used, fed at or expressed. This
//                     is the supply question, and a bottle does not answer it.
//
// Getting these confused is how a parent is told everything is fine because the
// baby had a bottle, while nothing has been expressed for six hours.
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
const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * MIN).toISOString();

let token = '';
let memberId = 0;

async function reminderFor(category: string): Promise<any> {
	const familyId = (jwt.decode(token) as any).familyId as string;
	const made = await call('POST', token, '/api/v1/reminders', {
		kind: 'inactivity', category, targetType: 'member', targetId: memberId, hours: 3,
	});
	expect(made.status, `${category}: ${JSON.stringify(made.body)}`).toBe(201);
	const all = await call('GET', token, '/api/v1/reminders');
	return all.body.reminders.find((r: any) => r.id === made.body.reminder.id);
}

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'remcats@example.com', password: 'StrongP4ss!', firstName: 'Rem', lastName: 'Cats',
	});
	token = reg.body.token;
	const familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Baby', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	memberId = member.body.member.id;

	// The situation the three categories have to disagree about: a bottle an hour
	// ago, and nothing at the breast or from the pump for five hours.
	await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(5), type: 'pump', amount: 100, amountUnit: 'ml' });
	await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'bottle', amount: 4 });
});

describe('the three categories answer different questions', () => {
	it('breast_or_pump is overdue, because nothing has been expressed in three hours', async () => {
		const r = await reminderFor('breast_or_pump');
		expect(r.overdue).toBe(true);
		expect(r.since).toBeTruthy();
	});

	it('feeds is not overdue, because the baby had a bottle an hour ago', async () => {
		const r = await reminderFor('feeds');
		expect(r.overdue).toBe(false);
	});

	it('pumping is overdue too, and agrees with breast_or_pump here', async () => {
		const r = await reminderFor('pumping');
		expect(r.overdue).toBe(true);
	});
});

describe('breast_or_pump counts a breast feed as well as a pump', () => {
	it('clears once the baby feeds at the breast, with no pump involved', async () => {
		const id2 = await (async () => {
			const familyId = (jwt.decode(token) as any).familyId as string;
			const m = await call('POST', token, `/api/v1/families/${familyId}/members`, {
				type: 'child', name: 'Breastfed', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
			});
			return m.body.member.id;
		})();
		const saved = memberId;
		memberId = id2;
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(5), type: 'pump', amount: 80, amountUnit: 'ml' });
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'breast', side: 'left' });

		const r = await reminderFor('breast_or_pump');
		// A breast feed is as good as a pump for this question.
		expect(r.overdue).toBe(false);
		memberId = saved;
	});

	it('does not count a bottle, which is the whole point of the category', async () => {
		const id3 = await (async () => {
			const familyId = (jwt.decode(token) as any).familyId as string;
			const m = await call('POST', token, `/api/v1/families/${familyId}/members`, {
				type: 'child', name: 'Bottle only', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
			});
			return m.body.member.id;
		})();
		const saved = memberId;
		memberId = id3;
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(6), type: 'pump', amount: 80, amountUnit: 'ml' });
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'formula', amount: 4 });

		const r = await reminderFor('breast_or_pump');
		expect(r.overdue).toBe(true);
		memberId = saved;
	});
});
