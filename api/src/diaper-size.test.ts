// src/diaper-size.test.ts
//
// "Which size is the child wearing" is answered in one place, because the
// size-up forecast and the stock the change bills must not disagree.
import { describe, it, expect } from 'vitest';
import { sizeForWeight, sizeWithoutWeight, weightKg, type DiaperSizeBands } from './diaper-size';

const size = (over: Partial<DiaperSizeBands> = {}) => ({
	size: '3',
	itemId: 10,
	active: true,
	weightBandMinKg: null as number | null,
	weightBandMaxKg: null as number | null,
	startDate: null as string | null,
	...over,
});

describe('weightKg', () => {
	it('converts the unit a growth record was typed in', () => {
		expect(weightKg(12, 'imperial')).toBeCloseTo(5.443, 3);
		expect(weightKg(6.8, 'metric')).toBe(6.8);
		expect(weightKg(6.8, null)).toBe(6.8);
	});
});

describe('sizeForWeight', () => {
	const ladder = [
		size({ size: '3', itemId: 3, weightBandMinKg: 5.5, weightBandMaxKg: 7.0 }),
		size({ size: '4', itemId: 4, weightBandMinKg: 7.0, weightBandMaxKg: 9.0 }),
	];

	it('picks the band whose floor the weight has reached', () => {
		expect(sizeForWeight(ladder, 6.3)?.size).toBe('3');
		expect(sizeForWeight(ladder, 7.0)?.size).toBe('4');
		expect(sizeForWeight(ladder, 8.9)?.size).toBe('4');
	});

	it('picks the smallest when the child is below every floor', () => {
		expect(sizeForWeight(ladder, 4.0)?.size).toBe('3');
	});

	it('ignores rows with no floor to compare against', () => {
		const mixed = [...ladder, size({ size: '5', itemId: 5, weightBandMinKg: null })];
		expect(sizeForWeight(mixed, 6.3)?.size).toBe('3');
	});

	it('returns null when no row has a band at all', () => {
		expect(sizeForWeight([size({ weightBandMinKg: null })], 6.3)).toBeNull();
	});

	it('ignores active: a size the child has grown into is the one being worn', () => {
		const stale = [ladder[0]!, { ...ladder[1]!, active: false }];
		expect(sizeForWeight(stale, 7.5)?.size).toBe('4');
	});
});

describe('sizeWithoutWeight', () => {
	it('uses the only size marked current', () => {
		const sizes = [
			size({ size: '3', itemId: 3, active: true, weightBandMinKg: 5.5, startDate: '2026-01-01T00:00:00.000Z' }),
			size({ size: '4', itemId: 4, active: false, weightBandMinKg: 7.0, startDate: '2026-01-01T00:00:00.000Z' }),
		];
		expect(sizeWithoutWeight(sizes)?.size).toBe('3');
	});

	it('uses the most recently started current size', () => {
		const sizes = [
			size({ size: '3', itemId: 3, startDate: '2026-01-01T00:00:00.000Z' }),
			size({ size: '4', itemId: 4, startDate: '2026-03-01T00:00:00.000Z' }),
		];
		expect(sizeWithoutWeight(sizes)?.size).toBe('4');
	});

	it('does not let a preload tie pick the largest size', () => {
		// Preload stamps every row at once, so the fallback must be the smallest
		// band — not the last row that happened to sort.
		const same = '2026-01-01T00:00:00.000Z';
		const sizes = [
			size({ size: '3', itemId: 3, weightBandMinKg: 5.5, startDate: same }),
			size({ size: '4', itemId: 4, weightBandMinKg: 7.0, startDate: same }),
			size({ size: '5', itemId: 5, weightBandMinKg: 9.0, startDate: same }),
		];
		expect(sizeWithoutWeight(sizes)?.size).toBe('3');
	});

	it('returns null with nothing to choose from', () => {
		expect(sizeWithoutWeight([])).toBeNull();
	});
});
