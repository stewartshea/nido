// api/src/diaper-size.ts
//
// Which size a child is wearing, in one place.
//
// Two callers need the same answer: the size-up signal (how long until this
// size is outgrown) and the diaper route (which stock item a change bills).
// Two selectors would eventually disagree about which band "current" means,
// and the forecast would contradict the stock.
//
// Bands are kilograms, while a growth record stores whatever the family typed,
// so weight is converted here before it meets a band.

export interface DiaperSizeBands {
	size: string;
	itemId: number | null;
	active: boolean;
	/** Weight at which this size begins. */
	weightBandMinKg: number | null;
	/** Weight at which the child grows out of it. */
	weightBandMaxKg: number | null;
	/** When this size was started; a tie-break when no weight is known. */
	startDate?: string | null;
}

const LB_PER_KG = 0.453592;

/** A stored weight in kilograms. Growth rows keep the unit they were typed in. */
export function weightKg(weight: number, unitSystem?: string | null): number {
	return unitSystem === 'imperial' ? weight * LB_PER_KG : weight;
}

/**
 * The size in use: the last band whose floor the weight has reached, or the
 * smallest size when the child is below every floor. Null when no size has a
 * floor to compare against.
 *
 * This deliberately ignores `active`: a size the family has already grown into
 * is the one being worn, even if its row still says "next" from before the
 * growth record arrived.
 */
export function sizeForWeight<T extends DiaperSizeBands>(sizes: T[], kilograms: number): T | null {
	const banded = sizes
		.filter((s) => s.weightBandMinKg !== null && Number.isFinite(Number(s.weightBandMinKg)))
		.sort((a, b) => a.weightBandMinKg! - b.weightBandMinKg!);
	if (banded.length === 0) return null;
	let index = -1;
	for (const [i, size] of banded.entries()) {
		if (size.weightBandMinKg! <= kilograms) index = i;
	}
	return banded[index === -1 ? 0 : index] ?? null;
}

/**
 * No weight to compare against: prefer the current (active) size, and among
 * those the one started most recently — but only when that date is unique.
 * A preloaded ladder stamps every row at once, and a tie must not pick the
 * largest size, so it falls back to the smallest band instead.
 */
export function sizeWithoutWeight<T extends DiaperSizeBands>(sizes: T[]): T | null {
	const active = sizes.filter((s) => s.active);
	const pool = active.length > 0 ? active : sizes;
	if (pool.length === 0) return null;

	const started = pool
		.filter((s) => s.startDate)
		.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
	const newest = started[started.length - 1];
	if (newest && started.filter((s) => s.startDate === newest.startDate).length === 1) return newest;

	const banded = pool
		.filter((s) => s.weightBandMinKg !== null)
		.sort((a, b) => a.weightBandMinKg! - b.weightBandMinKg!);
	return banded[0] ?? pool[0] ?? null;
}

/**
 * The stock item a diaper change should bill, or undefined when no pin is
 * needed.
 *
 * A family tracking more than one size as stock needs the change to bill the
 * one being worn: without a pin, every linked size comes down together. With
 * zero or one linked size there is nothing to choose between, so this returns
 * undefined and billing stays exactly as it was before the ladder existed.
 *
 * The current size is read from the latest growth weight against the ladder's
 * bands. If the size in use names no stock item, the answer is null — the
 * change bills no diaper stock rather than guessing at an older size.
 */
export async function diaperBilledItemId(db: any, subjectId: number): Promise<number | null | undefined> {
	const sizes = (await db.execute({
		sql: `SELECT d.size, d.item_id, d.active, d.start_date,
		             d.weight_band_kg, d.weight_band_max_kg,
		             i.id AS stock_id
		      FROM diaper_sizes d
		      LEFT JOIN inventory_items i ON i.id = d.item_id AND i.active = 1
		      WHERE d.subject_id = ?
		      ORDER BY d.id`,
		args: [subjectId],
	})).rows as any[];

	const mapped: (DiaperSizeBands & { stockId: number | null })[] = sizes.map((s) => ({
		size: String(s.size),
		itemId: s.item_id === null || s.item_id === undefined ? null : Number(s.item_id),
		active: Number(s.active ?? 1) === 1,
		weightBandMinKg: s.weight_band_kg === null || s.weight_band_kg === undefined ? null : Number(s.weight_band_kg),
		weightBandMaxKg: s.weight_band_max_kg === null || s.weight_band_max_kg === undefined ? null : Number(s.weight_band_max_kg),
		startDate: s.start_date === null || s.start_date === undefined ? null : String(s.start_date),
		stockId: s.stock_id === null || s.stock_id === undefined ? null : Number(s.stock_id),
	}));

	// One linked size is already unambiguous; zero leaves the old behaviour.
	const linked = mapped.filter((s) => s.stockId !== null);
	if (linked.length < 2) return undefined;

	const latest = (await db.execute({
		sql: `SELECT weight, unit_system FROM growth
		      WHERE subject_id = ? AND weight IS NOT NULL
		      ORDER BY measurement_date DESC, id DESC LIMIT 1`,
		args: [subjectId],
	})).rows[0] as any | undefined;

	const current = latest
		? sizeForWeight(mapped, weightKg(Number(latest.weight), latest.unit_system))
		: null;
	// With a weight and bands we know the size, even when it has no pack
	// linked: billing nothing is the honest answer, not billing an older size.
	if (current) return current.stockId ?? null;

	// Without a weight (or bands) there is no size to know. Choose among the
	// linked packs: a preloaded ladder starts with unlinked rows, and the
	// family should not lose billing until they record a weight.
	const chosen = sizeWithoutWeight(linked);
	return chosen ? chosen.stockId ?? null : null;
}
