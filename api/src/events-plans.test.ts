// src/events-plans.test.ts
//
// The two tenses of Phase 1b (docs/event-model-design.md §3.1, §3.6): an
// event is a thing that happened — past at write time, zod-checked against
// the registry, stock-billing like any other record — and a plan is a thing
// that is going to, answered with done / reschedule / missed / cancel, where
// "done" writes the ordinary event through the very same path.
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

const now = () => new Date().toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

let token = '';
let familyId = '';
let memberId = 0;
let ownerId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'events-plans@example.com', password: 'StrongP4ss!', firstName: 'Eve', lastName: 'Nts',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Nia', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	memberId = member.body.member.id;
	const owner = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'adult', name: 'Jennifer', trackable: true, birthDate: '1990-01-01T00:00:00.000Z', gender: 'female',
	});
	ownerId = owner.body.member.id;
});

describe('events: records are always past', () => {
	it('creates a vitamin through the registry zod and answers in the old shape too', async () => {
		const made = await call('POST', token, '/api/v1/events', {
			memberId: ownerId, category: 'vitamins', occurredAt: now(), title: 'Vitamin D', data: { type: 'dose' },
		});
		expect(made.status).toBe(201);
		expect(made.body.event.category).toBe('vitamins');
		expect(made.body.event.data).toEqual({ type: 'dose' });
		// The translations the alias and the tiles speak.
		expect(made.body.event.kind).toBe('vitamins');
		expect(made.body.event.option).toBe('dose');
	});

	it('refuses a future record with the way out, not just a refusal', async () => {
		const made = await call('POST', token, '/api/v1/events', {
			memberId: ownerId, category: 'vitamins', occurredAt: inDays(2), title: 'A vitamin that has not happened',
		});
		expect(made.status).toBe(409);
		expect(made.body.error).toContain('schedule');
	});

	it('tolerates clock skew but not a booking', async () => {
		const skew = await call('POST', token, '/api/v1/events', {
			memberId: ownerId, category: 'vitamins', occurredAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
		});
		expect(skew.status).toBe(201);
	});

	it('refuses a category that is not stored on events', async () => {
		const made = await call('POST', token, '/api/v1/events', {
			memberId: memberId, category: 'feeds', occurredAt: now(), data: { type: 'bottle' },
		});
		expect(made.status).toBe(400);
	});

	it('bills stock linked to the category, like every record does', async () => {
		const item = await call('POST', token, '/api/v1/inventory', {
			memberId: ownerId, name: 'Vitamin D bottle', category: 'vitamins', quantity: 90,
			consumptionRule: { sourceCategory: 'vitamins', conditions: [{ attr: 'type', values: ['dose'] }], unitsPerUse: 1, amountPerUse: 1 },
		});
		expect(item.status).toBe(201);
		await call('POST', token, '/api/v1/events', {
			memberId: ownerId, category: 'vitamins', occurredAt: now(), title: 'Dose', data: { type: 'dose' },
		});
		const after = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.name === 'Vitamin D bottle');
		expect(after.quantity).toBe(89);
		// A refill, not a dose, does not bill.
		await call('POST', token, '/api/v1/events', {
			memberId: ownerId, category: 'vitamins', occurredAt: now(), title: 'Bought more', data: { type: 'refill' },
		});
		const final = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.name === 'Vitamin D bottle');
		expect(final.quantity).toBe(89);
	});
});

describe('plans: bookings and their answers', () => {
	it('books only what fulfilment can write — events-backed, bookable categories', async () => {
		const ok = await call('POST', token, '/api/v1/plans', {
			memberId: memberId, category: 'appointments', scheduledAt: inDays(7), title: 'Six-month checkup', data: { type: 'checkup' },
		});
		expect(ok.status).toBe(201);
		expect(ok.body.plan.status).toBe('planned');
		expect(ok.body.plan.overdue).toBe(false);

		// Vaccinations declare book in the registry, but stay a typed table
		// until Phase 2 — a vaccine plan could never be answered.
		const typed = await call('POST', token, '/api/v1/plans', {
			memberId: memberId, category: 'vaccines', scheduledAt: inDays(30),
		});
		expect(typed.status).toBe(400);

		const unbookable = await call('POST', token, '/api/v1/plans', {
			memberId: memberId, category: 'firsts', scheduledAt: inDays(1),
		});
		expect(unbookable.status).toBe(400);
	});

	it('reads overdue plans as the prompt, soonest first regardless', async () => {
		await call('POST', token, '/api/v1/plans', {
			memberId: memberId, category: 'medical', scheduledAt: daysAgo(1), title: 'Overdue visit', data: { visitType: 'wellness' },
		});
		const list = await call('GET', token, '/api/v1/plans');
		expect(list.status).toBe(200);
		const titles = list.body.plans.map((p: any) => p.title);
		expect(titles).toEqual(['Overdue visit', 'Six-month checkup']);
		expect(list.body.plans[0].overdue).toBe(true);
		expect(list.body.plans[1].overdue).toBe(false);
	});

	it('fulfils through the ordinary event path, capturing scheduled ≠ actual', async () => {
		const booked = await call('POST', token, '/api/v1/plans', {
			memberId: memberId, category: 'appointments', scheduledAt: inDays(1) , title: 'Dentist', data: { type: 'checkup' },
		});
		expect(booked.status).toBe(201);
		const id = booked.body.plan.id;

		// Answered on the day, at the real time rather than the booked one.
		const done = await call('POST', token, `/api/v1/plans/${id}/fulfil`, {
			occurredAt: now(),
		});
		expect(done.status).toBe(200);
		expect(done.body.plan.status).toBe('fulfilled');
		expect(done.body.plan.fulfilled_by).toBe(done.body.event.id);
		expect(done.body.event.title).toBe('Dentist');
		expect(done.body.event.data).toEqual({ type: 'checkup' });

		// Answered plans leave the open list.
		const list = await call('GET', token, '/api/v1/plans');
		expect(list.body.plans.map((p: any) => p.title)).not.toContain('Dentist');

		// Only an open plan can be answered again.
		const again = await call('POST', token, `/api/v1/plans/${id}/fulfil`, {});
		expect(again.status).toBe(409);
	});

	it('reschedules, misses and cancels, each answer a different fact', async () => {
		const a = await call('POST', token, '/api/v1/plans', { memberId: memberId, category: 'appointments', scheduledAt: inDays(2), title: 'A' });
		const b = await call('POST', token, '/api/v1/plans', { memberId: memberId, category: 'medical', scheduledAt: inDays(2), title: 'B' });
		const c = await call('POST', token, '/api/v1/plans', { memberId: memberId, category: 'appointments', scheduledAt: inDays(2), title: 'C' });

		const newTime = inDays(9);
		const rescheduled = await call('POST', token, `/api/v1/plans/${a.body.plan.id}/reschedule`, { scheduledAt: newTime });
		expect(rescheduled.body.plan.status).toBe('planned');
		expect(rescheduled.body.plan.scheduled_at).toBe(newTime);

		const missed = await call('POST', token, `/api/v1/plans/${b.body.plan.id}/missed`, {});
		expect(missed.body.plan.status).toBe('missed');

		const cancelled = await call('POST', token, `/api/v1/plans/${c.body.plan.id}/cancel`, {});
		expect(cancelled.body.plan.status).toBe('cancelled');

		// Only the rescheduled one is still a question.
		const open = await call('GET', token, '/api/v1/plans');
		expect(open.body.plans.map((p: any) => p.title)).toContain('A');
		expect(open.body.plans.map((p: any) => p.title)).not.toContain('B');
		expect(open.body.plans.map((p: any) => p.title)).not.toContain('C');

		// History keeps the answers.
		const missedList = await call('GET', token, '/api/v1/plans?status=missed');
		expect(missedList.body.plans.map((p: any) => p.title)).toContain('B');
	});
});
