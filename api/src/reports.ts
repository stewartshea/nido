// reports.ts
//
// Daily series for the Reports page: how much was pumped, how much formula was
// fed, and how much stock went out the door, one bucket per local day.
//
// The aggregation is a pure function over rows the route hands it, so the rules
// that are easy to get subtly wrong — which feed types count, how a millilitre
// becomes an ounce, what is "usage" rather than a recount — are pinned by unit
// tests instead of only being exercised through a database.
//
// Two decisions worth naming, both borrowed from code that already made them:
//
//   * A pump is milk logistics, not a feed (see the same call in
//     health/insights and feedStats.ts). It is its own series and is never
//     added into the fed totals.
//   * A bottle of formula is logged as `type = 'formula'` with a
//     `formula_item_id` (FeedLogger.bottleRecord()); a bottle of expressed
//     milk is `type = 'bottle'`. They are separate series so a parent can see
//     which one is driving the number.

import { amountOz } from './routes/feedings';
import { zonedDate } from './timezone';

export interface DailyBucket {
	/** Local calendar date, YYYY-MM-DD. */
	date: string;
	/** Milk expressed, in ounces (feedings.type = 'pump'). */
	pumpedOz: number;
	/** Formula fed, in ounces (feedings.type = 'formula'). */
	formulaOz: number;
	/** Expressed milk fed from a bottle, in ounces (feedings.type = 'bottle'). */
	bottleOz: number;
	/** Formula + bottled milk, the "fed from a bottle" total. Breast feeds are absent: they have no logged volume. */
	bottleFedOz: number;
	/** Stock consumed in the ledger (negative rows with reason 'used'), in each item's own unit. */
	used: number;
	/** Signed net of manual corrections, so a recount is visible without reading as consumption. */
	corrected: number;
}

export interface ItemSeries {
	itemId: number;
	name: string;
	category: string;
	unit: string;
	/** day -> quantity used (positive), only days with use appear. */
	daily: Record<string, number>;
}

export interface CategorySeries {
	category: string;
	unit: string;
	daily: Record<string, number>;
}

export interface FormulaSeries {
	itemId: number;
	name: string;
	unit: string;
	daily: Record<string, number>;
}

export interface DailyReport {
	days: DailyBucket[];
	items: ItemSeries[];
	categories: CategorySeries[];
	formulas: FormulaSeries[];
}

export interface ItemMeta {
	name: string;
	category: string;
	unit: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Bucket feedings and inventory adjustments into local-day series.
 *
 * `dates` is the ordered window (oldest first) the route chose from the family
 * clock; anything outside it is dropped rather than silently accumulated, so a
 * feed at 23:00 local on the day before the window cannot leak into the first
 * bucket. `timeZone` is the family's, not the server's, so two caregivers in
 * different zones see the same buckets.
 */
export function buildDailyReport(params: {
	dates: string[];
	timeZone: string;
	feedings: Array<Record<string, unknown>>;
	adjustments: Array<Record<string, unknown>>;
	items: Map<number, ItemMeta>;
}): DailyReport {
	const { dates, timeZone, feedings, adjustments, items } = params;

	const buckets = new Map<string, DailyBucket>();
	for (const date of dates) {
		buckets.set(date, { date, pumpedOz: 0, formulaOz: 0, bottleOz: 0, bottleFedOz: 0, used: 0, corrected: 0 });
	}

	const formulaDaily = new Map<number, Map<string, number>>();

	// One timestamp formatter for both tables; an unparseable instant is
	// dropped rather than bucketed into "today" by accident.
	const dayOf = (value: unknown): string | null => {
		if (typeof value !== 'string' || !value) return null;
		const ms = new Date(value).getTime();
		if (!Number.isFinite(ms)) return null;
		return zonedDate(ms, timeZone);
	};

	for (const f of feedings) {
		const day = dayOf(f?.start_time);
		if (!day) continue;
		const bucket = buckets.get(day);
		if (!bucket) continue;
		const oz = amountOz({ amount: f?.amount, amountUnit: f?.amount_unit });
		if (oz === null) continue;
		if (f?.type === 'pump') {
			bucket.pumpedOz += oz;
		} else if (f?.type === 'formula') {
			bucket.formulaOz += oz;
			bucket.bottleFedOz += oz;

			const fid = Number(f?.formula_item_id);
			if (Number.isFinite(fid) && fid > 0) {
				let d = formulaDaily.get(fid);
				if (!d) { d = new Map(); formulaDaily.set(fid, d); }
				d.set(day, (d.get(day) ?? 0) + oz);
			}
		} else if (f?.type === 'bottle') {
			bucket.bottleOz += oz;
			bucket.bottleFedOz += oz;
		}
	}

	const itemDaily = new Map<number, Map<string, number>>();
	const categoryDaily = new Map<string, Map<string, number>>();
	const categoryUnit = new Map<string, string>();

	for (const a of adjustments) {
		const day = dayOf(a?.created_at);
		if (!day) continue;
		const bucket = buckets.get(day);
		if (!bucket) continue;
		const change = Number(a?.change);
		if (!Number.isFinite(change) || change === 0) continue;

		if (change < 0 && a?.reason === 'used') {
			const used = -change;
			bucket.used += used;

			const itemId = Number(a?.item_id);
			if (!Number.isFinite(itemId)) continue;
			const meta = items.get(itemId);
			const category = meta?.category ?? 'other';

			const draw = (map: Map<number, Map<string, number>>, key: number) => {
				let daily = map.get(key);
				if (!daily) { daily = new Map(); map.set(key, daily); }
				daily.set(day, (daily.get(day) ?? 0) + used);
			};
			draw(itemDaily, itemId);

			let cat = categoryDaily.get(category);
			if (!cat) { cat = new Map(); categoryDaily.set(category, cat); }
			cat.set(day, (cat.get(day) ?? 0) + used);
			if (!categoryUnit.has(category)) categoryUnit.set(category, meta?.unit ?? 'count');
		} else if (a?.reason === 'correction') {
			// Signed: a recount upward is a correction too, and netting it lets a
			// household see the drift without calling it consumption.
			bucket.corrected += change;
		}
	}

	for (const bucket of buckets.values()) {
		bucket.pumpedOz = round2(bucket.pumpedOz);
		bucket.formulaOz = round2(bucket.formulaOz);
		bucket.bottleOz = round2(bucket.bottleOz);
		bucket.bottleFedOz = round2(bucket.bottleFedOz);
		bucket.used = round2(bucket.used);
		bucket.corrected = round2(bucket.corrected);
	}

	const toSeries = (daily: Map<string, number>): Record<string, number> => {
		const out: Record<string, number> = {};
		for (const [date, value] of daily) out[date] = round2(value);
		return out;
	};
	const totalOf = (daily: Record<string, number>) => Object.values(daily).reduce((s, n) => s + n, 0);

	const itemList: ItemSeries[] = [];
	for (const [itemId, daily] of itemDaily) {
		const meta = items.get(itemId);
		itemList.push({
			itemId,
			name: meta?.name ?? `Item ${itemId}`,
			category: meta?.category ?? 'other',
			unit: meta?.unit ?? 'count',
			daily: toSeries(daily),
		});
	}
	// Busiest item first — on a chart the top series is the one being looked for.
	itemList.sort((a, b) => totalOf(b.daily) - totalOf(a.daily) || a.name.localeCompare(b.name));

	const categoryList: CategorySeries[] = [];
	for (const [category, daily] of categoryDaily) {
		categoryList.push({
			category,
			unit: categoryUnit.get(category) ?? 'count',
			daily: toSeries(daily),
		});
	}
	categoryList.sort((a, b) => totalOf(b.daily) - totalOf(a.daily) || a.category.localeCompare(b.category));

	const formulaList: FormulaSeries[] = [];
	for (const [itemId, daily] of formulaDaily) {
		const meta = items.get(itemId);
		formulaList.push({
			itemId,
			name: meta?.name ?? `Formula ${itemId}`,
			unit: 'oz',
			daily: toSeries(daily),
		});
	}
	formulaList.sort((a, b) => totalOf(b.daily) - totalOf(a.daily) || a.name.localeCompare(b.name));

	return { days: dates.map((d) => buckets.get(d)!), items: itemList, categories: categoryList, formulas: formulaList };
}
