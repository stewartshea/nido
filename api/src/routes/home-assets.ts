// routes/home-assets.ts
//
// HOME module milestone 1 (issue #65): the home asset registry.
//
// Family-scoped like inventory, but with no member dimension — an asset
// belongs to the family, not to a subject. All members see all assets
// (PRD §4); archiving is the only soft exit, because a sold car keeps its
// history.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import {
	ASSET_CATEGORIES, ASSET_CATEGORY_IDS, assetFor, householdIdFor, shapeAsset, type AssetRow,
} from '../home-assets';

const homeAssetRoutes = new Hono<AuthEnv>();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const identitySchema = z.object({
	manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
	model: z.string().trim().min(1).max(120).nullable().optional(),
	modelYear: z.number().int().min(1900).max(2100).nullable().optional(),
	serial: z.string().trim().min(1).max(200).nullable().optional(),
});

const createAssetSchema = z.object({
	name: z.string().trim().min(1).max(200),
	category: z.enum(ASSET_CATEGORY_IDS),
	/** The residence this asset lives at; null/omitted = family-wide. */
	homeId: z.number().int().positive().nullable().optional(),
	identity: identitySchema.default({}),
	acquiredAt: z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)').nullable().optional(),
	purchasePrice: z.number().int().min(0).max(100_000_000).nullable().optional(),   // cents
	notes: z.string().max(2000).nullable().optional(),
});

const updateAssetSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	category: z.enum(ASSET_CATEGORY_IDS).optional(),
	homeId: z.number().int().positive().nullable().optional(),
	identity: identitySchema.optional(),
	acquiredAt: z.string().regex(DATE_ONLY).nullable().optional(),
	purchasePrice: z.number().int().min(0).max(100_000_000).nullable().optional(),
	notes: z.string().max(2000).nullable().optional(),
});

/**
 * A home id, only when it belongs to the caller's family.
 *
 * Same scoping rule as an asset: a wrong-family home id is rejected, not
 * silently kept — otherwise `homeId` would be a probe for which homes exist.
 */
async function homeExistsForFamily(db: any, homeId: number, householdId: number): Promise<boolean> {
	const res = await db.execute({
		sql: 'SELECT 1 FROM homes WHERE id = ? AND household_id = ? LIMIT 1',
		args: [homeId, householdId],
	});
	return res.rows.length > 0;
}

/** Merge a request's identity document over the stored one. */
function identityMerge(
	previous: { manufacturer: string | null; model: string | null; model_year: number | null; serial: string | null },
	patch: Partial<{ manufacturer: string | null; model: string | null; modelYear: number | null; serial: string | null }>,
) {
	const blank = patch.manufacturer === undefined ? previous.manufacturer : (patch.manufacturer ?? null);
	const model = patch.model === undefined ? previous.model : (patch.model ?? null);
	const year = patch.modelYear === undefined ? previous.model_year : (patch.modelYear ?? null);
	const serial = patch.serial === undefined ? previous.serial : (patch.serial ?? null);
	return { manufacturer: blank, model, model_year: year, serial };
}

homeAssetRoutes.get('/', async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);

	const includeArchived = c.req.query('includeArchived') === 'true';
	const archivedFilter = includeArchived ? '' : 'AND archived_at IS NULL';
	// `?homeId=` scopes the list to one residence's assets (the /home Homes
	// card); null homeId is NOT expressible here — "family-wide" is simply
	// no filter, so an unscoped call stays the default.
	const homeIdParam = c.req.query('homeId');
	const homeFilter = homeIdParam ? 'AND home_id = ?' : '';
	const res = await db.execute({
		sql: `
			SELECT * FROM home_assets
			WHERE household_id = ? ${archivedFilter} ${homeFilter}
			ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE, id
		`,
		args: homeIdParam ? [householdId, Number(homeIdParam)] : [householdId],
	});
	return c.json({ assets: (res.rows as unknown as AssetRow[]).map(shapeAsset) });
});

/** Read back the category list for pickers, so the client never hardcodes it. Registered before `/:id`, or it would never match. */
homeAssetRoutes.get('/meta/categories', async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);
	return c.json({ categories: ASSET_CATEGORIES });
});

homeAssetRoutes.post('/', zValidator('json', createAssetSchema), async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);

	const body = c.req.valid('json');
	// A home id that is not this family's is rejected, not silently stored.
	if (body.homeId != null && !(await homeExistsForFamily(db, body.homeId, householdId))) {
		return c.json({ error: 'Home not found' }, 404);
	}
	const identity = {
		manufacturer: body.identity.manufacturer ?? null,
		model: body.identity.model ?? null,
		model_year: body.identity.modelYear ?? null,
		serial: body.identity.serial ?? null,
	};
	const res = await db.execute({
		sql: `
			INSERT INTO home_assets
			  (household_id, home_id, name, category, manufacturer, model, model_year, serial,
			   acquired_at, purchase_price, notes, created_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		args: [
			householdId, body.homeId ?? null, body.name, body.category,
			identity.manufacturer, identity.model, identity.model_year, identity.serial,
			body.acquiredAt ?? null, body.purchasePrice ?? null, body.notes ?? null, c.get('userId'),
		],
	});
	const row = await assetFor(db, Number((res as any).lastInsertRowid), householdId);
	if (!row) return c.json({ error: 'Asset not found' }, 500);
	return c.json({ asset: shapeAsset(row) }, 201);
});

homeAssetRoutes.get('/:id', async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);
	const row = await assetFor(db, Number(c.req.param('id')), householdId);
	if (!row) return c.json({ error: 'Asset not found' }, 404);
	return c.json({ asset: shapeAsset(row) });
});

homeAssetRoutes.put('/:id', zValidator('json', updateAssetSchema), async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);

	const id = Number(c.req.param('id'));
	const previous = await assetFor(db, id, householdId);
	if (!previous) return c.json({ error: 'Asset not found' }, 404);

	const body = c.req.valid('json');
	if (body.homeId != null && !(await homeExistsForFamily(db, body.homeId, householdId))) {
		return c.json({ error: 'Home not found' }, 404);
	}
	const identity = identityMerge(previous, body.identity ?? {});
	const updatedAt = new Date().toISOString();

	await db.execute({
		sql: `
			UPDATE home_assets SET
			  name = ?, category = ?, home_id = ?, manufacturer = ?, model = ?, model_year = ?,
			  serial = ?, acquired_at = ?, purchase_price = ?, notes = ?, updated_at = ?
			WHERE id = ? AND household_id = ?
		`,
		args: [
			body.name ?? previous.name,
			body.category ?? previous.category,
			body.homeId === undefined ? previous.home_id : (body.homeId ?? null),
			identity.manufacturer, identity.model, identity.model_year, identity.serial,
			body.acquiredAt === undefined ? previous.acquired_at : (body.acquiredAt ?? null),
			body.purchasePrice === undefined ? previous.purchase_price : (body.purchasePrice ?? null),
			body.notes === undefined ? previous.notes : (body.notes ?? null),
			updatedAt, id, householdId,
		],
	});
	return c.json({ asset: shapeAsset((await assetFor(db, id, householdId))!) });
});

/**
 * Archive / unarchive, as actions rather than a PATCH flag.
 *
 * An archived asset keeps its rows — maintenance history (#68) will join
 * against them — and leaves the default list. `archived_at` is the column,
 * so "archived?" stays one honest question rather than a boolean to keep in
 * sync with a timestamp.
 */
async function setArchived(db: any, id: number, householdId: number, archivedAt: string | null) {
	const previous = await assetFor(db, id, householdId);
	if (!previous) return null;
	await db.execute({
		sql: 'UPDATE home_assets SET archived_at = ?, updated_at = ? WHERE id = ? AND household_id = ?',
		args: [archivedAt, new Date().toISOString(), id, householdId],
	});
	return shapeAsset((await assetFor(db, id, householdId))!);
}

homeAssetRoutes.post('/:id/archive', async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await setArchived(db, Number(c.req.param('id')), householdId, new Date().toISOString());
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	return c.json({ asset });
});

homeAssetRoutes.post('/:id/unarchive', async (c) => {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	if (householdId === null) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await setArchived(db, Number(c.req.param('id')), householdId, null);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	return c.json({ asset });
});

export default homeAssetRoutes;