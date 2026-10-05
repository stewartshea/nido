import { describe, it, expect } from 'vitest';
import { formatRelative } from './format';

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
