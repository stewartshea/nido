import { describe, it, expect } from 'vitest';
import { formatAge, formatRelative } from './format';

// Fixed reference point so these cases cannot drift with the clock.
const NOW = Date.parse('2026-10-05T17:16:00.000Z');   // a Monday evening
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('formatRelative', () => {
	it('says nothing useful about a moment that has not happened', () => {
		expect(formatRelative(null, NOW)).toBe('—');
		expect(formatRelative(undefined, NOW)).toBe('—');
		expect(formatRelative('not a date', NOW)).toBe('—');
	});

	it('treats anything under a minute as just now', () => {
		expect(formatRelative(minutesAgo(0), NOW)).toBe('just now');
		expect(formatRelative(minutesAgo(0.4), NOW)).toBe('just now');
	});

	it('counts whole minutes below the hour', () => {
		expect(formatRelative(minutesAgo(1), NOW)).toBe('1 min ago');
		expect(formatRelative(minutesAgo(45), NOW)).toBe('45 min ago');
		expect(formatRelative(minutesAgo(59), NOW)).toBe('59 min ago');
	});

	it('reports the exact hour when the minutes land on it', () => {
		expect(formatRelative(minutesAgo(60), NOW)).toBe('1 hour ago');
		expect(formatRelative(minutesAgo(120), NOW)).toBe('2 hours ago');
		expect(formatRelative(minutesAgo(180), NOW)).toBe('3 hours ago');
	});

	// A feed logged at 3:58pm, read at 5:16pm: 78 minutes. Flooring this to
	// "1 hour ago" hid that it was nearly two, which is the gap that decides
	// whether a feed is due.
	it('keeps the leftover minutes instead of flooring to the hour', () => {
		expect(formatRelative(new Date(Date.parse('2026-10-05T15:58:00.000Z')).toISOString(), NOW))
			.toBe('1 hr 18 min ago');
		expect(formatRelative(minutesAgo(90), NOW)).toBe('1 hr 30 min ago');
		expect(formatRelative(minutesAgo(150), NOW)).toBe('2 hr 30 min ago');
	});

	it('does not round a near-two-hour gap down to one hour', () => {
		expect(formatRelative(minutesAgo(119), NOW)).toBe('1 hr 59 min ago');
	});

	it('keeps a plural only when the hour count needs one', () => {
		expect(formatRelative(minutesAgo(60), NOW)).not.toContain('hours');
		expect(formatRelative(minutesAgo(61), NOW)).not.toContain('hours');
		expect(formatRelative(minutesAgo(120), NOW)).toContain('2 hours ago');
	});

	it('switches to days past a day, and to a date past a week', () => {
		expect(formatRelative(minutesAgo(60 * 23), NOW)).toBe('23 hours ago');
		expect(formatRelative(minutesAgo(60 * 24), NOW)).toBe('yesterday');
		expect(formatRelative(minutesAgo(60 * 24 * 3), NOW)).toBe('3 days ago');
		expect(formatRelative(minutesAgo(60 * 24 * 8), NOW)).not.toContain('ago');
	});
});

describe('formatAge', () => {
	// Fixed reference so the thresholds cannot drift with the clock.
	const NOW = Date.parse('2026-06-01T00:00:00.000Z');
	const bornDaysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

	it('says nothing about a profile with no birth date, or one in the future', () => {
		expect(formatAge(null, NOW)).toBeNull();
		expect(formatAge(undefined, NOW)).toBeNull();
		expect(formatAge('not a date', NOW)).toBeNull();
		expect(formatAge(new Date(NOW + 86_400_000).toISOString(), NOW)).toBeNull();
	});

	it('counts weeks for a newborn', () => {
		expect(formatAge(bornDaysAgo(7), NOW)).toEqual({ value: '1', unit: 'week' });
		expect(formatAge(bornDaysAgo(20), NOW)).toEqual({ value: '2', unit: 'weeks' });
		expect(formatAge(bornDaysAgo(90), NOW)).toEqual({ value: '12', unit: 'weeks' });
	});

	// The point of the change: nobody says a toddler is 108 weeks old.
	it('switches to months at three months', () => {
		// The boundary sits at three mean months, ~91.5 days.
		expect(formatAge(bornDaysAgo(91), NOW)).toEqual({ value: '13', unit: 'weeks' });
		expect(formatAge(bornDaysAgo(92), NOW)).toEqual({ value: '3', unit: 'months' });
		expect(formatAge(bornDaysAgo(365), NOW)).toEqual({ value: '11', unit: 'months' });
		expect(formatAge(bornDaysAgo(730), NOW)).toEqual({ value: '23', unit: 'months' });
	});

	it('switches to years at two, keeping the leftover months', () => {
		expect(formatAge(bornDaysAgo(731), NOW)).toEqual({ value: '2', unit: 'years' });
		expect(formatAge(bornDaysAgo(800), NOW)).toEqual({ value: '2y 2m', unit: '' });
		expect(formatAge(bornDaysAgo(1000), NOW)).toEqual({ value: '2y 8m', unit: '' });
	});
});
