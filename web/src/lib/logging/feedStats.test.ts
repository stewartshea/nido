import { describe, it, expect } from 'vitest';
import { avg, computeFeedReports, formatElapsed } from './feedStats';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A row shaped like the loaded feedings these reports are derived from. */
function feed(type: string, start_time: Date, amount?: number, duration?: number) {
	return { type, start_time: start_time.toISOString(), amount, duration };
}

describe('avg', () => {
	it('returns null for an empty window rather than NaN', () => {
		expect(avg([])).toBeNull();
	});

	it('averages a partial window', () => {
		expect(avg([2])).toBe(2);
		expect(avg([1, 2, 3, 4])).toBe(2.5);
	});
});

describe('computeFeedReports', () => {
	it('counts only breast, bottle and formula rows as feeds', () => {
		const now = Date.now();
		const r = computeFeedReports([
			feed('breast', new Date(now - HOUR)),
			feed('bottle', new Date(now - 2 * HOUR)),
			feed('pump', new Date(now - HOUR)),
			feed('solid', new Date(now - HOUR)),
		]);
		expect(r.count1d).toBe(2);
		expect(r.count30d).toBe(2);
	});

	it('splits the 24h window from the rest, and count30d is the whole list', () => {
		const now = Date.now();
		const r = computeFeedReports([
			feed('bottle', new Date(now - HOUR), 4),
			feed('bottle', new Date(now - 2 * DAY), 6),
			feed('breast', new Date(now - 40 * DAY), 8),
		]);
		expect(r.count1d).toBe(1);
		// "Feeds (30d)" counts every loaded feed, not just the month window.
		expect(r.count30d).toBe(3);
		expect(r.avgSize1d).toBe(4);
		expect(r.avgSize30d).toBe(5);
	});

	it('averages a timed length only over rows with a positive duration', () => {
		const now = Date.now();
		const r = computeFeedReports([
			// A bottle with no length, a breast feed timed at ten minutes, and a
			// zero-duration row that must not drag the average down.
			feed('bottle', new Date(now - HOUR), 5, 0),
			feed('breast', new Date(now - HOUR), undefined, 10 * MIN),
			feed('breast', new Date(now - 3 * HOUR), undefined, 20 * MIN),
		]);
		expect(r.count1d).toBe(3);
		expect(r.avgSize1d).toBe(5);
		expect(r.avgDur1d).toBe(15 * MIN);
		expect(r.avgDur30d).toBe(15 * MIN);
	});

	it('reports null sizes and lengths when no row carries them', () => {
		const r = computeFeedReports([feed('breast', new Date(Date.now() - HOUR))]);
		expect(r.count1d).toBe(1);
		expect(r.avgSize1d).toBeNull();
		expect(r.avgDur1d).toBeNull();
		expect(r.avgSize30d).toBeNull();
		expect(r.avgDur30d).toBeNull();
	});

	it('keeps an unparseable start_time out of the windows but in the totals', () => {
		const r = computeFeedReports([
			{ type: 'bottle', start_time: 'not a date', amount: 3 },
			feed('bottle', new Date(Date.now() - HOUR), 3),
		]);
		expect(r.count1d).toBe(1);
		expect(r.count30d).toBe(2);
	});
});

describe('formatElapsed', () => {
	it('pads minutes and seconds', () => {
		expect(formatElapsed(0)).toBe('00m 00s');
		expect(formatElapsed(90_000)).toBe('01m 30s');
	});

	it('omits hours until there is one', () => {
		expect(formatElapsed(59 * MIN + 59_000)).toBe('59m 59s');
		expect(formatElapsed(HOUR)).toBe('1h 00m 00s');
		expect(formatElapsed(HOUR + MIN + 1000)).toBe('1h 01m 01s');
	});
});
