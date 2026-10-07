// src/growth-units.test.ts
//
// The WHO reference tables are metric, and both the API schema and the column
// default to imperial. Before this, an imperial weight was compared against
// those tables unconverted, so a 12 lb baby read as 12 kg and the percentile
// came back as the top of the scale.
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

let token = '';
let memberId = 0;
const BIRTH = '2026-01-01T00:00:00.000Z';
const AT_12_WEEKS = '2026-03-26T00:00:00.000Z';

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'growth-units@example.com', password: 'StrongP4ss!', firstName: 'G', lastName: 'Units',
	});
	token = reg.body.token;
	const familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Measure', stage: 'infant', birthDate: BIRTH, gender: 'male',
	});
	memberId = member.body.member.id;
});

describe('growth percentiles understand the unit they were entered in', () => {
	it('does not read a 12 lb baby as 12 kg', async () => {
		// 12 lb is 5.44 kg. At 12 weeks the WHO p50 is 7.0 kg, so this sits low —
		// nowhere near the top of the scale it used to report.
		const made = await call('POST', token, '/api/v1/growth', {
			memberId,
			measurementDate: AT_12_WEEKS,
			weight: 12,
			unitSystem: 'imperial',
		});
		expect(made.status).toBe(200);
		expect(made.body.growth.weight_percentile).toBeLessThan(50);
	});

	it('places the same physical weight the same way in either unit', async () => {
		// 15 lb is 6.8039 kg, so the metric side uses the exact conversion rather
		// than a rounded 6.8. The percentile is continuous now, which is what makes
		// a 0.004 kg difference visible at all — the old bucket hid it.
		const imperial = await call('POST', token, '/api/v1/growth', {
			memberId, measurementDate: '2026-04-02T00:00:00.000Z', weight: 15, unitSystem: 'imperial',
		});
		const metric = await call('POST', token, '/api/v1/growth', {
			memberId, measurementDate: '2026-04-03T00:00:00.000Z', weight: 6.80388, unitSystem: 'metric',
		});
		expect(imperial.body.growth.weight_percentile).toBe(metric.body.growth.weight_percentile);
	});

	it('gives a rounded input a correspondingly rounded percentile', async () => {
		// 6.8 kg is 0.004 kg below 15 lb, so it should read fractionally lower.
		const imperial = await call('POST', token, '/api/v1/growth', {
			memberId, measurementDate: '2026-04-04T00:00:00.000Z', weight: 15, unitSystem: 'imperial',
		});
		const metric = await call('POST', token, '/api/v1/growth', {
			memberId, measurementDate: '2026-04-05T00:00:00.000Z', weight: 6.8, unitSystem: 'metric',
		});
		const a = imperial.body.growth.weight_percentile;
		const b = metric.body.growth.weight_percentile;
		expect(Math.abs(a - b)).toBeLessThan(1);
	});

	it('reports chart values in metric whatever unit was used to log them', async () => {
		const chart = await call('GET', token, `/api/v1/growth/${memberId}/chart-data`);
		expect(chart.status).toBe(200);

		const imperialRow = chart.body.measurements.find((m: any) => m.unit_system === 'imperial' && m.weight === 15);
		expect(imperialRow).toBeTruthy();
		// 15 lb -> ~6.8 kg, so it plots on the same axis as the kg reference lines.
		expect(imperialRow.weight_kg).toBeCloseTo(6.8, 1);

		const metricRow = chart.body.measurements.find((m: any) => m.unit_system === 'metric' && m.weight === 6.8);
		expect(metricRow.weight_kg).toBeCloseTo(6.8, 1);
	});

	it('offers the WHO bands for the child to be plotted against', async () => {
		const chart = await call('GET', token, `/api/v1/growth/${memberId}/chart-data`);
		const bands = chart.body.who_standards.weight_for_age;
		expect(bands.length).toBeGreaterThan(0);
		expect(bands[0]).toHaveProperty('age_weeks');
		expect(bands[0]).toHaveProperty('p50');
	});
});
