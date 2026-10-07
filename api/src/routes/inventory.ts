import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { resolveTrackableMember, type MemberScope } from '../member-scope';
import { type AuthEnv } from '../auth';
import { sendMail, getAppSettings, smtpConfigured, baseUrl } from '../mail';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { renderInventoryAlertsEmail } from '../mail-templates';
import { consumptionRate, coverForecast, cadenceRate, dueCycles, nextConsumptionAt, MS_PER_DAY, type AdjustmentRow } from '../inventory';
import { SIGNALS, signalByName } from '../inventory-signals';
import {
	applyScheduledConsumption, evaluateAlerts, loadRulesForFamily, signalContext,
} from '../inventory-eval';
import { runFamilyDigest } from '../notifications';

const inventoryRoutes = new Hono<AuthEnv>();

// A starter list, not a closed set. Households invent their own categories, so
// the route accepts any short string and seeds these for convenience only.

const createItemSchema = z.object({
	memberId: z.number().nullish(),
	name: z.string().min(1).max(120),
	category: z.string().trim().min(1).max(40),
	variant: z.string().max(60).nullish(),
	quantity: z.number().min(0).default(0),
	unit: z.string().max(20).default('count'),
	packSize: z.number().positive().nullish(),
	leadDays: z.number().int().min(0).max(365).nullish(),
	eventCategory: z.string().max(40).nullish(),
	decrementPerEvent: z.number().positive().nullish(),
	consumeIntervalDays: z.number().int().min(1).max(365).nullish(),
	expiresAt: z.string().datetime().nullish(),
	notes: z.string().max(500).nullish(),
}).refine(
	// Two consumption mechanisms on one item would decrement it twice per
	// occurrence, so an item uses either a logged event or a cadence, never both.
	(v) => !(v.eventCategory && v.consumeIntervalDays),
	{ message: 'Use either a logged event or a "uses up every N days" cadence, not both', path: ['consumeIntervalDays'] },
);

const updateItemSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	variant: z.string().max(60).nullish(),
	unit: z.string().max(20).optional(),
	packSize: z.number().positive().nullish(),
	leadDays: z.number().int().min(0).max(365).nullish(),
	eventCategory: z.string().max(40).nullish(),
	decrementPerEvent: z.number().positive().nullish(),
	consumeIntervalDays: z.number().int().min(1).max(365).nullish(),
	consumeStartedAt: z.string().datetime().nullish(),
	expiresAt: z.string().datetime().nullish(),
	notes: z.string().max(500).nullish(),
	active: z.boolean().optional(),
});

const adjustSchema = z.object({
	change: z.number().refine((v) => v !== 0, 'Change cannot be zero'),
	reason: z.enum(['purchase', 'used', 'manual', 'correction']).default('manual'),
	note: z.string().max(300).nullish(),
});

const diaperSizeSchema = z.object({
	memberId: z.number(),
	size: z.string().min(1).max(10),
	itemId: z.number().nullish(),
	startDate: z.string().datetime().nullish(),
	weightBandMinKg: z.number().nonnegative().max(40).nullish(),
	weightBandMaxKg: z.number().positive().max(40).nullish(),
}).refine(
	// A band with an inverted range would make the forecast meaningless, so it is
	// refused at the edge rather than silently producing a negative answer.
	(v) => v.weightBandMinKg == null || v.weightBandMaxKg == null || v.weightBandMinKg < v.weightBandMaxKg,
	{ message: 'The upper weight must be above the lower weight', path: ['weightBandMaxKg'] },
);

const diaperSizeUpdateSchema = z.object({
	size: z.string().min(1).max(10).optional(),
	itemId: z.number().nullish(),
	active: z.boolean().optional(),
	weightBandMinKg: z.number().nonnegative().max(40).nullish(),
	weightBandMaxKg: z.number().positive().max(40).nullish(),
});

async function resolveBabyId(db: any, memberId: number | null | undefined, userId: string): Promise<{ subjectId: number | null; error?: string }> {
	if (memberId === null || memberId === undefined) return { subjectId: null };
	const scope: MemberScope | null = await resolveTrackableMember(db, userId, memberId);
	if (!scope) return { subjectId: null, error: 'Member not found or access denied' };
	return { subjectId: scope.subjectId };
}

type ItemForecast = ReturnType<typeof coverForecast> & { ledgerQuantity: number | null };

function shapeItem(row: any, forecast: ItemForecast, firing: boolean) {
	return {
		id: Number(row.id),
		memberId: row.subject_id === null || row.subject_id === undefined ? null : Number(row.subject_id),
		name: row.name,
		category: row.category,
		variant: row.variant ?? null,
		quantity: Number(row.quantity),
		unit: row.unit ?? 'count',
		packSize: row.pack_size === null || row.pack_size === undefined ? null : Number(row.pack_size),
		leadDays: row.lead_days === null || row.lead_days === undefined ? null : Number(row.lead_days),
		eventCategory: row.event_category ?? null,
		decrementPerEvent: row.decrement_per_event === null || row.decrement_per_event === undefined ? null : Number(row.decrement_per_event),
		active: Number(row.active ?? 1) === 1,
		consumeIntervalDays: row.consume_interval_days === null || row.consume_interval_days === undefined ? null : Number(row.consume_interval_days),
		consumeStartedAt: row.consume_started_at ?? null,
		expiresAt: row.expires_at ?? null,
		// Reuses the signal so "expiring soon" means the same thing in the stats
		// row as it does in a rule. Null once past, so it never reads as negative.
		daysToExpiry: signalByName('days_to_expiry')!.compute({ item: row, adjustments: [], nowMs: Date.now() }),
		nextConsumptionAt: null as string | null,
		notes: row.notes ?? null,
		// What the ledger says the count should be. It drifts from the stored
		// quantity whenever an auto-decrement hit the zero floor and was clamped,
		// so both are reported and the gap is surfaced rather than hidden.
		ledgerQuantity: forecast.ledgerQuantity,
		drift: forecast.ledgerQuantity === null ? null : forecast.ledgerQuantity - Number(row.quantity),
		consumptionPerDay: forecast.perDay,
		daysOfCover: forecast.daysOfCover,
		runoutAt: forecast.runoutAt,
		lowConfidence: forecast.lowConfidence,
		// True when a rule is firing for this item right now. The verdict is
		// data-driven, not baked in here.
		alerting: firing,
	};
}

async function itemForecast(db: any, row: any, nowMs: number) {
	const adj = (await db.execute({
		sql: 'SELECT change, reason, created_at, source FROM inventory_adjustments WHERE item_id = ? ORDER BY created_at DESC LIMIT 500',
		args: [row.id],
	})).rows as AdjustmentRow[];
	const rate = cadenceRate(row, consumptionRate(adj, nowMs));
	const forecast = coverForecast(rate, Number(row.quantity), nowMs);
	const ledgerQuantity = adj.length ? Math.round(adj.reduce((sum, a) => sum + Number(a.change), 0) * 1000) / 1000 : null;
	return { forecast: { ...forecast, ledgerQuantity } };
}

// Returns the starter list plus every category actually in use, so the picker
// offers what this household already has.

// A starting vocabulary, applied the first time a family asks for one.
const STARTER_CATEGORIES = ['diapers', 'formula', 'baby_care', 'vitamins', 'cleaning', 'filters', 'batteries', 'household', 'other'];

async function categoryList(db: any, familyId: number): Promise<string[]> {
	const existing = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM inventory_categories WHERE family_id = ?', args: [familyId] });
	if (Number((existing.rows[0] as any).n) === 0) {
		for (const [i, name] of STARTER_CATEGORIES.entries()) {
			await db.execute({
				sql: 'INSERT OR IGNORE INTO inventory_categories (family_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)',
				args: [familyId, name, i + 1, new Date().toISOString()],
			});
		}
	}
	const rows = await db.execute({ sql: 'SELECT name FROM inventory_categories WHERE family_id = ? ORDER BY sort_order, name', args: [familyId] });
	return rows.rows.map((r: any) => String(r.name));
}

// The household's own vocabulary, unioned with any category actually in use, so
// an item recorded before a category was added still shows up as available.
inventoryRoutes.get('/categories', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const familyId = await householdIdFor(db, userId);
	if (familyId === null) return c.json({ error: 'Not a member of any family' }, 403);
	const saved = await categoryList(db, familyId);
	const used = (await db.execute({ sql: 'SELECT DISTINCT category FROM inventory_items ORDER BY category' }))
		.rows.map((r: any) => String(r.category));
	return c.json({ categories: [...new Set([...saved, ...used])] });
});

inventoryRoutes.post('/categories', zValidator('json', z.object({ name: z.string().trim().min(1).max(40) })), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const familyId = await householdIdFor(db, userId);
	if (familyId === null) return c.json({ error: 'Not a member of any family' }, 403);

	const name = c.req.valid('json').name;
	const max = (await db.execute({ sql: 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM inventory_categories WHERE family_id = ?', args: [familyId] }))
		.rows[0] as any;
	await db.execute({
		sql: 'INSERT OR IGNORE INTO inventory_categories (family_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)',
		args: [familyId, name, Number(max.m) + 1, new Date().toISOString()],
	});
	return c.json({ message: 'Category added', categories: await categoryList(db, familyId) }, 201);
});

inventoryRoutes.delete('/categories/:name', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const familyId = await householdIdFor(db, userId);
	if (familyId === null) return c.json({ error: 'Not a member of any family' }, 403);
	// Only removes it from the picker. Items keep their free-text category, so
	// nothing in use can be orphaned by tidying the list.
	await db.execute({ sql: 'DELETE FROM inventory_categories WHERE family_id = ? AND name = ?', args: [familyId, c.req.param('name')] });
	return c.json({ message: 'Category removed from the list' });
});

/**
 * Email the family about rules that are currently matching.
 *
 * There is no scheduler in this app, so this is meant to be called by a cron
 * (or anything with a clock). It is safe to call repeatedly: rule state is
 * persisted as a side effect of evaluating, so an item that already alerted does
 * not appear again until it clears and matches once more.
 */
inventoryRoutes.post('/notify', async (c) => {
	const outcome = await runFamilyDigest(c.get('familyId'), { actorId: c.get('userId'), logger: c.get('log') });
	return c.json({
		message: outcome.message,
		sent: outcome.sent,
		alerts: outcome.alerts,
		failed: outcome.failed,
		...(outcome.skipped ? { skipped: outcome.skipped } : {}),
	});
});

// The signals a rule can be written against. Data-driven so a new signal
// appears here automatically.
inventoryRoutes.get('/signals', (c) =>
	c.json({ signals: SIGNALS.map(({ name, label, unit, describe }) => ({ name, label, unit, describe })) }));

// GET / — every active item, its cover forecast, and any rule currently firing.
inventoryRoutes.get('/', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const nowMs = Date.now();
	const res = await db.execute({
		sql: `SELECT * FROM inventory_items WHERE active = 1 ORDER BY category, name`,
	});
	const items = [];
	const valuesByItem = new Map<number, Map<string, number | null>>();
	const namesByItem = new Map<number, string>();

	for (const row of res.rows as any[]) {
		await applyScheduledConsumption(db, row, userId, nowMs);
		const fresh = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [row.id] })).rows[0];
		const { forecast } = await itemForecast(db, fresh, nowMs);
		const shaped = shapeItem(fresh, forecast, false);
		shaped.nextConsumptionAt = nextConsumptionAt(fresh as any, nowMs);
		items.push(shaped);

		const values = new Map<string, number | null>();
		for (const def of SIGNALS) {
			values.set(def.name, def.compute(await signalContext(db, row, nowMs)));
		}
		valuesByItem.set(Number(row.id), values);
		namesByItem.set(Number(row.id), row.variant ? `${row.name} (${row.variant})` : String(row.name));
	}

	const { alerts, unknown } = await evaluateAlerts(db, nowMs, valuesByItem, namesByItem);
	return c.json({ items, alerts, unknown });
});

inventoryRoutes.post('/', zValidator('json', createItemSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const body = c.req.valid('json');

	const { subjectId, error } = await resolveBabyId(db, body.memberId, userId);
	if (error) return c.json({ error }, 404);

	const now = new Date().toISOString();
	const result = await db.execute({
		sql: `INSERT INTO inventory_items
		      (subject_id, name, category, variant, quantity, unit, pack_size, lead_days,
		       event_category, decrement_per_event, consume_interval_days, consume_started_at,
		       expires_at, notes, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			subjectId, body.name.trim(), body.category, body.variant ?? null, body.quantity, body.unit,
			body.packSize ?? null, body.leadDays ?? null, body.eventCategory ?? null,
			body.decrementPerEvent ?? null,
			// A cadence only means anything with an anchor to count from, so
			// starting it now is the default rather than an extra field to fill in.
			body.consumeIntervalDays ?? null, body.consumeIntervalDays ? now : null,
			body.expiresAt ?? null,
			body.notes ?? null, now, now,
		],
	});
	const itemId = Number(result.lastInsertRowid);

	// Opening stock is a ledger row, not just a column value, so the first
	// purchase is as visible as every later one.
	if (body.quantity > 0) {
		await db.execute({
			sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at, source)
			      VALUES (?, ?, 'purchase', ?, ?, ?, 'manual')`,
			args: [itemId, body.quantity, 'Opening stock', userId, now],
		});
	}

	const row = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [itemId] })).rows[0];
	const { forecast } = await itemForecast(db, row, nowMs());
	return c.json({ message: 'Item added', item: shapeItem(row, forecast, false) }, 201);
});

function nowMs() {
	return Date.now();
}

inventoryRoutes.put('/:id{[0-9]+}', zValidator('json', updateItemSchema), async (c) => {
	const db = c.get('db');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');

	const updates: string[] = [];
	const params: unknown[] = [];
	const push = (col: string, val: unknown) => { updates.push(`${col} = ?`); params.push(val); };

	if (body.name !== undefined) push('name', body.name.trim());
	if (body.variant !== undefined) push('variant', body.variant);
	if (body.unit !== undefined) push('unit', body.unit);
	if (body.packSize !== undefined) push('pack_size', body.packSize);
	if (body.leadDays !== undefined) push('lead_days', body.leadDays);
	if (body.eventCategory !== undefined) push('event_category', body.eventCategory);
	if (body.decrementPerEvent !== undefined) push('decrement_per_event', body.decrementPerEvent);
	if (body.consumeIntervalDays !== undefined) {
		push('consume_interval_days', body.consumeIntervalDays);
		// Setting a cadence restarts the count, so switching from daily to
		// fortnightly does not immediately bill every day already missed.
		push('consume_cycles_applied', 0);
		if (body.consumeIntervalDays !== null) push('consume_started_at', body.consumeStartedAt ?? new Date().toISOString());
	}
	if (body.consumeStartedAt !== undefined) push('consume_started_at', body.consumeStartedAt);
	if (body.expiresAt !== undefined) push('expires_at', body.expiresAt);
	if (body.notes !== undefined) push('notes', body.notes);
	if (body.active !== undefined) push('active', body.active ? 1 : 0);

	if (updates.length === 0) return c.json({ message: 'No updates provided' });
	push('updated_at', new Date().toISOString());
	params.push(id);

	await db.execute({ sql: `UPDATE inventory_items SET ${updates.join(', ')} WHERE id = ?`, args: params });

	const row = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [id] })).rows[0];
	if (!row) return c.json({ error: 'Item not found' }, 404);
	const { forecast } = await itemForecast(db, row, Date.now());
	return c.json({ message: 'Item updated', item: shapeItem(row, forecast, false) });
});

// POST /:id/adjust — buy, use, or correct stock by hand.
inventoryRoutes.post('/:id{[0-9]+}/adjust', zValidator('json', adjustSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');

	const row = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [id] })).rows[0];
	if (!row) return c.json({ error: 'Item not found' }, 404);

	const now = new Date().toISOString();
	const delta = body.change;
	// A stock count cannot go negative; a correction that would is refused
	// rather than silently clamped, so the mistake stays visible.
	const next = Number(row.quantity) + delta;
	if (next < 0) {
		return c.json({ error: `Cannot go below zero: ${row.name} has ${row.quantity} ${row.unit ?? 'count'}` }, 400);
	}

	await db.execute({
		sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		args: [id, delta, body.reason, body.note ?? null, userId, now],
	});
	await db.execute({ sql: 'UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?', args: [next, now, id] });

	const after = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [id] })).rows[0];
	const { forecast } = await itemForecast(db, after, Date.now());
	return c.json({ message: 'Stock adjusted', item: shapeItem(after, forecast, false) });
});

// GET /:id/adjustments — the ledger behind the forecast.
inventoryRoutes.get('/:id{[0-9]+}/adjustments', async (c) => {
	const db = c.get('db');
	const id = Number(c.req.param('id'));
	const res = await db.execute({
		sql: 'SELECT id, change, reason, note, ref_table, ref_id, created_at FROM inventory_adjustments WHERE item_id = ? ORDER BY created_at DESC LIMIT 200',
		args: [id],
	});
	return c.json({ adjustments: res.rows });
});

/**
 * The conventional diaper size ladder, and roughly where each size is outgrown.
 *
 * Brands disagree at the edges by a few hundred grams, so these are starting
 * values a household can override per size rather than truth. NB is newborn.
 * Exposed so the size picker never asks someone to type a weight band by hand.
 */
// Weight ranges for a conventional diaper ladder.
//
// The ceiling is the number that matters: a child sizes out of Size 1 at 6.5kg,
// not at the 3.5kg where they entered it. A single number per size cannot answer
// "when do they grow out of this", which is why a floor and a ceiling are both
// stored. Brands differ, so this is a starting point the family can edit.
//
// 5, 6 and 7 are open-ended on the charts this came from, so their ceiling is left
// null rather than guessed — there is nothing to outgrow into at that point.
const STANDARD_DIAPER_SIZES: { size: string; weightBandMinKg: number | null; weightBandMaxKg: number | null }[] = [
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

inventoryRoutes.get('/diaper-size-presets', (c) => c.json({ presets: STANDARD_DIAPER_SIZES }));

// Diaper sizes: the records themselves. The size-change forecast is no longer
// computed here; it is the generic size_up_in_days signal, so a rule can use it
// exactly like any other.
inventoryRoutes.get('/diaper-sizes', async (c) => {
	const db = c.get('db');
	const memberId = Number(c.req.query('memberId'));
	if (!memberId) return c.json({ error: 'memberId is required' }, 400);
	const scope = await resolveTrackableMember(db, c.get('userId'), memberId);
	if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

	const sizes = (await db.execute({
		sql: 'SELECT * FROM diaper_sizes WHERE subject_id = ? ORDER BY id',
		args: [scope.subjectId],
	})).rows as any[];

	const diaperItem = (await db.execute({
		sql: "SELECT * FROM inventory_items WHERE subject_id = ? AND active = 1 AND category = 'diapers' LIMIT 1",
		args: [scope.subjectId],
	})).rows[0] as any | undefined;

	const ctx = diaperItem ? await signalContext(db, diaperItem, Date.now()) : null;
	const signals = ctx
		? Object.fromEntries(SIGNALS.map((d) => [d.name, d.compute(ctx)]))
		: Object.fromEntries(SIGNALS.map((d) => [d.name, null]));

	return c.json({
		sizes: sizes.map((s) => ({
			id: Number(s.id),
			memberId,
			size: s.size,
			itemId: s.item_id === null || s.item_id === undefined ? null : Number(s.item_id),
			startDate: s.start_date ?? null,
			active: Number(s.active ?? 1) === 1,
			weightBandMinKg: s.weight_band_kg === null || s.weight_band_kg === undefined ? null : Number(s.weight_band_kg),
			weightBandMaxKg: s.weight_band_max_kg === null || s.weight_band_max_kg === undefined ? null : Number(s.weight_band_max_kg),
		})),
		signals,
		linkedItemId: diaperItem ? Number(diaperItem.id) : null,
	});
});

inventoryRoutes.post('/diaper-sizes', zValidator('json', diaperSizeSchema), async (c) => {
	const db = c.get('db');
	const body = c.req.valid('json');
	const scope = await resolveTrackableMember(db, c.get('userId'), body.memberId);
	if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

	const result = await db.execute({
		sql: 'INSERT INTO diaper_sizes (subject_id, size, item_id, start_date, weight_band_kg, weight_band_max_kg) VALUES (?, ?, ?, ?, ?, ?)',
		args: [scope.subjectId, body.size.trim(), body.itemId ?? null, body.startDate ?? new Date().toISOString(),
			body.weightBandMinKg ?? null, body.weightBandMaxKg ?? null],
	});
	return c.json({ message: 'Diaper size added', id: Number(result.lastInsertRowid) }, 201);
});

/**
 * Seed the conventional ladder for a member in one step, skipping sizes the
 * caller omits. Sizes already recorded are left alone, so this cannot duplicate
 * a ladder that is already partly filled in.
 */
inventoryRoutes.post('/diaper-sizes/preload', zValidator('json', z.object({
	memberId: z.number(),
	sizes: z.array(z.object({
		size: z.string().min(1).max(10),
		weightBandMinKg: z.number().nonnegative().max(40).nullish(),
		weightBandMaxKg: z.number().positive().max(40).nullish(),
	})).min(1).optional(),
	itemId: z.number().nullish(),
})), async (c) => {
	const db = c.get('db');
	const body = c.req.valid('json');
	const scope = await resolveTrackableMember(db, c.get('userId'), body.memberId);
	if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

	const wanted = (body.sizes ?? STANDARD_DIAPER_SIZES).map((x) => ({
		size: x.size.trim(),
		weightBandMinKg: x.weightBandMinKg ?? null,
		weightBandMaxKg: x.weightBandMaxKg ?? null,
	}));
	const existing = (await db.execute({ sql: 'SELECT size FROM diaper_sizes WHERE subject_id = ?', args: [scope.subjectId] }))
		.rows.map((r: any) => String(r.size));

	let added = 0;
	const now = new Date().toISOString();
	for (const row of wanted) {
		if (existing.includes(row.size)) continue;
		await db.execute({
			sql: 'INSERT INTO diaper_sizes (subject_id, size, item_id, start_date, weight_band_kg, weight_band_max_kg) VALUES (?, ?, ?, ?, ?, ?)',
			args: [scope.subjectId, row.size, body.itemId ?? null, now, row.weightBandMinKg, row.weightBandMaxKg],
		});
		added += 1;
	}
	return c.json({ message: added ? `Added ${added} size(s)` : 'Those sizes were already recorded', added }, 201);
});

inventoryRoutes.put('/diaper-sizes/:id{[0-9]+}', zValidator('json', diaperSizeUpdateSchema), async (c) => {
	const db = c.get('db');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');
	const updates: string[] = [];
	const params: unknown[] = [];
	if (body.size !== undefined) { updates.push('size = ?'); params.push(body.size.trim()); }
	if (body.itemId !== undefined) { updates.push('item_id = ?'); params.push(body.itemId); }
	if (body.active !== undefined) { updates.push('active = ?'); params.push(body.active ? 1 : 0); }
	if (body.weightBandMinKg !== undefined) { updates.push('weight_band_kg = ?'); params.push(body.weightBandMinKg); }
	if (body.weightBandMaxKg !== undefined) { updates.push('weight_band_max_kg = ?'); params.push(body.weightBandMaxKg); }
	if (updates.length === 0) return c.json({ message: 'No updates provided' });
	params.push(id);
	const res = await db.execute({ sql: `UPDATE diaper_sizes SET ${updates.join(', ')} WHERE id = ?`, args: params });
	if (!res.rowsAffected) return c.json({ error: 'Diaper size not found' }, 404);
	return c.json({ message: 'Diaper size updated' });
});

// Retire a size rather than deleting it: the row is the record that a child
// wore that size, and the forecast reads the active set.
inventoryRoutes.delete('/diaper-sizes/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const res = await db.execute({
		sql: 'UPDATE diaper_sizes SET active = 0 WHERE id = ?',
		args: [Number(c.req.param('id'))],
	});
	if (!res.rowsAffected) return c.json({ error: 'Diaper size not found' }, 404);
	return c.json({ message: 'Diaper size retired' });
});

const recountSchema = z.object({
	quantity: z.number().min(0),
	note: z.string().max(200).nullish(),
});

async function loadItemOr404(db: any, id: number) {
	const row = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [id] })).rows[0];
	return row ?? null;
}

/**
 * Set an item's count to what a human counted, as one auditable correction.
 *
 * Preferable to editing the number in place, because the ledger stays the
 * history: the discrepancy is recorded rather than erased, so the next recount
 * can tell how far the automatic tracking had drifted.
 */
inventoryRoutes.post('/:id{[0-9]+}/recount', zValidator('json', recountSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');

	const row = await loadItemOr404(db, id);
	if (!row) return c.json({ error: 'Item not found' }, 404);

	const delta = body.quantity - Number(row.quantity);
	const now = new Date().toISOString();
	if (delta !== 0) {
		await db.execute({
			sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at)
			      VALUES (?, ?, 'correction', ?, ?, ?)`,
			args: [id, delta, body.note ?? `Counted ${body.quantity}`, userId, now],
		});
	}
	await db.execute({ sql: 'UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?', args: [body.quantity, now, id] });

	const after = await loadItemOr404(db, id);
	const { forecast } = await itemForecast(db, after, Date.now());
	return c.json({ message: 'Count corrected', item: shapeItem(after, forecast, false) });
});

/**
 * Forget an item's consumption history and start again from a known count.
 *
 * The escape hatch for when the recorded history is the problem rather than the
 * count: periods where nothing was tracked, a category that was never linked to
 * the right events, or a run of changes logged while the stock was mis-set. A
 * single opening row is written so the new history is auditable and the rate
 * starts from one known point.
 */
inventoryRoutes.post('/:id{[0-9]+}/reset-history', zValidator('json', recountSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');

	const row = await loadItemOr404(db, id);
	if (!row) return c.json({ error: 'Item not found' }, 404);

	const now = new Date().toISOString();
	await db.execute({ sql: 'DELETE FROM inventory_adjustments WHERE item_id = ?', args: [id] });
	if (body.quantity > 0) {
		await db.execute({
			sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at)
			      VALUES (?, ?, 'purchase', ?, ?, ?)`,
			args: [id, body.quantity, body.note ?? 'Reset — opening count', userId, now],
		});
	}
	await db.execute({ sql: 'UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?', args: [body.quantity, now, id] });

	const after = await loadItemOr404(db, id);
	const { forecast } = await itemForecast(db, after, Date.now());
	return c.json({ message: 'History reset', item: shapeItem(after, forecast, false) });
});

/**
 * Clear the whole inventory: items, their history, and the rules about them.
 *
 * Requires typing RESET, because there is no undo and the whole point is to
 * discard data that cannot be recovered. Diaper sizes are deliberately kept:
 * they describe the child, not the stock.
 */
inventoryRoutes.post('/reset', zValidator('json', z.object({ confirm: z.literal('RESET') })), async (c) => {
	const db = c.get('db');
	const removed = (await db.execute({ sql: 'SELECT COUNT(*) AS n FROM inventory_items' })).rows[0] as any;
	await db.execute({ sql: 'DELETE FROM inventory_rule_recipients' });
	await db.execute({ sql: 'DELETE FROM inventory_rules' });
	await db.execute({ sql: 'DELETE FROM inventory_adjustments' });
	await db.execute({ sql: 'DELETE FROM inventory_items' });
	return c.json({ message: `Inventory reset. Removed ${Number(removed.n)} item(s) and all rules.` });
});

const ruleSchema = z.object({
	itemId: z.number().nullish(),
	category: z.string().trim().min(1).max(40).nullish(),
	signal: z.string().trim().min(1).max(40),
	comparator: z.enum(['lt', 'lte', 'gt', 'gte']).default('lte'),
	threshold: z.number(),
	repeatDays: z.number().int().min(1).max(365).nullish(),
	enabled: z.boolean().default(true),
	audienceKind: z.enum(['family', 'users']).default('family'),
	audienceIds: z.array(z.string().max(64)).max(50).default([]),
});

const ruleUpdateSchema = ruleSchema.partial();

async function householdIdFor(db: any, userId: string): Promise<number | null> {
	const res = await db.execute({ sql: 'SELECT household_id FROM user_households WHERE user_id = ?', args: [userId] });
	return res.rows[0] ? Number((res.rows[0] as any).household_id) : null;
}

inventoryRoutes.get('/rules', async (c) => {
	const db = c.get('db');
	const rules = await loadRulesForFamily(db);
	return c.json({ rules });
});

// Any family member can write a rule: it is a household preference about when
// to be told something, not an administrative change.
inventoryRoutes.post('/rules', zValidator('json', ruleSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const familyId = await householdIdFor(db, userId);
	if (familyId === null) return c.json({ error: 'Not a member of any family' }, 403);

	const body = c.req.valid('json');
	if (!signalByName(body.signal)) {
		return c.json({ error: `Unknown signal "${body.signal}"` }, 400);
	}
	// A narrowed audience with nobody picked is almost always a caregiver who
	// forgot to tick anyone, so it is refused rather than silently telling no one.
	if (body.audienceKind === 'users' && body.audienceIds.length === 0) {
		return c.json({ error: 'Choose at least one caregiver, or set the audience back to the whole family' }, 400);
	}
	const result = await db.execute({
		sql: `INSERT INTO inventory_rules
		      (family_id, item_id, category, signal, comparator, threshold, repeat_days, enabled,
		       created_by, created_at, audience_kind, audience_ids)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			familyId, body.itemId ?? null, body.category ?? null, body.signal, body.comparator,
			body.threshold, body.repeatDays ?? null, body.enabled ? 1 : 0, userId, new Date().toISOString(),
			body.audienceKind,
			// Stored only when narrowed, so a family-wide rule carries no JSON at all.
			body.audienceKind === 'users' ? JSON.stringify(body.audienceIds) : null,
		],
	});
	const rules = await loadRulesForFamily(db);
	return c.json({ message: 'Rule created', rule: rules.find((r) => r.id === Number(result.lastInsertRowid)) }, 201);
});

inventoryRoutes.put('/rules/:id{[0-9]+}', zValidator('json', ruleUpdateSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number(c.req.param('id'));
	const body = c.req.valid('json');
	if (body.signal && !signalByName(body.signal)) {
		return c.json({ error: `Unknown signal "${body.signal}"` }, 400);
	}

	const updates: string[] = [];
	const params: unknown[] = [];
	const push = (col: string, val: unknown) => { updates.push(`${col} = ?`); params.push(val); };
	if (body.itemId !== undefined) push('item_id', body.itemId);
	if (body.category !== undefined) push('category', body.category);
	if (body.signal !== undefined) push('signal', body.signal);
	if (body.comparator !== undefined) push('comparator', body.comparator);
	if (body.threshold !== undefined) push('threshold', body.threshold);
	if (body.repeatDays !== undefined) push('repeat_days', body.repeatDays);
	if (body.enabled !== undefined) push('enabled', body.enabled ? 1 : 0);
	// Both columns are written together: widening to the family has to clear the
	// stored id list, or a later narrowing would resurrect it.
	if (body.audienceKind !== undefined || body.audienceIds !== undefined) {
		const current = (await loadRulesForFamily(db)).find((r) => r.id === id);
		if (!current) return c.json({ error: 'Rule not found' }, 404);
		const kind = body.audienceKind ?? current.audienceKind;
		const ids = body.audienceIds ?? (kind === 'users' ? current.audienceIds : []);
		if (kind === 'users' && ids.length === 0) {
			return c.json({ error: 'Choose at least one caregiver, or set the audience back to the whole family' }, 400);
		}
		push('audience_kind', kind);
		push('audience_ids', kind === 'users' ? JSON.stringify(ids) : null);
	}
	if (updates.length === 0) return c.json({ message: 'No updates provided' });
	params.push(id);

	const res = await db.execute({ sql: `UPDATE inventory_rules SET ${updates.join(', ')} WHERE id = ?`, args: params });
	if (!res.rowsAffected) return c.json({ error: 'Rule not found' }, 404);
	const rules = await loadRulesForFamily(db);
	return c.json({ message: 'Rule updated', rule: rules.find((r) => r.id === id) });
});

inventoryRoutes.delete('/rules/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const res = await db.execute({ sql: 'DELETE FROM inventory_rules WHERE id = ?', args: [Number(c.req.param('id'))] });
	if (!res.rowsAffected) return c.json({ error: 'Rule not found' }, 404);
	return c.json({ message: 'Rule deleted' });
});

// POST /consume — called by the diaper log so a change decrements stock.
// Idempotent per logged event, so a client retry cannot double-count.
inventoryRoutes.post('/consume', zValidator('json', z.object({
	memberId: z.number(),
	refTable: z.string().max(40),
	refId: z.number(),
})), async (c) => {
	const db = c.get('db');
	const body = c.req.valid('json');
	const scope = await resolveTrackableMember(db, c.get('userId'), body.memberId);
	if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

	const linked = (await db.execute({
		sql: `SELECT * FROM inventory_items
		      WHERE active = 1 AND event_category = ? AND subject_id = ?`,
		args: [body.refTable, scope.subjectId],
	})).rows as any[];

	const applied: string[] = [];
	for (const item of linked) {
		const per = item.decrement_per_event === null || item.decrement_per_event === undefined ? 1 : Number(item.decrement_per_event);
		try {
			await db.execute({
				sql: `INSERT INTO inventory_adjustments (item_id, change, reason, ref_table, ref_id, source) VALUES (?, ?, 'used', ?, ?, 'event')`,
				args: [item.id, -per, body.refTable, body.refId],
			});
		} catch {
			// The unique index on (ref_table, ref_id) means this event was
			// already applied. Counting it twice would understate stock.
			continue;
		}
		const now = new Date().toISOString();
		await db.execute({
			sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?',
			args: [per, now, item.id],
		});
		applied.push(item.name);
	}
	return c.json({ applied });
});

export default inventoryRoutes;