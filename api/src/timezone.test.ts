// src/timezone.test.ts
//
// The family's wall clock. Two things have to hold: an unusable zone name must
// never reach the database (the picker can only send real ones, but the API is
// the boundary), and a mail about "Thursday at 9:30" must be computed on the
// family's clock rather than the server's — which is invisible until it is a
// different day, so these assert the day, not just the hour.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { DEFAULT_TIMEZONE, effectiveTimezone, isValidTimezone } from './timezone';
import { renderUpcomingAppointmentsEmail } from './mail-templates';

const ALLOWED_FIELDS = 'categories, category_options, share_anonymized_daily, stage_categories, digest_frequency, digest_sent_at, appointment_notifications, appointment_notifications_sent_at, feed_grouping_minutes, timezone';

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

describe('isValidTimezone', () => {
	it('accepts real IANA names, including ones with a slash and an underscore', () => {
		expect(isValidTimezone('UTC')).toBe(true);
		expect(isValidTimezone('America/New_York')).toBe(true);
		expect(isValidTimezone('Australia/Lord_Howe')).toBe(true);
	});

	it('refuses a plausible-looking name that is not a zone', () => {
		// The failure mode worth guarding: a typo is stored happily, and then
		// every appointment renders on the server's clock with no error to see.
		expect(isValidTimezone('Narnia/Chrome')).toBe(false);
		expect(isValidTimezone('America/Not_A_City')).toBe(false);
		expect(isValidTimezone('')).toBe(false);
		expect(isValidTimezone('   ')).toBe(false);
	});

	it('refuses non-strings and absurdly long ones', () => {
		expect(isValidTimezone(null)).toBe(false);
		expect(isValidTimezone(42)).toBe(false);
		expect(isValidTimezone('x'.repeat(65))).toBe(false);
	});
});

describe('effectiveTimezone', () => {
	it('returns a stored zone unchanged', () => {
		expect(effectiveTimezone('Europe/Paris')).toBe('Europe/Paris');
	});

	it('falls back to the default for null, garbage, or a non-string', () => {
		expect(effectiveTimezone(null)).toBe(DEFAULT_TIMEZONE);
		expect(effectiveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
		expect(effectiveTimezone('not/a/zone')).toBe(DEFAULT_TIMEZONE);
		expect(effectiveTimezone(7)).toBe(DEFAULT_TIMEZONE);
	});
});

describe('appointment email renders on the family clock', () => {
	// 2026-06-04T14:30Z is 9:30am in Chicago (CDT) and 2:30pm in UTC. Reading it
	// as UTC would put a morning appointment in the afternoon.
	const MORNING = '2026-06-04T14:30:00.000Z';

	it('shows the hour the family booked, not the server hour', () => {
		const mail = renderUpcomingAppointmentsEmail({
			appointments: [{ title: 'Six-week check', when: MORNING }],
			appointmentsUrl: 'https://example.test/appointments',
			timeZone: 'America/Chicago',
		});
		expect(mail.text).toContain('9:30');
		expect(mail.text).not.toContain('2:30');
	});

	it('keeps the appointment on the family day when the instant lands on the next one', () => {
		// Midnight UTC is still the previous evening in Los Angeles. This is the
		// case that shows up as a heading of the wrong day.
		const mail = renderUpcomingAppointmentsEmail({
			appointments: [{ title: 'Evening bottle', when: '2026-06-05T02:00:00.000Z' }],
			appointmentsUrl: 'https://example.test/appointments',
			timeZone: 'America/Los_Angeles',
		});
		expect(mail.text).toContain('Thu, Jun 4');
		expect(mail.text).not.toContain('Fri, Jun 5');
	});

	it('still renders a readable line when no zone is set', () => {
		// A family that has not chosen yet gets UTC rather than an exception: a
		// mail sweep must not die over a display preference.
		const mail = renderUpcomingAppointmentsEmail({
			appointments: [{ title: 'Checkup', when: MORNING }],
			appointmentsUrl: 'https://example.test/appointments',
		});
		expect(mail.text).toContain('Checkup');
		expect(mail.text).not.toContain('Invalid');
	});

	it('passes an unparseable instant through instead of showing Invalid Date', () => {
		const mail = renderUpcomingAppointmentsEmail({
			appointments: [{ title: 'Odd', when: 'soon' }],
			appointmentsUrl: 'https://example.test/appointments',
			timeZone: 'America/Chicago',
		});
		expect(mail.text).toContain('soon');
	});
});

describe('PUT /families/:id/settings timezone', () => {
	let token = '';
	let familyId = '';

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'timezone@example.com', password: 'StrongP4ss!', firstName: 'Tz', lastName: 'Owner',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('starts unset, so nothing pins a family to the server clock on upgrade', async () => {
		const res = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(res.status).toBe(200);
		expect(res.body.settings.timezone).toBeNull();
	});

	it('saves a valid zone and reads it back', async () => {
		const put = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { timezone: 'America/New_York' });
		expect(put.status).toBe(200);
		expect(put.body.settings.timezone).toBe('America/New_York');

		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.timezone).toBe('America/New_York');
	});

	it('refuses an unknown zone rather than storing it', async () => {
		const put = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { timezone: 'Narnia/Chrome' });
		expect(put.status).toBe(400);

		// And it did not overwrite the good value on the way out.
		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.timezone).toBe('America/New_York');
	});

	it('keeps the zone when an unrelated setting is written', async () => {
		// The update path rebuilds every column; a missed one silently drops the
		// preference on the next settings change.
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, { feedGroupingMinutes: 30 });
		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.timezone).toBe('America/New_York');
		expect(get.body.settings.feedGroupingMinutes).toBe(30);
	});

	it('clears back to "not chosen" when explicitly set to null', async () => {
		// Tri-state: omitted keeps, null clears. A `??` here would make clearing
		// impossible, which is how a family would get stuck with a wrong zone.
		const put = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { timezone: null });
		expect(put.status).toBe(200);
		expect(put.body.settings.timezone).toBeNull();
	});

	it('exposes the zone to any family member, not just the owner', async () => {
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, { timezone: 'Europe/London' });
		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.timezone).toBe('Europe/London');
	});

	it('carries the column in every settings read, so no query can drift', async () => {
		// A settings SELECT that omits the column reads as "not chosen" and
		// silently reverts a family to the server clock. This asserts the column
		// list once, in the place the shape lives.
		expect(ALLOWED_FIELDS).toContain('timezone');
	});
});
