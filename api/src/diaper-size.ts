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

/**
 * The conventional size chart, used to prefill a ladder and to read a pack
 * whose variant names a standard size. Brands differ slightly, so a family
 * can edit every band once the row exists.
 */
export const STANDARD_DIAPER_SIZES: {
	size: string;
	weightBandMinKg: number | null;
	weightBandMaxKg: number | null;
}[] = [
	{ size: 'P', weightBandMinKg: 0, weightBandMaxKg: 2.7 },
	{ size: 'NB', weightBandMinKg: 2.7, weightBandMaxKg: 4.5 },
	{ size: '1', weightBandMinKg: 3.5, weightBandMaxKg: 6.5 },
	{ size: '2', weightBandMinKg: 5.5, weightBandMaxKg: 8.2 },
	{ size: '3', weightBandMinKg: 7.3, weightBandMaxKg: 12.7 },
	{ size: '4', weightBandMinKg: 10.0, weightBandMaxKg: 16.8 },
	{ size: '5', weightBandMinKg: 12.2, weightBandMaxKg: null },
	{ size: '6', weightBandMinKg: 15.9, weightBandMaxKg: null },
	{ size: '7', weightBandMinKg: 18.6, weightBandMaxKg: null },
];

/**
 * The standard size a pack's variant names, or null when it names something
 * else. A family that types "size 4", "4" or "newborn" means the size chart;
 * "night" or "big box" does not, and must not be guessed at.
 */
export function standardSizeForVariant(variant: string | null | undefined): (typeof STANDARD_DIAPER_SIZES)[number] | null {
	if (variant === null || variant === undefined) return null;
	const normalized = String(variant).trim().toLowerCase().replace(/^size\s+/, '').replace(/\s+/g, ' ');
	if (!normalized) return null;
	const label = normalized === 'preemie' ? 'p' : normalized === 'newborn' || normalized === 'new born' ? 'nb' : normalized;
	return STANDARD_DIAPER_SIZES.find((s) => s.size.toLowerCase() === label) ?? null;
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
 * A ladder read from the member's own diaper stock, for a family that names
 * its packs by size but never opened the size-ladder form.
 *
 * The pack variant is the size label — the inventory form calls it
 * "Variant (e.g. size)" — so "1" and "2" can be placed on the standard chart
 * without the family re-entering bands. Two distinct standard sizes are
 * required: one pack has nothing to choose between, and a pair of identical
 * packs cannot be told apart by weight.
 */
function stockItemLadder(
	items: { id: number; variant: string | null; createdAt: string | null }[],
): (DiaperSizeBands & { stockId: number | null })[] {
	const bySize = new Map<string, { id: number; variant: string | null; createdAt: string | null }>();
	for (const item of items) {
		const preset = standardSizeForVariant(item.variant);
		if (!preset || bySize.has(preset.size)) continue;
		bySize.set(preset.size, item);
	}
	if (bySize.size < 2) return [];

	return STANDARD_DIAPER_SIZES.map((preset) => {
		const item = bySize.get(preset.size) ?? null;
		return {
			size: preset.size,
			itemId: item?.id ?? null,
			active: item !== null,
			weightBandMinKg: preset.weightBandMinKg,
			weightBandMaxKg: preset.weightBandMaxKg,
			startDate: item?.createdAt ?? null,
			stockId: item?.id ?? null,
		};
	});
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
 * change bills no diaper stock rather than guessing at an older size. When the
 * family never built a ladder, packs whose variants are standard size labels
 * stand in for it; this is the common "diapers (1)" and "diapers (2)" setup.
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

	let candidates = mapped;
	let linked = mapped.filter((s) => s.stockId !== null);

	// A ladder with two linked packs is the family's own answer. Without one,
	// the packs' size-labelled variants are the next-best source.
	if (linked.length < 2) {
		const stock = (await db.execute({
			sql: `SELECT i.id, i.variant, i.created_at
			      FROM inventory_items i
			      JOIN inventory_consumption_rules r
			        ON r.item_id = i.id AND r.active = 1 AND r.source_category = 'diapers'
			      WHERE i.active = 1 AND i.category = 'diapers'
			        AND (i.subject_id = ? OR i.subject_id IS NULL)
			      ORDER BY (i.subject_id IS NULL), i.quantity DESC, i.id`,
			args: [subjectId],
		})).rows as any[];
		const inferred = stockItemLadder(stock.map((i) => ({
			id: Number(i.id),
			variant: i.variant === null || i.variant === undefined ? null : String(i.variant),
			createdAt: i.created_at === null || i.created_at === undefined ? null : String(i.created_at),
		})));
		const inferredLinked = inferred.filter((s) => s.stockId !== null);
		if (inferredLinked.length >= 2) {
			candidates = inferred;
			linked = inferredLinked;
		}
	}

	if (linked.length < 2) return undefined;

	const latest = (await db.execute({
		sql: `SELECT weight, unit_system FROM growth
		      WHERE subject_id = ? AND weight IS NOT NULL
		      ORDER BY measurement_date DESC, id DESC LIMIT 1`,
		args: [subjectId],
	})).rows[0] as any | undefined;

	const current = latest
		? sizeForWeight(candidates, weightKg(Number(latest.weight), latest.unit_system))
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
