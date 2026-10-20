// The family's wall clock, in the formatter. These run without a browser, so
// the zone has to be set explicitly — which is exactly the point: every case
// below would pass on a machine running in the same zone as the fixture, and
// that is the failure this work exists to remove. Each one picks a zone that is
// deliberately not the test runner's assumed zone.
import { describe, it, expect, afterEach } from 'vitest';
import {
	calendarDaysBetween,
	dayKeyOffset,
	detectTimeZone,
	formatTime,
	formatUpcoming,
	listTimeZones,
	localInputToIso,
	setActiveTimeZone,
	toLocalInput,
	todayKey,
	zonedDayKey,
} from './format';

afterEach(() => setActiveTimeZone(null));

describe('zonedDayKey', () => {
	it('files an instant under the family day, not the device day', () => {
		// 02:00Z on the 5th is still the evening of the 4th in Los Angeles. This
		// is the case that shows up as the wrong heading on the appointments page.
		setActiveTimeZone('America/Los_Angeles');
		expect(zonedDayKey('2026-06-05T02:00:00.000Z')).toBe('2026-06-04');

		// The same instant is already the 5th in London.
		setActiveTimeZone('Europe/London');
		expect(zonedDayKey('2026-06-05T02:00:00.000Z')).toBe('2026-06-05');
	});

	it('says nothing about a missing or unparseable instant', () => {
		expect(zonedDayKey(null)).toBe('');
		expect(zonedDayKey('not a date')).toBe('');
	});

	it('orders day keys lexically, which is why they are ISO dates', () => {
		setActiveTimeZone('UTC');
		const a = zonedDayKey('2026-06-09T12:00:00.000Z');
		const b = zonedDayKey('2026-06-10T12:00:00.000Z');
		expect(a < b).toBe(true);
	});
});

describe('dayKeyOffset and todayKey', () => {
	it('steps a day key without drifting across a month boundary', () => {
		setActiveTimeZone('UTC');
		expect(dayKeyOffset('2026-06-30', 1)).toBe('2026-07-01');
		expect(dayKeyOffset('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('names today on the family clock', () => {
		setActiveTimeZone('Pacific/Auckland');
		// 23:00Z on the 4th is already the 5th in Auckland.
		expect(todayKey(Date.parse('2026-06-04T23:00:00.000Z'))).toBe('2026-06-05');
	});
});

describe('formatUpcoming above a day', () => {
	const NOW = Date.parse('2026-10-05T17:16:00.000Z');

	it('says tomorrow by the family calendar, not by elapsed hours', () => {
		setActiveTimeZone('UTC');
		// 25 hours away crosses the family midnight, so it reads as a day rather
		// than as 25 of anything.
		expect(formatUpcoming('2026-10-06T20:00:00.000Z', NOW)).toBe('tomorrow');
		// Still under a day and still today, so it stays in hours — the calendar
		// branch must not pull a same-day appointment into "tomorrow".
		expect(formatUpcoming('2026-10-06T02:00:00.000Z', NOW)).toBe('in 8 hours');
	});

	it('counts days on the family clock, so a far zone does not shift the count', () => {
		// Everything before 07:00Z on the 7th is still the 6th in Los Angeles, so
		// from the 5th it is one day away, not two.
		setActiveTimeZone('America/Los_Angeles');
		expect(formatUpcoming('2026-10-06T22:00:00.000Z', NOW)).toBe('tomorrow');
	});

	it('steps up to weeks once the count passes a week', () => {
		setActiveTimeZone('UTC');
		expect(formatUpcoming('2026-10-12T17:16:00.000Z', NOW)).toBe('in 1 week');
		expect(formatUpcoming('2026-10-26T17:16:00.000Z', NOW)).toBe('in 3 weeks');
	});
});

describe('calendarDaysBetween', () => {
	it('counts crossings of the family midnight', () => {
		setActiveTimeZone('America/New_York');
		// 02:00Z on the 5th is still the evening of the 4th in New York...
		expect(calendarDaysBetween(Date.parse('2026-06-04T20:00:00.000Z'), Date.parse('2026-06-05T02:00:00.000Z'))).toBe(0);
		// ...but by 12:00Z on the 5th the family has had its midnight.
		expect(calendarDaysBetween(Date.parse('2026-06-04T20:00:00.000Z'), Date.parse('2026-06-05T12:00:00.000Z'))).toBe(1);
	});
});

describe('the wall-clock input bridge', () => {
	it('reads a datetime-local value as a wall clock in the family zone', () => {
		setActiveTimeZone('America/New_York');
		// 9:30am in New York on a summer day is 13:30Z.
		expect(localInputToIso('2026-06-04T09:30')).toBe('2026-06-04T13:30:00.000Z');

		// The same typed value in London is a different instant.
		setActiveTimeZone('Europe/London');
		expect(localInputToIso('2026-06-04T09:30')).toBe('2026-06-04T08:30:00.000Z');
	});

	it('round-trips an instant through the input value', () => {
		setActiveTimeZone('America/Chicago');
		const iso = '2026-06-04T14:30:00.000Z';
		expect(toLocalInput(new Date(iso))).toBe('2026-06-04T09:30');
		expect(localInputToIso(toLocalInput(new Date(iso)))).toBe(iso);
	});

	it('settles the hour either side of a DST transition', () => {
		// US DST starts 2026-03-08. The day before is EST (-5), the day after EDT (-4).
		setActiveTimeZone('America/New_York');
		expect(localInputToIso('2026-03-07T09:00')).toBe('2026-03-07T14:00:00.000Z');
		expect(localInputToIso('2026-03-09T09:00')).toBe('2026-03-09T13:00:00.000Z');
	});

	it('keeps the existing behaviour when no zone has been chosen', () => {
		// With no preference the device's own reading stands, exactly as before
		// this change — the round trip is what matters, not the absolute instant.
		setActiveTimeZone(null);
		const value = toLocalInput(new Date('2026-06-04T14:30:00.000Z'));
		const back = localInputToIso(value);
		expect(Math.abs(Date.parse(back) - Date.parse('2026-06-04T14:30:00.000Z'))).toBeLessThan(60_000);
	});
});

describe('formatTime', () => {
	it('renders the appointment on the family clock', () => {
		setActiveTimeZone('America/Los_Angeles');
		// 14:30Z is 07:30 that morning in Los Angeles.
		expect(formatTime('2026-06-04T14:30:00.000Z')).toContain('7:30');
		expect(formatTime('2026-06-04T14:30:00.000Z')).toContain('Jun 4');
	});

	it('shows the family day when the instant has crossed midnight UTC', () => {
		setActiveTimeZone('America/Los_Angeles');
		expect(formatTime('2026-06-05T02:00:00.000Z')).toContain('Jun 4');
	});
});

describe('the zone list and detection', () => {
	it('offers a usable list of zones for the picker', () => {
		const zones = listTimeZones();
		expect(zones.length).toBeGreaterThan(0);
		expect(zones).toContain('UTC');
	});

	it('detects some zone rather than throwing', () => {
		expect(typeof detectTimeZone()).toBe('string');
		expect(detectTimeZone().length).toBeGreaterThan(0);
	});
});
