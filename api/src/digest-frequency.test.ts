// src/digest-frequency.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { hoursUntilDigestDue } from './notifications';

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

const HOUR = 3_600_000;
const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('the cadence rule', () => {
	it('is due when it has never been sent', () => {
		// Turning the setting on should not mean waiting a week for the first one.
		expect(hoursUntilDigestDue('weekly', null, NOW)).toBe(0);
		expect(hoursUntilDigestDue(null, null, NOW)).toBe(0);
	});

	it('treats an absent frequency as hourly, which is what it always was', () => {
		expect(hoursUntilDigestDue(null, ago(2 * HOUR), NOW)).toBe(0);
		expect(hoursUntilDigestDue(undefined, ago(30 * 60_000), NOW)).toBe(1);
	});

	it('holds a daily family to a day', () => {
		expect(hoursUntilDigestDue('daily', ago(1 * HOUR), NOW)).toBe(23);
		expect(hoursUntilDigestDue('daily', ago(23 * HOUR), NOW)).toBe(1);
		expect(hoursUntilDigestDue('daily', ago(25 * HOUR), NOW)).toBe(0);
	});

	it('holds a weekly family to a week', () => {
		expect(hoursUntilDigestDue('weekly', ago(24 * HOUR), NOW)).toBe(6 * 24);
		expect(hoursUntilDigestDue('weekly', ago(6 * 24 * HOUR), NOW)).toBe(24);
		expect(hoursUntilDigestDue('weekly', ago(8 * 24 * HOUR), NOW)).toBe(0);
	});

	it('never returns a negative wait once overdue', () => {
		expect(hoursUntilDigestDue('weekly', ago(90 * 24 * HOUR), NOW)).toBe(0);
	});
});

describe('a family can choose its digest frequency', () => {
	let token = '';
	let familyId = '';

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'digest-freq@example.com', password: 'StrongP4ss!', firstName: 'Dig', lastName: 'Est',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('defaults to hourly so nothing changes on upgrade', async () => {
		const res = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(res.status).toBe(200);
		expect(res.body.settings.digestFrequency).toBe('hourly');
	});

	it('stores a chosen frequency and reads it back', async () => {
		const put = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestFrequency: 'weekly' });
		expect(put.status).toBe(200);
		expect(put.body.settings.digestFrequency).toBe('weekly');

		const got = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(got.body.settings.digestFrequency).toBe('weekly');
	});

	it('rejects a frequency that is not one of the offered ones', async () => {
		const res = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestFrequency: 'fortnightly' });
		expect(res.status).toBe(400);
	});

	it('changing it does not disturb the other family settings', async () => {
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, { stageCategories: { pet: ['feeds', 'grooming'] } });
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestFrequency: 'daily' });

		const got = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(got.body.settings.digestFrequency).toBe('daily');
		expect(got.body.settings.stageCategories.pet).toEqual(['feeds', 'grooming']);
	});
});
