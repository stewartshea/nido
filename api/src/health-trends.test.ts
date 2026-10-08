// src/health-trends.test.ts
//
// The dashboard tiles answer "how long ago"; trends answer "how often". These
// pin the rates, since an average over the wrong window is a number that looks
// plausible and is wrong.
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

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

let token = '';
let memberId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'trends@example.com', password: 'StrongP4ss!', firstName: 'Trend', lastName: 'Test',
	});
	token = reg.body.token;
	const familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Grower', stage: 'infant', birthDate: daysAgo(120), gender: 'male',
	});
	memberId = member.body.member.id;
});

describe('trends report rates, not totals', () => {
	it('gives feeds and diapers per day over the week', async () => {
		// 14 feeds and 21 changes across 7 days = 2 and 3 a day.
		for (let i = 0; i < 14; i++) {
			await call('POST', token, '/api/v1/feedings', { memberId, startTime: daysAgo(i % 7), type: 'bottle', amount: 3 });
		}
		for (let i = 0; i < 21; i++) {
			await call('POST', token, '/api/v1/diapers', { memberId, changeTime: daysAgo(i % 7), type: 'wet' });
		}

		const res = await call('GET', token, `/api/v1/health/insights/${memberId}`);
		expect(res.status).toBe(200);
		expect(res.body.insights.trends.periodDays).toBe(7);
		expect(res.body.insights.trends.feedsPerDay).toBe(2);
		expect(res.body.insights.trends.diapersPerDay).toBe(3);
	});

	it('always returns numbers for the rates, never null', async () => {
		// A quiet week is 0 a day, not an error and not a missing field — the UI
		// would have to special-case every one to render a dash otherwise.
		const res = await call('GET', token, `/api/v1/health/insights/${memberId}`);
		const t = res.body.insights.trends;
		for (const key of ['feedsPerDay', 'diapersPerDay', 'sleepHoursPerDay']) {
			expect(typeof t[key], `${key} should be a number`).toBe('number');
			expect(t[key]).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('the weight trend', () => {
	it('is null with no readings, so nothing is invented', async () => {
		const res = await call('GET', token, `/api/v1/health/insights/${memberId}`);
		expect(res.body.insights.trends.weight).toBeNull();
	});

	it('reports a single reading as a weight, not a rate', async () => {
		await call('POST', token, '/api/v1/growth', { memberId, measurementDate: daysAgo(3), weight: 6.2, unitSystem: 'metric' });
		const res = await call('GET', token, `/api/v1/health/insights/${memberId}`);
		const w = res.body.insights.trends.weight;
		expect(w.measurements).toBe(1);
		expect(w.latestKg).toBe(6.2);
		expect(w.changePerDayKg).toBe(0);
	});

	it('reports gain per day and per week across the readings it has', async () => {
		// 4.0 kg 20 days ago and 4.6 kg today: 0.03 kg/day, 0.21 kg/week.
		const other = await call('POST', token, `/api/v1/families/${(jwt.decode(token) as any).familyId}/members`, {
			type: 'child', name: 'Weigher', stage: 'infant', birthDate: daysAgo(120), gender: 'male',
		});
		const id = other.body.member.id;
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(20), weight: 4.0, unitSystem: 'metric' });
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(0), weight: 4.6, unitSystem: 'metric' });

		const res = await call('GET', token, `/api/v1/health/insights/${id}`);
		const w = res.body.insights.trends.weight;
		expect(w.measurements).toBe(2);
		expect(w.changePerDayKg).toBeCloseTo(0.03, 3);
		expect(Math.round(w.changePerWeekKg * 1000)).toBe(210);
		expect(w.spanDays).toBe(20);
	});

	it('keeps gram precision in the weekly figure', async () => {
		// 0.06 kg/day is 420 g/week. Rounding the weekly value to one decimal
		// before the UI converts to grams silently reported 400.
		const m = await call('POST', token, `/api/v1/families/${(jwt.decode(token) as any).familyId}/members`, {
			type: 'child', name: 'Precise', stage: 'infant', birthDate: daysAgo(120), gender: 'male',
		});
		const id = m.body.member.id;
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(10), weight: 4.0, unitSystem: 'metric' });
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(0), weight: 4.6, unitSystem: 'metric' });

		const res = await call('GET', token, `/api/v1/health/insights/${id}`);
		const w = res.body.insights.trends.weight;
		expect(w.changePerDayKg).toBeCloseTo(0.06, 3);
		expect(Math.round(w.changePerWeekKg * 1000)).toBe(420);
	});

	it('converts imperial readings before comparing them', async () => {
		// 10 lb -> 4.54 kg, 12 lb -> 5.44 kg. Reading the numbers raw would give a
		// rate in "lb per day" plotted against kg, which is the same bug the
		// percentile comparison had.
		const imp = await call('POST', token, `/api/v1/families/${(jwt.decode(token) as any).familyId}/members`, {
			type: 'child', name: 'Imperial', stage: 'infant', birthDate: daysAgo(120), gender: 'male',
		});
		const id = imp.body.member.id;
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(10), weight: 10, unitSystem: 'imperial' });
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(0), weight: 12, unitSystem: 'imperial' });

		const res = await call('GET', token, `/api/v1/health/insights/${id}`);
		const w = res.body.insights.trends.weight;
		// (5.443 - 4.536) kg over 10 days = 0.0907 kg/day
		expect(w.changePerDayKg).toBeCloseTo(0.091, 2);
		expect(w.latestKg).toBeCloseTo(5.4, 1);
	});

	it('does not divide by zero when both readings are the same day', async () => {
		const same = await call('POST', token, `/api/v1/families/${(jwt.decode(token) as any).familyId}/members`, {
			type: 'child', name: 'SameDay', stage: 'infant', birthDate: daysAgo(120), gender: 'male',
		});
		const id = same.body.member.id;
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(0), weight: 4.0, unitSystem: 'metric' });
		await call('POST', token, '/api/v1/growth', { memberId: id, measurementDate: daysAgo(0), weight: 4.2, unitSystem: 'metric' });

		const res = await call('GET', token, `/api/v1/health/insights/${id}`);
		const w = res.body.insights.trends.weight;
		// The weight itself is known and reported; only the rate is withheld.
		expect(w.latestKg).toBe(4.2);
		expect(w.spanDays).toBe(0);
		expect(w.changePerDayKg).toBe(0);
	});
});
