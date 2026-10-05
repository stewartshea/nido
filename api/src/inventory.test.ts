// src/inventory.test.ts
import { describe, it, expect } from 'vitest';
import {
	consumptionRate, coverForecast, leadStatus, weightTrendPerDay, forecastSizeChange,
	MS_PER_DAY,
} from './inventory';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * MS_PER_DAY).toISOString();

describe('consumptionRate', () => {
	it('measures daily usage from used adjustments only', () => {
		// 12 diapers over 12 days = 1/day. The purchases must not count.
		const rate = consumptionRate([
			{ change: -1, reason: 'used', created_at: daysAgo(12) },
			{ change: -1, reason: 'used', created_at: daysAgo(11) },
			{ change: -1, reason: 'used', created_at: daysAgo(10) },
			{ change: -1, reason: 'used', created_at: daysAgo(9) },
			{ change: -1, reason: 'used', created_at: daysAgo(8) },
			{ change: -1, reason: 'used', created_at: daysAgo(7) },
			{ change: -1, reason: 'used', created_at: daysAgo(6) },
			{ change: -1, reason: 'used', created_at: daysAgo(5) },
			{ change: -1, reason: 'used', created_at: daysAgo(4) },
			{ change: -1, reason: 'used', created_at: daysAgo(3) },
			{ change: -1, reason: 'used', created_at: daysAgo(2) },
			{ change: -1, reason: 'used', created_at: daysAgo(1) },
			{ change: 84, reason: 'purchase', created_at: daysAgo(13) },
		], NOW);
		expect(rate.used).toBe(12);
		// The purchase 13 days ago opens the window, so 12 over 13 days.
		expect(rate.perDay).toBeCloseTo(12 / 13, 5);
	});

	it('observes from the oldest event so a young item is not divided by the whole window', () => {
		// 6 uses spanning 5 days = 1.2/day. Dividing by the 30-day window
		// instead would give 0.2/day and a runout date three times too far out.
		const rate = consumptionRate(
			[0, 1, 2, 3, 4, 5].map((d) => ({ change: -1, reason: 'used', created_at: daysAgo(d) })),
			NOW,
		);
		expect(rate.perDay).toBeCloseTo(1.2, 5);
	});

	it('reports zero rather than guessing when nothing has been used', () => {
		const rate = consumptionRate([{ change: 84, reason: 'purchase', created_at: daysAgo(2) }], NOW);
		expect(rate.perDay).toBe(0);
		expect(rate.lowConfidence).toBe(false);
	});

	it('flags a rate built on very little usage', () => {
		expect(consumptionRate([{ change: -1, reason: 'used', created_at: daysAgo(1) }], NOW).lowConfidence).toBe(true);
		expect(consumptionRate([
			{ change: -1, reason: 'used', created_at: daysAgo(5) },
			{ change: -1, reason: 'used', created_at: daysAgo(4) },
			{ change: -1, reason: 'used', created_at: daysAgo(3) },
			{ change: -1, reason: 'used', created_at: daysAgo(2) },
		], NOW).lowConfidence).toBe(false);
	});

	it('ignores usage outside the window', () => {
		const rate = consumptionRate([
			{ change: -1, reason: 'used', created_at: daysAgo(5) },
			{ change: -100, reason: 'used', created_at: daysAgo(120) },
		], NOW, 30);
		expect(rate.used).toBe(1);
	});
});

describe('coverForecast', () => {
	it('turns a rate and a quantity into days of cover and a runout date', () => {
		const f = coverForecast({ perDay: 2, used: 60, windowDays: 30, lowConfidence: false }, 20, NOW);
		expect(f.daysOfCover).toBeCloseTo(10, 5);
		expect(new Date(f.runoutAt!).getTime()).toBe(NOW + 10 * MS_PER_DAY);
	});

	it('has no runout date when the rate is unknown', () => {
		const f = coverForecast({ perDay: 0, used: 0, windowDays: 30, lowConfidence: false }, 84, NOW);
		expect(f.daysOfCover).toBeNull();
		expect(f.runoutAt).toBeNull();
	});
});

describe('leadStatus', () => {
	it('is low once cover falls inside the chosen lead time', () => {
		const cover = coverForecast({ perDay: 1, used: 30, windowDays: 30, lowConfidence: false }, 5, NOW);
		expect(leadStatus(cover, 7).low).toBe(true);
		expect(leadStatus(cover, 3).low).toBe(false);
	});

	it('is unknown, not healthy, with no lead time or no rate', () => {
		const cover = coverForecast({ perDay: 0, used: 0, windowDays: 30, lowConfidence: false }, 84, NOW);
		expect(leadStatus(cover, 7).unknown).toBe(true);
		const good = coverForecast({ perDay: 1, used: 30, windowDays: 30, lowConfidence: false }, 84, NOW);
		expect(leadStatus(good, null).unknown).toBe(true);
	});
});

describe('weightTrendPerDay', () => {
	it('recovers a steady daily gain', () => {
		// 100 days, gaining 1kg total = 0.01 kg/day.
		const points = Array.from({ length: 11 }, (_, i) => ({ date: daysAgo(100 - i * 10), weight: 4 + i * 0.1 }));
		const trend = weightTrendPerDay(points);
		expect(trend).toBeGreaterThan(0.009);
		expect(trend).toBeLessThan(0.011);
	});

	it('returns null with fewer than two usable measurements', () => {
		expect(weightTrendPerDay([])).toBeNull();
		expect(weightTrendPerDay([{ date: daysAgo(1), weight: 5 }])).toBeNull();
		expect(weightTrendPerDay([{ date: daysAgo(2), weight: null }, { date: daysAgo(1), weight: null }])).toBeNull();
	});

	it('treats a flat or shrinking series as no trend', () => {
		expect(weightTrendPerDay([
			{ date: daysAgo(20), weight: 6 },
			{ date: daysAgo(10), weight: 6 },
		])).toBeNull();
		expect(weightTrendPerDay([
			{ date: daysAgo(20), weight: 6 },
			{ date: daysAgo(10), weight: 5 },
		])).toBeNull();
	});

	it('collapses same-day duplicates into one observation', () => {
		const day = new Date(NOW - 5 * MS_PER_DAY).toISOString();
		const other = new Date(NOW - 25 * MS_PER_DAY).toISOString();
		const trend = weightTrendPerDay([
			{ date: other, weight: 4 },
			{ date: day, weight: 5 },
			{ date: day, weight: 5.4 },
		]);
		expect(trend).toBeGreaterThan(0);   // only two distinct days => a slope exists
		expect(trend).toBeLessThan(0.1);
	});
});

describe('forecastSizeChange', () => {
	const base = { currentSize: '3', nextSize: '4', weightKg: 6, trendKgPerDay: 0.03, nextSizeWeightKg: 7.5, daysOfCover: 60 };

	it('recommends buying the next size when it is needed before the current one runs out', () => {
		const f = forecastSizeChange({ ...base, daysOfCover: 30 });
		expect(f.daysUntilNextSize).toBe(50);
		expect(f.shouldBuyNext).toBe(true);
		expect(f.reason).toMatch(/buy 4 first/i);
	});

	it('does not recommend it when the current size outlasts the move', () => {
		const f = forecastSizeChange({ ...base, daysOfCover: 90 });
		expect(f.shouldBuyNext).toBe(false);
		expect(f.reason).toMatch(/outlast/i);
	});

	it('flags a child already at or above the next band', () => {
		const f = forecastSizeChange({ ...base, weightKg: 8 });
		expect(f.daysUntilNextSize).toBe(0);
		expect(f.shouldBuyNext).toBe(true);
	});

	it('refuses to forecast without enough growth data', () => {
		expect(forecastSizeChange({ ...base, trendKgPerDay: null }).shouldBuyNext).toBeNull();
		expect(forecastSizeChange({ ...base, currentSize: null }).shouldBuyNext).toBeNull();
		expect(forecastSizeChange({ ...base, nextSize: null }).shouldBuyNext).toBeNull();
	});

	it('still answers when the current size has no measurable cover', () => {
		const f = forecastSizeChange({ ...base, daysOfCover: null });
		expect(f.daysUntilNextSize).toBe(50);
		expect(f.shouldBuyNext).toBeNull();
	});
});
