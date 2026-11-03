// reports.test.ts
//
// The Reports page is only as honest as its bucketing: a millilitre read as an
// ounce, a pump counted as a feed, or a recount counted as consumption are all
// numbers that look plausible and are wrong. These pin the pure aggregator,
// then a thin pass through the HTTP route proves the query wiring matches.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { buildDailyReport, type ItemMeta } from './reports';

const items = (rows: Array<[number, ItemMeta]>) => new Map(rows);

describe('buildDailyReport buckets a family clock, not the server clock', () => {
	it('splits pump, formula and bottled milk into their own series', () => {
		const report = buildDailyReport({
			dates: ['2026-11-01', '2026-11-02'],
			timeZone: 'UTC',
			feedings: [
				// 100 ml is 3.38 oz, not 100.
				{ type: 'pump', amount: 100, amount_unit: 'ml', start_time: '2026-11-01T12:00:00.000Z' },
				{ type: 'formula', amount: 5, amount_unit: 'oz', start_time: '2026-11-02T12:00:00.000Z' },
				{ type: 'bottle', amount: 4, amount_unit: 'oz', start_time: '2026-11-02T13:00:00.000Z' },
				// A breast feed has no logged volume and must not move a series.
				{ type: 'breast', duration: 900000, start_time: '2026-11-02T14:00:00.000Z' },
			],
			adjustments: [],
			items: items([]),
		});

		expect(report.days[0]).toMatchObject({ date: '2026-11-01', pumpedOz: 3.38, formulaOz: 0, bottleFedOz: 0 });
		expect(report.days[1]).toMatchObject({ date: '2026-11-02', pumpedOz: 0, formulaOz: 5, bottleOz: 4, bottleFedOz: 9 });
	});

	it('drops anything outside the window instead of leaking it into an edge bucket', () => {
		const report = buildDailyReport({
			dates: ['2026-11-02'],
			timeZone: 'UTC',
			feedings: [
				{ type: 'pump', amount: 2, amount_unit: 'oz', start_time: '2026-11-01T23:00:00.000Z' },
				{ type: 'pump', amount: 3, amount_unit: 'oz', start_time: '2026-11-02T01:00:00.000Z' },
			],
			adjustments: [],
			items: items([]),
		});
		expect(report.days).toHaveLength(1);
		expect(report.days[0]!.pumpedOz).toBe(3);
	});

	it('assigns a near-midnight instant to the local day, not the UTC one', () => {
		const feeding = { type: 'pump', amount: 6, amount_unit: 'oz', start_time: '2026-11-01T03:00:00.000Z' };
		const dates = ['2026-10-31', '2026-11-01'];

		// 03:00 UTC on Nov 1 is still Oct 31 in New York.
		const ny = buildDailyReport({ dates, timeZone: 'America/New_York', feedings: [feeding], adjustments: [], items: items([]) });
		expect(ny.days.find((d) => d.date === '2026-10-31')!.pumpedOz).toBe(6);
		expect(ny.days.find((d) => d.date === '2026-11-01')!.pumpedOz).toBe(0);

		const utc = buildDailyReport({ dates, timeZone: 'UTC', feedings: [feeding], adjustments: [], items: items([]) });
		expect(utc.days.find((d) => d.date === '2026-11-01')!.pumpedOz).toBe(6);
	});

	it('counts consumption as usage, keeps a recount separate, and ignores purchases', () => {
		const report = buildDailyReport({
			dates: ['2026-11-01', '2026-11-02'],
			timeZone: 'UTC',
			feedings: [],
			adjustments: [
				{ item_id: 1, change: -2, reason: 'used', created_at: '2026-11-01T08:00:00.000Z' },
				{ item_id: 1, change: -3, reason: 'used', created_at: '2026-11-01T20:00:00.000Z' },
				{ item_id: 1, change: -1, reason: 'correction', created_at: '2026-11-02T09:00:00.000Z' },
				{ item_id: 1, change: 12, reason: 'purchase', created_at: '2026-11-02T09:00:00.000Z' },
			],
			items: items([[1, { name: 'Diapers', category: 'diapers', unit: 'count' }]]),
		});

		expect(report.days[0]!.used).toBe(5);
		expect(report.days[0]!.corrected).toBe(0);
		expect(report.days[1]!.used).toBe(0);
		expect(report.days[1]!.corrected).toBe(-1);

		expect(report.items).toHaveLength(1);
		expect(report.items[0]).toMatchObject({ itemId: 1, name: 'Diapers', category: 'diapers', unit: 'count' });
		expect(report.items[0]!.daily).toEqual({ '2026-11-01': 5 });

		expect(report.categories).toEqual([
			{ category: 'diapers', unit: 'count', daily: { '2026-11-01': 5 } },
		]);
	});

	it('rolls usage up per item and per category, busiest first, with the variant shown', () => {
		const report = buildDailyReport({
			dates: ['2026-11-01'],
			timeZone: 'UTC',
			feedings: [],
			adjustments: [
				{ item_id: 1, change: -1, reason: 'used', created_at: '2026-11-01T08:00:00.000Z' },
				{ item_id: 2, change: -9, reason: 'used', created_at: '2026-11-01T08:00:00.000Z' },
			],
			items: items([
				[1, { name: 'Formula', category: 'formula', unit: 'oz' }],
				[2, { name: 'Diapers', category: 'diapers', unit: 'count' }],
			]),
		});

		expect(report.items.map((i) => i.itemId)).toEqual([2, 1]);
		expect(report.categories.map((c) => c.category)).toEqual(['diapers', 'formula']);
		expect(report.categories.every((c) => c.daily['2026-11-01'] == null ? false : true)).toBe(true);
	});

	it('dropping an unparseable timestamp rather than bucketing it into today', () => {
		const report = buildDailyReport({
			dates: ['2026-11-01'],
			timeZone: 'UTC',
			feedings: [{ type: 'pump', amount: 4, amount_unit: 'oz', start_time: 'not-a-date' }],
			adjustments: [{ item_id: 1, change: -1, reason: 'used', created_at: '' }],
			items: items([]),
		});
		expect(report.days[0]!.pumpedOz).toBe(0);
		expect(report.days[0]!.used).toBe(0);
	});
});

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

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

let token = '';
let memberId = 0;
let itemId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'reports@example.com', password: 'StrongP4ss!', firstName: 'Report', lastName: 'Test',
	});
	token = reg.body.token;
	const familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Reported', stage: 'infant', birthDate: daysAgo(120), gender: 'female',
	});
	memberId = member.body.member.id;

	const item = await call('POST', token, '/api/v1/inventory', {
		name: 'Test Formula', category: 'formula', quantity: 10, unit: 'oz',
	});
	itemId = item.body.item.id;
});

describe('GET /reports/daily', () => {
	it('returns one bucket per day with the pump and formula totals', async () => {
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: daysAgo(0), type: 'pump', amount: 100, amountUnit: 'ml' });
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: daysAgo(1), type: 'formula', amount: 5, amountUnit: 'oz' });
		// A manual "used" adjustment is the same ledger row an auto-decrement writes.
		await call('POST', token, `/api/v1/inventory/${itemId}/adjust`, { change: -2, reason: 'used' });

		const res = await call('GET', token, '/api/v1/reports/daily?days=7');
		expect(res.status).toBe(200);
		expect(res.body.report.days).toHaveLength(7);

		const today = res.body.report.days[6];
		expect(today.pumpedOz).toBeCloseTo(3.38, 2);
		expect(today.used).toBe(2);
		// The opening 10-unit stock is a purchase, not usage.
		expect(res.body.report.items.find((i: any) => i.itemId === itemId).daily[today.date]).toBe(2);
	});

	it('rejects a member the caller cannot see', async () => {
		const res = await call('GET', token, '/api/v1/reports/daily?days=7&memberId=999999');
		expect(res.status).toBe(404);
	});
});
