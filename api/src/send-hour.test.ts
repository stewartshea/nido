// src/send-hour.test.ts
//
// "Send at 9am" is the one feature where a timezone preference stops being a
// display concern and starts scheduling work, so the edge cases matter more than
// the happy path.
//
// The scheduler ticks on a fixed interval, which means the sweep that *should*
// send is whichever tick first lands at or after the chosen hour. A single-hour
// equality check is wrong for two separate reasons, and both are tested here:
// a tick that lands at 09:30 would never equal 9, and an interval that does not
// divide an hour evenly walks past the hour entirely on some days.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { withinSendHour, zonedParts } from './timezone';

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

/** A local wall clock time in `zone`, as the UTC instant that produces it. */
function localHour(zone: string, iso: string): number {
	return zonedParts(Date.parse(iso), zone).hour;
}

describe('zonedParts', () => {
	it('reads the local hour, not the server hour', () => {
		expect(localHour('America/New_York', '2026-06-01T13:30:00Z')).toBe(9);
		expect(localHour('Europe/London', '2026-06-01T13:30:00Z')).toBe(14);
		expect(localHour('UTC', '2026-06-01T13:30:00Z')).toBe(13);
	});

	it('renders midnight as hour 0 rather than 24', () => {
		// Some ICU builds write "24" for midnight under hour12: false; a family
		// choosing midnight would then never match its own hour.
		expect(localHour('UTC', '2026-06-01T00:00:00Z')).toBe(0);
		expect(localHour('America/New_York', '2026-06-01T04:00:00Z')).toBe(0);
	});

	it('follows the zone across a DST boundary, which a fixed offset cannot', () => {
		// New York is UTC-5 in January and UTC-4 in June. The same UTC hour is a
		// different local hour either side, so "9am local" is a different instant.
		expect(localHour('America/New_York', '2026-01-15T14:00:00Z')).toBe(9);
		expect(localHour('America/New_York', '2026-06-15T13:00:00Z')).toBe(9);
		// And the offset really did change: 14:00Z is not 9am in June.
		expect(localHour('America/New_York', '2026-06-15T14:00:00Z')).toBe(10);
	});

	it('handles a zone that is not a whole hour from UTC', () => {
		// Kathmandu is UTC+5:45, so the local hour turns over on the 15-minute mark.
		expect(localHour('Asia/Kathmandu', '2026-06-01T08:45:00Z')).toBe(14);
		expect(localHour('Asia/Kathmandu', '2026-06-01T09:00:00Z')).toBe(14);
	});
});

describe('withinSendHour', () => {
	const zone = 'America/New_York';
	// 13:00Z is 9:00am in New York in June.
	const at = (iso: string) => Date.parse(iso);

	it('opens on the hour', () => {
		expect(withinSendHour(at('2026-06-15T13:00:00Z'), zone, 9)).toBe(true);
	});

	it('stays open through the hour, so a half-past tick still sends', () => {
		// The case that makes an equality check wrong: a 30-minute interval lands
		// at 09:30, never at 09:00.
		expect(withinSendHour(at('2026-06-15T13:30:00Z'), zone, 9)).toBe(true);
		expect(withinSendHour(at('2026-06-15T13:59:00Z'), zone, 9)).toBe(true);
	});

	it('closes at the next hour, so one morning cannot send twice', () => {
		expect(withinSendHour(at('2026-06-15T14:00:00Z'), zone, 9)).toBe(false);
		expect(withinSendHour(at('2026-06-15T12:59:00Z'), zone, 9)).toBe(false);
	});

	it('is closed the rest of the day', () => {
		for (const iso of ['2026-06-15T00:00:00Z', '2026-06-15T05:00:00Z', '2026-06-15T20:00:00Z']) {
			expect(withinSendHour(at(iso), zone, 9)).toBe(false);
		}
	});

	it('sends at the same local hour either side of a DST change', () => {
		// January: 9am New York is 14:00Z. June: it is 13:00Z. A hard-coded
		// offset would send one of these an hour early or late.
		expect(withinSendHour(at('2026-01-15T14:00:00Z'), zone, 9)).toBe(true);
		expect(withinSendHour(at('2026-06-15T13:00:00Z'), zone, 9)).toBe(true);
		expect(withinSendHour(at('2026-06-15T14:00:00Z'), zone, 9)).toBe(false);
	});

	it('honours a non-hour offset zone', () => {
		// 9am in Kathmandu (UTC+5:45) is 03:15Z.
		expect(withinSendHour(at('2026-06-15T03:15:00Z'), 'Asia/Kathmandu', 9)).toBe(true);
		expect(withinSendHour(at('2026-06-15T03:59:00Z'), 'Asia/Kathmandu', 9)).toBe(true);
		// The local hour turns over at :45, so 04:00Z is 09:45 local and still
		// inside the window; it closes at 04:15Z.
		expect(withinSendHour(at('2026-06-15T04:00:00Z'), 'Asia/Kathmandu', 9)).toBe(true);
		expect(withinSendHour(at('2026-06-15T04:15:00Z'), 'Asia/Kathmandu', 9)).toBe(false);
	});

	it('treats an unusable zone as UTC rather than throwing', () => {
		expect(withinSendHour(at('2026-06-15T09:00:00Z'), 'Narnia/Chrome', 9)).toBe(true);
	});

	it('lets a window narrower than an hour be asked for explicitly', () => {
		expect(withinSendHour(at('2026-06-15T13:10:00Z'), zone, 9, 10)).toBe(true);
		expect(withinSendHour(at('2026-06-15T13:11:00Z'), zone, 9, 10)).toBe(false);
	});
});

describe('the send hour is a family setting', () => {
	let token = '';
	let familyId = '';

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'send-hour@example.com', password: 'StrongP4ss!', firstName: 'Send', lastName: 'Hour',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('defaults to null, which means "send as soon as due"', async () => {
		// The value every existing family has, and the reason an upgrade changes
		// nobody's inbox.
		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.digestSendHour).toBeNull();
		expect(get.body.settings.appointmentSendHour).toBeNull();
	});

	it('round-trips an hour, and can be cleared back to null', async () => {
		const set = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: 7 });
		expect(set.status).toBe(200);
		expect(set.body.settings.digestSendHour).toBe(7);

		const cleared = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: null });
		expect(cleared.body.settings.digestSendHour).toBeNull();
	});

	it('accepts midnight, which is a legitimate choice', async () => {
		// 0 is falsy, so a `??` or truthy check anywhere in the write path would
		// turn "midnight" into "no preference" without anyone noticing.
		const set = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: 0 });
		expect(set.body.settings.digestSendHour).toBe(0);

		const readBack = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(readBack.body.settings.digestSendHour).toBe(0);
	});

	it('refuses an hour that is not on a clock', async () => {
		expect((await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: 24 })).status).toBe(400);
		expect((await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: -1 })).status).toBe(400);
		expect((await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: 9.5 })).status).toBe(400);
	});

	it('keeps the two hours independent and does not disturb the zone', async () => {
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, { timezone: 'Europe/Paris', digestSendHour: 6, appointmentSendHour: 18 });
		const get = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(get.body.settings.digestSendHour).toBe(6);
		expect(get.body.settings.appointmentSendHour).toBe(18);
		expect(get.body.settings.timezone).toBe('Europe/Paris');

		// Clearing one leaves the other alone.
		const cleared = await call('PUT', token, `/api/v1/families/${familyId}/settings`, { digestSendHour: null });
		expect(cleared.body.settings.digestSendHour).toBeNull();
		expect(cleared.body.settings.appointmentSendHour).toBe(18);
		expect(cleared.body.settings.timezone).toBe('Europe/Paris');
	});
});
