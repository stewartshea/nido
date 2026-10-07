// src/growth-percentile.test.ts
import { describe, it, expect } from 'vitest';
import { bandsAtAge, normalPercentile, percentileFor, type StandardRow } from './growth-percentile';

// A slice of the real WHO boys' weight-for-age table.
const TABLE: StandardRow[] = [
	{ age_weeks: 0, p3: 2.6, p15: 2.9, p50: 3.3, p85: 3.8, p97: 4.4 },
	{ age_weeks: 8, p3: 5.1, p15: 5.6, p50: 6.2, p85: 6.9, p97: 7.8 },
	{ age_weeks: 12, p3: 5.8, p15: 6.4, p50: 7.0, p85: 7.8, p97: 8.8 },
];

describe('the normal curve itself', () => {
	it('puts the mean at the 50th percentile', () => {
		expect(normalPercentile(0)).toBeCloseTo(50, 6);
	});

	it('puts the published z-scores on their published percentiles', () => {
		expect(normalPercentile(1.88079361)).toBeCloseTo(97, 4);
		expect(normalPercentile(-1.88079361)).toBeCloseTo(3, 4);
		expect(normalPercentile(1.03643339)).toBeCloseTo(85, 4);
		expect(normalPercentile(-1.03643339)).toBeCloseTo(15, 4);
	});
});

describe('bandsAtAge', () => {
	it('returns the row itself when the age lands on one', () => {
		expect(bandsAtAge(TABLE, 8)?.p50).toBe(6.2);
	});

	it('interpolates between rows', () => {
		// Halfway between week 0 (3.3) and week 8 (6.2).
		expect(bandsAtAge(TABLE, 4)?.p50).toBeCloseTo(4.75, 6);
		// A quarter of the way from 8 to 12.
		expect(bandsAtAge(TABLE, 9)?.p50).toBeCloseTo(6.4, 6);
	});

	it('holds the ends instead of extrapolating past the published range', () => {
		expect(bandsAtAge(TABLE, -5)?.age_weeks).toBe(0);
		expect(bandsAtAge(TABLE, 500)?.age_weeks).toBe(12);
	});

	it('survives an empty or unusable table', () => {
		expect(bandsAtAge([], 5)).toBeNull();
		expect(bandsAtAge(TABLE, NaN)).toBeNull();
	});
});

describe('percentileFor is continuous, not a bucket', () => {
	const bands = TABLE[2]!; // week 12

	it('lands on the published percentile at the published value', () => {
		expect(percentileFor(bands.p50, bands)).toBeCloseTo(50, 3);
		expect(percentileFor(bands.p3, bands)).toBeCloseTo(3, 2);
		expect(percentileFor(bands.p97, bands)).toBeCloseTo(97, 2);
	});

	// The whole point: values between the published points get their own answer
	// rather than all collapsing onto the nearest one.
	it('gives distinct answers inside a band', () => {
		const a = percentileFor(6.0, bands); // between p3 and p15
		const b = percentileFor(6.2, bands);
		expect(a).not.toBe(b);
		expect(a).toBeGreaterThan(3);
		expect(a).toBeLessThan(15);
		expect(b).toBeGreaterThan(a);
	});

	it('never regresses as the measurement grows', () => {
		let previous = -1;
		for (let v = 2; v <= 14; v += 0.25) {
			const p = percentileFor(v, bands);
			expect(p).toBeGreaterThanOrEqual(previous);
			previous = p;
		}
	});

	it('reports below the bottom band and above the top band, not merely at them', () => {
		// A severely underweight reading is real information, not "3rd or under".
		expect(percentileFor(3.0, bands)).toBeLessThan(1);
		expect(percentileFor(14.0, bands)).toBeGreaterThan(99);
	});

	it('clamps rather than claiming the 0th or 100th percentile', () => {
		expect(percentileFor(0.1, bands)).toBeGreaterThanOrEqual(0.1);
		expect(percentileFor(50, bands)).toBeLessThanOrEqual(99.9);
	});

	it('falls back to the median on a malformed table rather than dividing by zero', () => {
		const broken: StandardRow = { age_weeks: 12, p3: 6, p15: 6, p50: 6, p85: 6, p97: 6 };
		expect(percentileFor(6, broken)).toBe(50);
	});
});

describe('the old bucket is gone', () => {
	it('does not return one of the six rounded values for an in-between measurement', () => {
		const bands = TABLE[2]!;
		const buckets = [3, 15, 50, 85, 97, 99];
		const value = percentileFor(6.05, bands);
		expect(buckets).not.toContain(Math.round(value * 10) / 10);
	});
});
