// api/src/inventory.ts
//
// Consumption rate, days of cover, and runout forecasting.
//
// The rate is derived from the adjustment ledger rather than assumed, so an item
// that is bought but never used does not drift towards a false "running out".

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Window used to measure consumption. Long enough to be stable, short enough to notice a change. */
export const DEFAULT_RATE_WINDOW_DAYS = 30;

export interface AdjustmentRow {
	change: number;
	reason: string;
	created_at: string;
}

export interface ConsumptionRate {
	/** Units consumed per day. Zero when nothing has been consumed in the window. */
	perDay: number;
	/** Units consumed inside the window. */
	used: number;
	/** Days actually observed, so a new item is not treated as if it had run a whole month. */
	windowDays: number;
	/** True when the rate rests on very little usage and should not be trusted for alerts. */
	lowConfidence: boolean;
}

function ts(v: string): number {
	const t = new Date(v).getTime();
	return Number.isFinite(t) ? t : 0;
}

/**
 * Units consumed per day over the window.
 *
 * `bought` and `used` adjustments are tracked separately: a purchase is not
 * consumption, and treating a bulk restock as usage would make a well-stocked
 * item look like it is being used up.
 */
export function consumptionRate(
	adjustments: AdjustmentRow[],
	nowMs: number,
	windowDays = DEFAULT_RATE_WINDOW_DAYS,
): ConsumptionRate {
	const from = nowMs - windowDays * MS_PER_DAY;
	const inWindow = adjustments.filter((a) => ts(a.created_at) >= from);

	const used = inWindow
		.filter((a) => a.reason === 'used' && Number(a.change) < 0)
		.reduce((sum, a) => sum + Math.abs(Number(a.change)), 0);

	// Observe from the oldest relevant event, not from `now`: an item created
	// yesterday has one day of history, and dividing its usage by 30 would
	// understate the rate and push the runout date too far out. Only fall back
	// to the window edge when there is no relevant event at all.
	let earliest: number | null = null;
	for (const a of inWindow) {
		if (a.reason === 'used' || a.reason === 'purchase') {
			const t = ts(a.created_at);
			earliest = earliest === null ? t : Math.min(earliest, t);
		}
	}
	const observedMs = Math.max(MS_PER_DAY, nowMs - (earliest ?? from));
	const windowObserved = observedMs / MS_PER_DAY;

	return {
		perDay: used / windowObserved,
		used,
		windowDays: windowObserved,
		lowConfidence: used > 0 && used < 3,
	};
}

export interface CoverForecast {
	perDay: number;
	daysOfCover: number | null;
	/** ISO date the stock is expected to run out, or null when there is no rate. */
	runoutAt: string | null;
	lowConfidence: boolean;
}

export function coverForecast(rate: ConsumptionRate, quantity: number, nowMs: number): CoverForecast {
	if (rate.perDay <= 0) {
		return { perDay: 0, daysOfCover: null, runoutAt: null, lowConfidence: rate.lowConfidence };
	}
	const daysOfCover = quantity / rate.perDay;
	return {
		perDay: rate.perDay,
		daysOfCover,
		runoutAt: new Date(nowMs + daysOfCover * MS_PER_DAY).toISOString(),
		lowConfidence: rate.lowConfidence,
	};
}

export interface LeadTimeStatus {
	low: boolean;
	/** Days of cover left, or null when unknown. */
	daysOfCover: number | null;
	/** True when we cannot say, which is not the same as "fine". */
	unknown: boolean;
}

/**
 * Is this item low against its own lead time?
 *
 * `leadDays` is the warning window the household chose. An item with no lead
 * time, or no measurable rate, is `unknown` rather than `false`, so a silent
 * item is never mistaken for a healthy one.
 */
export function leadStatus(cover: CoverForecast, leadDays: number | null | undefined): LeadTimeStatus {
	if (leadDays === null || leadDays === undefined) return { low: false, daysOfCover: cover.daysOfCover, unknown: true };
	if (cover.daysOfCover === null) return { low: false, daysOfCover: null, unknown: true };
	return { low: cover.daysOfCover <= leadDays, daysOfCover: cover.daysOfCover, unknown: false };
}

export interface GrowthPoint {
	date: string;
	weight: number | null;
}

/**
 * kg per day, by least squares over recorded weights.
 *
 * The regression runs over milliseconds, so the slope is converted to a daily
 * rate before it is returned. Returning it per-millisecond would make a real
 * growth trend look like zero.
 *
 * Returns null when there are fewer than two usable points or no meaningful
 * slope. A growing baby is the only case that matters here; a flat or noisy
 * series should suppress the size forecast rather than invent one.
 */
export function weightTrendPerDay(points: GrowthPoint[]): number | null {
	const usable = points
		.map((p) => ({ t: ts(p.date), w: p.weight === null || p.weight === undefined ? null : Number(p.weight) }))
		.filter((p): p is { t: number; w: number } => p.t > 0 && p.w !== null && Number.isFinite(p.w) && p.w > 0)
		.sort((a, b) => a.t - b.t);
	if (usable.length < 2) return null;

	// Collapse same-day measurements; a weight entered twice in a day is one
	// observation, and counting both distorts the slope.
	const byDay = new Map<number, number>();
	for (const p of usable) byDay.set(Math.floor(p.t / MS_PER_DAY), p.w);
	const pts = [...byDay.entries()].map(([day, w]) => ({ t: day * MS_PER_DAY, w }));
	if (pts.length < 2) return null;

	const n = pts.length;
	const meanT = pts.reduce((s, p) => s + p.t, 0) / n;
	const meanW = pts.reduce((s, p) => s + p.w, 0) / n;
	let num = 0;
	let den = 0;
	for (const p of pts) {
		num += (p.t - meanT) * (p.w - meanW);
		den += (p.t - meanT) ** 2;
	}
	if (den === 0) return null;
	const slope = num / den;                       // kg per millisecond
	const perDay = slope * MS_PER_DAY;             // kg per day
	return perDay > 0 ? perDay : null;
}

export interface SizeForecast {
	currentSize: string | null;
	nextSize: string | null;
	/** Days until the child is expected to reach the next size's weight band. */
	daysUntilNextSize: number | null;
	/** Days of cover in the current size, for comparison against the above. */
	daysOfCover: number | null;
	/**
	 * Whether the next size should be bought before the current one runs out.
	 * When both are known this is the actual recommendation.
	 */
	shouldBuyNext: boolean | null;
	reason: string;
}

/**
 * Diaper sizes are weight bands, so the two useful signals are: how long the
 * current size will last, and how long until the next size is needed. Either on
 * its own is misleading — a large baby can burn through a size in days, and a
 * slow one can outgrow it before it is half used.
 */
export function forecastSizeChange(input: {
	currentSize: string | null;
	nextSize: string | null;
	weightKg: number | null;
	trendKgPerDay: number | null;
	nextSizeWeightKg: number | null;
	daysOfCover: number | null;
}): SizeForecast {
	const { currentSize, nextSize, weightKg, trendKgPerDay, nextSizeWeightKg, daysOfCover } = input;

	if (!currentSize || !nextSize) {
		return {
			currentSize, nextSize, daysUntilNextSize: null, daysOfCover,
			shouldBuyNext: null, reason: 'Set a current and next diaper size to see a forecast.',
		};
	}
	if (weightKg === null || trendKgPerDay === null || nextSizeWeightKg === null) {
		return {
			currentSize, nextSize, daysUntilNextSize: null, daysOfCover,
			shouldBuyNext: null,
			reason: 'Need at least two weight records to forecast a size change.',
		};
	}

	const kgToGo = nextSizeWeightKg - weightKg;
	if (kgToGo <= 0) {
		return {
			currentSize, nextSize, daysUntilNextSize: 0, daysOfCover,
			shouldBuyNext: true,
			reason: `Already at or above the ${nextSize} weight band.`,
		};
	}

	const daysUntilNextSize = Math.round(kgToGo / trendKgPerDay);
	const shouldBuyNext = daysOfCover === null ? null : daysOfCover <= daysUntilNextSize;
	const reason =
		daysOfCover === null
			? `About ${daysUntilNextSize} days to size ${nextSize} at the current growth rate.`
			: shouldBuyNext
				? `Size ${currentSize} lasts about ${Math.round(daysOfCover)} days and size ${nextSize} is needed in about ${daysUntilNextSize}; buy ${nextSize} first.`
				: `Size ${currentSize} should outlast the move to ${nextSize} (about ${daysUntilNextSize} days).`;

	return { currentSize, nextSize, daysUntilNextSize, daysOfCover, shouldBuyNext, reason };
}
const MS_CYCLE = MS_PER_DAY;

export interface ScheduledItem {
	id?: number;
	consume_interval_days?: number | null;
	consume_started_at?: string | null;
	consume_cycles_applied?: number | null;
}

/**
 * How many whole cycles have come due since the anchor, and how many are still
 * unapplied.
 *
 * Counting whole cycles only, from the anchor, means a page opened after ten
 * days of a daily item records ten uses rather than one. Returns zero when the
 * item has no cadence or no anchor, so a plain event-linked item is untouched.
 */
export function dueCycles(
	item: ScheduledItem,
	nowMs: number,
): { due: number; alreadyApplied: number; total: number } {
	const interval = Number(item.consume_interval_days ?? 0);
	const startedMs = item.consume_started_at ? new Date(String(item.consume_started_at)).getTime() : NaN;
	const alreadyApplied = Number(item.consume_cycles_applied ?? 0);
	if (!Number.isFinite(interval) || interval <= 0) return { due: 0, alreadyApplied, total: alreadyApplied };
	if (!Number.isFinite(startedMs)) return { due: 0, alreadyApplied, total: alreadyApplied };

	// Total cycles since the anchor is a function of elapsed time alone. Folding
	// `alreadyApplied` in here would count it twice and take another unit on
	// every single read.
	const elapsed = nowMs - startedMs;
	const total = elapsed <= 0 ? 0 : Math.floor(elapsed / (interval * MS_CYCLE));
	return { due: Math.max(0, total - alreadyApplied), alreadyApplied, total };
}

/** When the next unit falls due, or null when the item is not on a cadence. */
export function nextConsumptionAt(item: ScheduledItem, nowMs: number): string | null {
	const interval = Number(item.consume_interval_days ?? 0);
	const startedMs = item.consume_started_at ? new Date(String(item.consume_started_at)).getTime() : NaN;
	if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(startedMs)) return null;
	const { alreadyApplied, total } = dueCycles(item, nowMs);
	if (alreadyApplied < total) return null;              // catch-up still pending
	return new Date(startedMs + (total + 1) * interval * MS_CYCLE).toISOString();
}
