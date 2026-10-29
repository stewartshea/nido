// api/src/home-assets.ts
//
// The home asset registry — the first HOME module (issue #65).
//
// A home asset is a durable thing a family owns that needs care: a car, a
// furnace, the house itself. It is not inventory stock — nothing here is
// countable or consumed — and it is not a subject. It is the anchor the
// later modules hang off: meters (#66), schedule items (#67), maintenance
// entries (#68), manuals (#69), and templates (#71).
//
// GLOSSARY: "home asset", never "home" alone (that is the residence) and
// never unqualified "asset" (that is inventory's word for a trackable thing).

/**
 * The controlled vocabulary of asset categories.
 *
 * Deliberately a closed enum, unlike inventory's free-text categories: the
 * templates (issue #71) key off it, and a reportable registry cannot be
 * whatever a family typed on a Tuesday. `other` exists so the enum is never
 * a blocker.
 */
export const ASSET_CATEGORY_IDS = ['vehicle', 'appliance', 'hvac', 'structure', 'outdoor', 'other'] as const;

export type AssetCategoryId = (typeof ASSET_CATEGORY_IDS)[number];

/** Friendly labels, in category order, for pickers. */
export const ASSET_CATEGORIES: ReadonlyArray<{ id: AssetCategoryId; label: string }> = [
	{ id: 'vehicle', label: 'Vehicle' },
	{ id: 'appliance', label: 'Appliance' },
	{ id: 'hvac', label: 'Heating & cooling' },
	// Structure = improvements at a residence (shed, fence, driveway, sump) —
	// the residence itself is a `homes` row, never an asset (PRD §2.1).
	{ id: 'structure', label: 'Structures & improvements' },
	{ id: 'outdoor', label: 'Yard & outdoor' },
	{ id: 'other', label: 'Other' },
];

export function isAssetCategory(value: unknown): value is AssetCategoryId {
	return typeof value === 'string' && (ASSET_CATEGORY_IDS as readonly string[]).includes(value);
}

/** A home_assets row as SQLite returns it. */
export interface AssetRow {
	id: number;
	household_id: number;
	/** The residence this asset lives at, or null for family-wide (PRD §2.1). */
	home_id: number | null;
	name: string;
	category: string;
	manufacturer: string | null;
	model: string | null;
	model_year: number | null;
	serial: string | null;
	acquired_at: string | null;
	purchase_price: number | null;
	notes: string | null;
	archived_at: string | null;
	created_by: string | null;
	created_at: string | null;
	updated_at: string | null;
}

/**
 * The identity quartet: manufacturer, model, model_year, serial.
 *
 * Optional by design, but it is the key the manual lookup (PRD §7.4) and the
 * "add a car" populate moment (PRD §7.5) read, so it is one named thing
 * rather than four loose columns.
 */
export interface AssetIdentity {
	manufacturer: string | null;
	model: string | null;
	modelYear: number | null;
	serial: string | null;
}

/** The API shape of an asset. */
export interface Asset {
	id: number;
	name: string;
	category: AssetCategoryId;
	/** The residence this asset lives at: a homes row id, or null = family-wide. */
	homeId: number | null;
	identity: AssetIdentity;
	acquiredAt: string | null;
	/** Cents. Kept integer so a cost rollup never invents precision. */
	purchasePrice: number | null;
	notes: string | null;
	archivedAt: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

/**
 * A row back into API shape.
 *
 * `category` is trusted from the row: the write paths validate against the
 * enum, so a value that is not one of ours did not come from us.
 */
export function shapeAsset(row: AssetRow): Asset {
	return {
		id: Number(row.id),
		name: String(row.name),
		category: isAssetCategory(row.category) ? row.category : 'other',
		homeId: row.home_id === null || row.home_id === undefined ? null : Number(row.home_id),
		identity: {
			manufacturer: row.manufacturer ?? null,
			model: row.model ?? null,
			modelYear: row.model_year === null || row.model_year === undefined ? null : Number(row.model_year),
			serial: row.serial ?? null,
		},
		acquiredAt: row.acquired_at ?? null,
		purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? null : Number(row.purchase_price),
		notes: row.notes ?? null,
		archivedAt: row.archived_at ?? null,
		createdAt: row.created_at ?? null,
		updatedAt: row.updated_at ?? null,
	};
}