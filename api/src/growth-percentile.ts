// growth-percentile.ts
//
// Turning a measurement into a percentile.
//
// The WHO tables give five points on the distribution for each age: p3, p15,
// p50, p85 and p97. Reporting the nearest of those — which is what this used to
// do — answers "roughly where is this child" with one of six values, so every
// child between the 3rd and 15th percentile got told they were the 3rd.
//
// A percentile is a position on a normal curve, and the five points are five
// known z-scores on it. So the value is placed on the curve by interpolating
// between them in z-space, and the answer is read back through the normal CDF.
// That is a real number: 8th, 41st, 63rd, not a bucket.

/** z-scores of the published bands. p50 is the mean, by definition. */
const BAND_Z = {
	p3: -1.88079361,
	p15: -1.03643339,
	p50: 0,
	p85: 1.03643339,
	p97: 1.88079361,
} as const;

/** Ordered by z, so the value axis ascends with them. */
const BANDS = ['p3', 'p15', 'p50', 'p85', 'p97'] as const;

export interface StandardRow {
	age_weeks: number;
	p3: number;
	p15: number;
	p50: number;
	p85: number;
	p97: number;
}

/**
 * Abramowitz & Stegun 7.1.26. Max absolute error 1.5e-7, which is far finer
 * than a growth chart needs — it is one part in ten million of a percentile.
 */
function erf(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * ax);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
			t *
			Math.exp(-ax * ax);
	return sign * y;
}

/** Standard normal CDF, as a percentile in 0..100. */
export function normalPercentile(z: number): number {
	return 50 * (1 + erf(z / Math.SQRT2));
}

/**
 * The five bands at a given age.
 *
 * The table is sampled at intervals, and a measurement rarely lands on one, so
 * the surrounding rows are interpolated. Outside the table the nearest row is
 * used rather than extrapolating a curve that was never published that far.
 */
export function bandsAtAge(table: StandardRow[], ageWeeks: number): StandardRow | null {
	if (!table.length) return null;
	if (!Number.isFinite(ageWeeks)) return null;

	const sorted = [...table].sort((a, b) => a.age_weeks - b.age_weeks);
	const first = sorted[0]!;
	const last = sorted[sorted.length - 1]!;
	if (ageWeeks <= first.age_weeks) return first;
	if (ageWeeks >= last.age_weeks) return last;

	for (let i = 0; i < sorted.length - 1; i++) {
		const lo = sorted[i]!;
		const hi = sorted[i + 1]!;
		if (ageWeeks >= lo.age_weeks && ageWeeks <= hi.age_weeks) {
			const span = hi.age_weeks - lo.age_weeks;
			const f = span === 0 ? 0 : (ageWeeks - lo.age_weeks) / span;
			const lerp = (a: number, b: number) => a + (b - a) * f;
			return {
				age_weeks: ageWeeks,
				p3: lerp(lo.p3, hi.p3),
				p15: lerp(lo.p15, hi.p15),
				p50: lerp(lo.p50, hi.p50),
				p85: lerp(lo.p85, hi.p85),
				p97: lerp(lo.p97, hi.p97),
			};
		}
	}
	return last;
}

/**
 * The percentile a value sits at, given the bands for its age.
 *
 * Piecewise-linear in z-space between the known bands. Beyond the outermost
 * band the nearest segment's slope is continued, because a value off the end of
 * the published range is real information — a severely underweight baby should
 * read as 1st percentile, not "3rd or below".
 */
export function percentileFor(value: number, bands: StandardRow): number {
	const points = BANDS.map((band) => ({ value: bands[band], z: BAND_Z[band] }));

	// The p50 z is 0 but its value may not be monotonic with the outer bands in a
	// malformed table, so guard rather than trusting the input blindly.
	for (let i = 1; i < points.length; i++) {
		if (!(points[i]!.value > points[i - 1]!.value)) {
			// Degenerate bands: fall back to the median rather than dividing by zero.
			return 50;
		}
	}

	const lowest = points[0]!;
	const highest = points[points.length - 1]!;

	let z: number;
	if (value <= lowest.value) {
		const next = points[1]!;
		const slope = (next.z - lowest.z) / (next.value - lowest.value);
		z = lowest.z + (value - lowest.value) * slope;
	} else if (value >= highest.value) {
		const prev = points[points.length - 2]!;
		const slope = (highest.z - prev.z) / (highest.value - prev.value);
		z = highest.z + (value - highest.value) * slope;
	} else {
		z = 0;
		for (let i = 0; i < points.length - 1; i++) {
			const lo = points[i]!;
			const hi = points[i + 1]!;
			if (value >= lo.value && value <= hi.value) {
				const f = (value - lo.value) / (hi.value - lo.value);
				z = lo.z + (hi.z - lo.z) * f;
				break;
			}
		}
	}

	// Clamped at both ends: "0th percentile" and "100th" are not claims a growth
	// chart should make from five reference points.
	return Math.min(99.9, Math.max(0.1, normalPercentile(z)));
}
