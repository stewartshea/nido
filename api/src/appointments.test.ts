// src/appointments.test.ts
//
// "Upcoming" is any milestone row whose date has not passed, whatever kind it
// was logged under — a forward-dated first, medical visit, routine, or
// appointment is the same "schedule this" gesture. The weekly reminder is a
// gated email on top of the same rows. These cover the query shape (future
// only, any kind, soonest first; family vs member) and the cadence rule, which
// is the part that decides whether anyone is emailed at all.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { hoursUntilAppointmentEmailDue, runAppointmentDigest } from './appointments';

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

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

let token = '';
let familyId = '';
let childId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'appointments@example.com', password: 'StrongP4ss!', firstName: 'Appt', lastName: 'Owner',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Nest', stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	childId = member.body.member.id;

	// A future appointment, a future first, and a past appointment. Only the
	// two future-dated rows should appear, soonest first — a future "first"
	// counts exactly as much as a future appointment, because "upcoming" is
	// about the date, not the log category.
	await call('POST', token, '/api/v1/milestones', {
		memberId: childId, title: 'Six-week check', achievedDate: inDays(5), kind: 'appointments', category: 'checkup',
	});
	await call('POST', token, '/api/v1/milestones', {
		memberId: childId, title: 'First smile', achievedDate: inDays(3), kind: 'firsts',
	});
	await call('POST', token, '/api/v1/milestones', {
		memberId: childId, title: 'Old visit', achievedDate: inDays(-5), kind: 'appointments', category: 'checkup',
	});
});

describe('GET /milestones/upcoming', () => {
	it('returns any future-dated entry, soonest first, past omitted', async () => {
		const res = await call('GET', token, `/api/v1/milestones/upcoming?memberId=${childId}`);
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(2);
		expect(res.body.appointments.map((a: any) => a.title)).toEqual(['First smile', 'Six-week check']);
		// The kind travels with the row so the list can say what it was.
		expect(res.body.appointments[0].kind).toBe('firsts');
		expect(res.body.appointments[1].kind).toBe('appointments');
		expect(res.body.appointments[1].category).toBe('checkup');
	});

	it('lists the whole family with the member named when no memberId is given', async () => {
		const res = await call('GET', token, '/api/v1/milestones/upcoming');
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(2);
		expect(res.body.appointments[0].title).toBe('First smile');
		expect(res.body.appointments[0].memberName).toBe('Nest');
	});

	it('honours the look-ahead window', async () => {
		const soon = await call('GET', token, `/api/v1/milestones/upcoming?memberId=${childId}&days=1`);
		expect(soon.body.total).toBe(0);
		const later = await call('GET', token, `/api/v1/milestones/upcoming?memberId=${childId}&days=30`);
		expect(later.body.total).toBe(2);
	});

	it('rejects a member the caller cannot see', async () => {
		const res = await call('GET', token, '/api/v1/milestones/upcoming?memberId=99999');
		expect(res.status).toBe(404);
	});
});

describe('the weekly appointment cadence', () => {
	const NOW = Date.parse('2026-06-01T12:00:00.000Z');
	const ago = (ms: number) => new Date(NOW - ms).toISOString();

	it('is due the moment the setting is switched on, never sent before', () => {
		// Turning it on should not mean waiting a week for the first reminder.
		expect(hoursUntilAppointmentEmailDue(true, null, NOW)).toBe(0);
		expect(hoursUntilAppointmentEmailDue(true, undefined, NOW)).toBe(0);
	});

	it('is never due while switched off', () => {
		expect(hoursUntilAppointmentEmailDue(false, null, NOW)).toBe(Number.POSITIVE_INFINITY);
	});

	it('waits a week after the last send', () => {
		expect(hoursUntilAppointmentEmailDue(true, ago(2 * 3_600_000), NOW)).toBeGreaterThan(0);
		expect(hoursUntilAppointmentEmailDue(true, ago(8 * DAY), NOW)).toBe(0);
	});

	it('treats an unparseable timestamp as never sent rather than holding forever', () => {
		expect(hoursUntilAppointmentEmailDue(true, 'not-a-date', NOW)).toBe(0);
	});
});

describe('family settings carry the opt-in', () => {
	it('defaults to off and round-trips a change', async () => {
		const initial = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(initial.body.settings.appointmentNotifications).toBe(false);

		const updated = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { appointmentNotifications: true });
		expect(updated.status).toBe(200);
		expect(updated.body.settings.appointmentNotifications).toBe(true);

		const readBack = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(readBack.body.settings.appointmentNotifications).toBe(true);

		// And back off, without disturbing the digest frequency beside it.
		const off = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { appointmentNotifications: false });
		expect(off.body.settings.appointmentNotifications).toBe(false);
	});
});

describe('runAppointmentDigest', () => {
	it('sends nothing when the server has no SMTP configured', async () => {
		const outcome = await runAppointmentDigest(familyId);
		expect(outcome.skipped).toBe('smtp');
		expect(outcome.sent).toBe(0);
	});
});
