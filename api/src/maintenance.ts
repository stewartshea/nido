// api/src/maintenance.ts
//
// HOME module milestone 4 (issue #68): the maintenance log.
//
// One entry is one thing done to one asset, once — "oil change, Oct 14, $89,
// 84,200 km". It is the record the other modules read:
//
//   schedules   — an entry is what satisfies a schedule; "checked off" is
//                 derived from one of these, never from a checkbox.
//   meters      — an entry can carry the meter reading taken at the time, so
//                 logging an oil change is also how the odometer stays current.
//   inventory   — consumed items write through the same ledger the manual
//                 adjust route uses, so "1 × furnace filter" keeps stock honest.
//   costs       — entry-level, so per-asset and per-year totals fall out.
//
// `schedule_id` NULL is ad-hoc care ("fixed the squeaky door"): it appears in
// the history and the cost rollup, never in "what's due".

import { datePart } from './dates';

export interface MaintenanceEntryRow {
	id: number;
	household_id: number;
	asset_id: number;
	schedule_id: number | null;
	task: string;
	performed_at: string;
	cost: number | null;
	provider_id: number | null;
	notes: string | null;
	created_by: string | null;
	created_at: string | null;
	updated_at: string | null;
}

export interface ConsumedItemRow {
	entry_id: number;
	item_id: number;
	quantity: number;
}

export interface ConsumedItem {
	itemId: number;
	quantity: number;
	/** Filled in by the route from inventory, when the item still exists. */
	name?: string;
	unit?: string;
}

export interface MaintenanceEntry {
	id: number;
	assetId: number;
	scheduleId: number | null;
	task: string;
	performedAt: string;
	/** Cents, or null when the work was free / not recorded. */
	cost: number | null;
	providerId: number | null;
	notes: string | null;
	consumedItems: ConsumedItem[];
	createdAt: string | null;
	updatedAt: string | null;
}

export function shapeEntry(row: MaintenanceEntryRow, consumed: ConsumedItem[] = []): MaintenanceEntry {
	return {
		id: Number(row.id),
		assetId: Number(row.asset_id),
		scheduleId: row.schedule_id === null || row.schedule_id === undefined ? null : Number(row.schedule_id),
		task: String(row.task),
		performedAt: datePart(String(row.performed_at)),
		cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
		providerId: row.provider_id === null || row.provider_id === undefined ? null : Number(row.provider_id),
		notes: row.notes ?? null,
		consumedItems: consumed,
		createdAt: row.created_at ?? null,
		updatedAt: row.updated_at ?? null,
	};
}

export interface YearCost {
	year: string;
	total: number;
	count: number;
}

export interface CostRollup {
	/** Cents spent in total, or null when no entry carried a cost. */
	total: number | null;
	/** How many entries carry a cost (the denominator of the average). */
	count: number;
	byYear: YearCost[];
}

/**
 * Costs roll up per asset and per year.
 *
 * Only entries that *carried* a cost count — an entry with `cost` null is
 * "unknown", not zero, so including it in an average would quietly make the
 * average wrong. The total is null rather than 0 when nothing was recorded,
 * for the same reason.
 */
export function costRollup(entries: readonly MaintenanceEntry[]): CostRollup {
	let total = 0;
	let count = 0;
	const years = new Map<string, YearCost>();
	for (const entry of entries) {
		if (entry.cost === null) continue;
		total += entry.cost;
		count += 1;
		const year = entry.performedAt.slice(0, 4);
		const bucket = years.get(year) ?? { year, total: 0, count: 0 };
		bucket.total += entry.cost;
		bucket.count += 1;
		years.set(year, bucket);
	}
	return {
		total: count ? total : null,
		count,
		byYear: [...years.values()].sort((a, b) => b.year.localeCompare(a.year)),
	};
}
