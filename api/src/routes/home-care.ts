// routes/home-care.ts
//
// The care loop behind the home asset registry: meters (#66), schedules
// (#67), and the maintenance log (#68).
//
// Mounted at the same `/api/v1/home-assets` prefix as the registry router and
// registered BEFORE it, so `GET /due` is matched before the registry's
// `GET /:id`. Everything here is family-scoped through `household_id`, and an
// id from another family is a 404 — never a 403 that would confirm it exists.
//
// The read surface is deliberately one aggregate (`GET /:id/care`) plus the
// cross-asset `GET /due`. That is also the surface a future MCP server needs
// (PRD §13): "what maintenance is due on the car" is this endpoint, not a new
// one.
import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import {
	assetFor, householdIdFor, shapeAsset, type AssetRow,
} from '../home-assets';
import {
	METER_KINDS, shapeMeter, todayIn, validateMeterUnit,
	type Meter, type MeterReading, type MeterReadingRow, type MeterRow,
} from '../meters';
import {
	evaluateSchedule, parseScheduleConditions, parseScheduleMatch, statusLine,
	validateScheduleConditions, type MeterLookup, type ScheduleCondition, type ScheduleStatus,
} from '../schedules';
import { costRollup, shapeEntry, type ConsumedItem, type MaintenanceEntry, type MaintenanceEntryRow } from '../maintenance';
import { datePart } from '../dates';
import { DEFAULT_TIMEZONE, effectiveTimezone } from '../timezone';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { EncryptedBlobStore } from '../blob-store';
import { shapeAttachment } from './attachments';

const careRoutes = new Hono<AuthEnv>();

let blobStoreInstance: EncryptedBlobStore | null = null;
function blobStore(): EncryptedBlobStore {
	if (!blobStoreInstance) blobStoreInstance = EncryptedBlobStore.fromEnv();
	return blobStoreInstance;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Schedule {
	id: number;
	assetId: number;
	task: string;
	conditions: ScheduleCondition[];
	match: 'any' | 'all';
	leadDays: number;
	archivedAt: string | null;
	createdAt: string | null;
	/** Evaluated at read time; never stored, so it cannot drift. */
	status: ScheduleStatus;
}

interface ScheduleRow {
	id: number;
	household_id: number;
	asset_id: number;
	task: string;
	conditions: string;
	match_mode: string;
	lead_days: number;
	archived_at: string | null;
	created_at: string | null;
	updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

async function familyContext(c: any): Promise<{ db: any; householdId: number } | null> {
	const db = c.get('db');
	const householdId = await householdIdFor(db, c.get('userId'));
	return householdId === null ? null : { db, householdId };
}

/**
 * Today, in the clock that applies to this asset.
 *
 * A home may carry its own timezone (the cabin is in another province); an
 * unset home inherits the family's, which is the same rule the homes registry
 * documents. A due date is a wall-clock question, not a UTC one.
 */
async function todayForAsset(db: any, asset: Pick<AssetRow, 'home_id'> | null): Promise<string> {
	let stored: unknown = null;
	if (asset?.home_id != null) {
		const res = await db.execute({ sql: 'SELECT timezone FROM homes WHERE id = ? LIMIT 1', args: [asset.home_id] });
		stored = (res.rows[0] as any)?.timezone ?? null;
	}
	if (!stored) {
		const res = await db.execute({ sql: 'SELECT timezone FROM family_settings WHERE family_id = ? LIMIT 1', args: [NAMESPACE_HOUSEHOLD_ID] });
		stored = (res.rows[0] as any)?.timezone ?? null;
	}
	return todayIn(effectiveTimezone(stored) || DEFAULT_TIMEZONE);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadMeters(db: any, assetId: number, today: string): Promise<Meter[]> {
	const meters = (await db.execute({
		sql: 'SELECT * FROM asset_meters WHERE asset_id = ? ORDER BY id',
		args: [assetId],
	})).rows as unknown as MeterRow[];
	if (!meters.length) return [];
	const readings = (await db.execute({
		sql: `SELECT * FROM asset_meter_readings
		      WHERE meter_id IN (${meters.map(() => '?').join(', ')})
		      ORDER BY recorded_at DESC, id DESC`,
		args: meters.map((m) => m.id),
	})).rows as unknown as MeterReadingRow[];
	const byMeter = new Map<number, MeterReading[]>();
	for (const row of readings) {
		const list = byMeter.get(Number(row.meter_id)) ?? [];
		list.push({
			id: Number(row.id),
			value: Number(row.value),
			recordedAt: datePart(String(row.recorded_at)),
			source: String(row.source ?? 'manual'),
			maintenanceEntryId:
				row.maintenance_entry_id === null || row.maintenance_entry_id === undefined
					? null
					: Number(row.maintenance_entry_id),
		});
		byMeter.set(Number(row.meter_id), list);
	}
	return meters.map((row) => shapeMeter(row, byMeter.get(Number(row.id)) ?? [], today));
}

function meterLookup(meters: Meter[]): Map<number, MeterLookup> {
	return new Map(
		meters.map((meter) => [
			meter.id,
			{ kind: meter.kind, unit: meter.unit, label: meter.label, readings: meter.readings },
		]),
	);
}

interface ScheduleContext {
	/** performed_at dates keyed by schedule id. */
	entries: Map<number, string[]>;
	/** window_start → reason, keyed by schedule id. */
	skips: Map<number, Map<string, string | null>>;
}

async function scheduleContext(db: any, scheduleIds: number[]): Promise<ScheduleContext> {
	const entries = new Map<number, string[]>();
	const skips = new Map<number, Map<string, string | null>>();
	if (!scheduleIds.length) return { entries, skips };
	const placeholders = scheduleIds.map(() => '?').join(', ');
	const entryRows = (await db.execute({
		sql: `SELECT schedule_id, performed_at FROM maintenance_entries
		      WHERE schedule_id IN (${placeholders}) ORDER BY performed_at`,
		args: scheduleIds,
	})).rows as any[];
	for (const row of entryRows) {
		const id = Number(row.schedule_id);
		const list = entries.get(id) ?? [];
		list.push(datePart(String(row.performed_at)));
		entries.set(id, list);
	}
	const skipRows = (await db.execute({
		sql: `SELECT schedule_id, window_start, reason FROM asset_schedule_skips
		      WHERE schedule_id IN (${placeholders})`,
		args: scheduleIds,
	})).rows as any[];
	for (const row of skipRows) {
		const id = Number(row.schedule_id);
		const map = skips.get(id) ?? new Map<string, string | null>();
		map.set(datePart(String(row.window_start)), row.reason ?? null);
		skips.set(id, map);
	}
	return { entries, skips };
}

function shapeSchedule(row: ScheduleRow, today: string, meters: Map<number, MeterLookup>, context: ScheduleContext): Schedule {
	const conditions = parseScheduleConditions(row.conditions);
	const match = parseScheduleMatch(row.match_mode);
	const entries = context.entries.get(Number(row.id)) ?? [];
	const skips = context.skips.get(Number(row.id)) ?? new Map<string, string | null>();
	const status = evaluateSchedule({
		conditions,
		match,
		leadDays: Number(row.lead_days ?? 14),
		today,
		since: datePart(String(row.created_at ?? today)),
		entries,
		skips,
		meters,
	});
	return {
		id: Number(row.id),
		assetId: Number(row.asset_id),
		task: String(row.task),
		conditions,
		match,
		leadDays: Number(row.lead_days ?? 14),
		archivedAt: row.archived_at ?? null,
		createdAt: row.created_at ?? null,
		status,
	};
}

async function loadSchedules(db: any, assetId: number, today: string, meters: Meter[]): Promise<Schedule[]> {
	const rows = (await db.execute({
		sql: `SELECT * FROM asset_schedules WHERE asset_id = ?
		      ORDER BY archived_at IS NOT NULL, task COLLATE NOCASE, id`,
		args: [assetId],
	})).rows as unknown as ScheduleRow[];
	if (!rows.length) return [];
	const context = await scheduleContext(db, rows.map((row) => Number(row.id)));
	const lookup = meterLookup(meters);
	return rows.map((row) => shapeSchedule(row, today, lookup, context));
}

async function loadSchedule(db: any, scheduleId: number, householdId: number): Promise<Schedule | null> {
	const row = (await db.execute({
		sql: 'SELECT * FROM asset_schedules WHERE id = ? AND household_id = ? LIMIT 1',
		args: [scheduleId, householdId],
	})).rows[0] as ScheduleRow | undefined;
	if (!row) return null;
	const asset = await assetFor(db, Number(row.asset_id), householdId);
	const today = await todayForAsset(db, asset);
	const meters = await loadMeters(db, Number(row.asset_id), today);
	const context = await scheduleContext(db, [scheduleId]);
	return shapeSchedule(row, today, meterLookup(meters), context);
}

async function loadEntries(db: any, assetId: number): Promise<MaintenanceEntry[]> {
	const rows = (await db.execute({
		// Every entry, because the cost rollup is a total and a capped list
		// would make it quietly wrong. A family's maintenance history is
		// small by nature; rendering it all is the honest choice.
		sql: `SELECT * FROM maintenance_entries WHERE asset_id = ?
		      ORDER BY performed_at DESC, id DESC`,
		args: [assetId],
	})).rows as unknown as MaintenanceEntryRow[];
	if (!rows.length) return [];
	const consumed = (await db.execute({
		sql: `SELECT ci.entry_id, ci.item_id, ci.quantity, i.name, i.unit
		      FROM maintenance_consumed_items ci
		      LEFT JOIN inventory_items i ON i.id = ci.item_id
		      WHERE ci.entry_id IN (${rows.map(() => '?').join(', ')})`,
		args: rows.map((row) => row.id),
	})).rows as any[];
	const byEntry = new Map<number, ConsumedItem[]>();
	for (const row of consumed) {
		const list = byEntry.get(Number(row.entry_id)) ?? [];
		list.push({
			itemId: Number(row.item_id),
			quantity: Number(row.quantity),
			name: row.name ?? undefined,
			unit: row.unit ?? undefined,
		});
		byEntry.set(Number(row.entry_id), list);
	}
	return rows.map((row) => shapeEntry(row, byEntry.get(Number(row.id)) ?? []));
}

/**
 * Every file hanging off one asset: its own (photos, manuals) and the ones on
 * its maintenance entries (receipts, before/after shots).
 *
 * One query for the whole page — the alternative is a request per history row,
 * which turns a car with thirty oil changes into thirty round trips.
 */
async function loadAttachments(db: any, assetId: number) {
	const rows = (await db.execute({
		sql: `SELECT id, subject_id, ref_type, ref_id, filename, content_type, size, created_at, created_by
		      FROM attachments
		      WHERE (ref_type = 'asset' AND ref_id = ?)
		         OR (ref_type = 'maintenance' AND ref_id IN (SELECT id FROM maintenance_entries WHERE asset_id = ?))
		      ORDER BY created_at DESC`,
		args: [assetId, assetId],
	})).rows;
	return rows.map(shapeAttachment);
}

/** Drop attachment rows and their encrypted bytes together. */
async function deleteAttachmentRows(db: any, familyId: string, ids: readonly number[]): Promise<void> {
	for (const id of ids) {
		const row = (await db.execute({
			sql: 'SELECT blob_id, created_at FROM attachments WHERE id = ? LIMIT 1',
			args: [id],
		})).rows[0] as any;
		if (!row) continue;
		await blobStore().remove(familyId, String(row.blob_id), new Date(String(row.created_at))).catch(() => {});
		await db.execute({ sql: 'DELETE FROM attachments WHERE id = ?', args: [id] });
	}
}

// ---------------------------------------------------------------------------
// The asset's own photo
// ---------------------------------------------------------------------------

/**
 * The cover photo, the same shape homes.picture and family_members.avatar use:
 * one attachment row, bytes in the encrypted blob store, a marker column on
 * the asset. Replacing deletes the old photo rather than accumulating them.
 */
careRoutes.post('/:id{[0-9]+}/picture', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);

	const form = await c.req.formData();
	const file = form.get('file');
	if (!file || typeof file === 'string') return c.json({ error: 'Missing image file' }, 400);
	const mime = file.type || 'application/octet-stream';
	if (!mime.startsWith('image/')) return c.json({ error: 'Only image uploads are allowed' }, 400);

	let attachmentId: number;
	try {
		const put = await blobStore().put(c.get('familyId'), Readable.fromWeb(file.stream() as any));
		const ins = await ctx.db.execute({
			sql: `INSERT INTO attachments (subject_id, ref_type, ref_id, blob_id, storage_key, filename, content_type, size, created_at, created_by)
			      VALUES (NULL, 'asset', ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				asset.id, put.blobId, put.storageKey, file.name || null, mime, put.size,
				new Date().toISOString(), c.get('userId'),
			],
		});
		attachmentId = Number((ins as any).lastInsertRowid);
	} catch {
		return c.json({ error: 'Could not store that image' }, 500);
	}

	if (asset.picture && /^[0-9]+$/.test(String(asset.picture))) {
		await deleteAttachmentRows(ctx.db, c.get('familyId'), [Number(asset.picture)]);
	}
	await ctx.db.execute({
		sql: 'UPDATE home_assets SET picture = ?, updated_at = ? WHERE id = ?',
		args: [String(attachmentId), new Date().toISOString(), asset.id],
	});
	return c.json({ picture: attachmentId });
});

careRoutes.get('/:id{[0-9]+}/picture', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	const marker = asset.picture && /^[0-9]+$/.test(String(asset.picture)) ? Number(asset.picture) : null;
	if (!marker) return c.json({ error: 'No picture' }, 404);

	const att = (await ctx.db.execute({
		sql: 'SELECT blob_id, content_type, created_at FROM attachments WHERE id = ? LIMIT 1',
		args: [marker],
	})).rows[0] as any;
	if (!att) return c.json({ error: 'No picture' }, 404);
	try {
		const stream = await blobStore().open(c.get('familyId'), String(att.blob_id), new Date(String(att.created_at)));
		return new Response(Readable.toWeb(stream) as any, {
			status: 200,
			headers: { 'Content-Type': String(att.content_type), 'Cache-Control': 'private, max-age=31536000' },
		});
	} catch {
		return c.json({ error: 'Picture file missing' }, 404);
	}
});

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

const createMeterSchema = z.object({
	kind: z.enum(METER_KINDS),
	unit: z.string().trim().min(1).max(20),
	label: z.string().trim().max(80).nullable().optional(),
});

careRoutes.get('/:id{[0-9]+}/meters', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	const today = await todayForAsset(ctx.db, asset);
	return c.json({ meters: await loadMeters(ctx.db, Number(asset.id), today) });
});

careRoutes.post('/:id{[0-9]+}/meters', zValidator('json', createMeterSchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);

	const body = c.req.valid('json');
	const unitError = validateMeterUnit(body.kind, body.unit);
	if (unitError) return c.json({ error: unitError }, 400);
	// One meter per kind per asset is the useful default; a second odometer
	// would make every trigger ambiguous about which one it means.
	const existing = await ctx.db.execute({
		sql: 'SELECT 1 FROM asset_meters WHERE asset_id = ? AND kind = ? LIMIT 1',
		args: [asset.id, body.kind],
	});
	if (existing.rows.length) {
		return c.json({ error: `This asset already has a ${body.kind} meter.` }, 400);
	}

	const inserted = await ctx.db.execute({
		sql: 'INSERT INTO asset_meters (household_id, asset_id, kind, unit, label) VALUES (?, ?, ?, ?, ?)',
		args: [ctx.householdId, asset.id, body.kind, body.unit.trim(), body.label ?? null],
	});
	const row = (await ctx.db.execute({
		sql: 'SELECT * FROM asset_meters WHERE id = ?',
		args: [Number((inserted as any).lastInsertRowid)],
	})).rows[0] as MeterRow;
	const today = await todayForAsset(ctx.db, asset);
	return c.json({ meter: shapeMeter(row, [], today) }, 201);
});

const readingSchema = z.object({
	value: z.number().finite().min(0).max(1_000_000_000),
	recordedAt: z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)').optional(),
});

careRoutes.post('/meters/:meterId{[0-9]+}/readings', zValidator('json', readingSchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const meter = (await ctx.db.execute({
		sql: 'SELECT * FROM asset_meters WHERE id = ? AND household_id = ? LIMIT 1',
		args: [Number(c.req.param('meterId')), ctx.householdId],
	})).rows[0] as MeterRow | undefined;
	if (!meter) return c.json({ error: 'Meter not found' }, 404);
	const asset = await assetFor(ctx.db, Number(meter.asset_id), ctx.householdId);
	const today = await todayForAsset(ctx.db, asset);
	const body = c.req.valid('json');
	const recordedAt = body.recordedAt ?? today;

	await ctx.db.execute({
		sql: `INSERT INTO asset_meter_readings
		      (household_id, meter_id, value, recorded_at, source, created_by)
		      VALUES (?, ?, ?, ?, 'manual', ?)`,
		args: [ctx.householdId, meter.id, body.value, recordedAt, c.get('userId')],
	});
	const meters = await loadMeters(ctx.db, Number(meter.asset_id), today);
	return c.json({ meter: meters.find((m) => m.id === Number(meter.id)) ?? null }, 201);
});

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

const conditionSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('interval'),
		every: z.number().int().positive().max(3650),
		unit: z.enum(['days', 'months']),
	}),
	z.object({
		kind: z.literal('meter'),
		meterId: z.number().int().positive(),
		every: z.number().positive().max(1_000_000),
	}),
	z.object({
		kind: z.literal('seasonal'),
		start: z.string().regex(MONTH_DAY, 'Use MM-DD'),
		end: z.string().regex(MONTH_DAY, 'Use MM-DD'),
	}),
]);

const createScheduleSchema = z.object({
	task: z.string().trim().min(1).max(200),
	conditions: z.array(conditionSchema).min(1).max(10),
	match: z.enum(['any', 'all']).optional(),
	leadDays: z.number().int().min(0).max(365).optional(),
});

const updateScheduleSchema = createScheduleSchema.partial();

async function assetMeterIds(db: any, assetId: number): Promise<Set<number>> {
	const rows = (await db.execute({
		sql: 'SELECT id FROM asset_meters WHERE asset_id = ?',
		args: [assetId],
	})).rows as any[];
	return new Set(rows.map((row) => Number(row.id)));
}

careRoutes.get('/:id{[0-9]+}/schedules', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	const today = await todayForAsset(ctx.db, asset);
	const meters = await loadMeters(ctx.db, Number(asset.id), today);
	return c.json({ schedules: await loadSchedules(ctx.db, Number(asset.id), today, meters) });
});

careRoutes.post('/:id{[0-9]+}/schedules', zValidator('json', createScheduleSchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);

	const body = c.req.valid('json');
	const conditions = body.conditions as ScheduleCondition[];
	const error = validateScheduleConditions(conditions, await assetMeterIds(ctx.db, Number(asset.id)));
	if (error) return c.json({ error }, 400);

	const inserted = await ctx.db.execute({
		sql: `INSERT INTO asset_schedules (household_id, asset_id, task, conditions, match_mode, lead_days, created_by)
		      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		args: [
			ctx.householdId, asset.id, body.task, JSON.stringify(conditions),
			body.match ?? 'any', body.leadDays ?? 14, c.get('userId'),
		],
	});
	const schedule = await loadSchedule(ctx.db, Number((inserted as any).lastInsertRowid), ctx.householdId);
	return c.json({ schedule }, 201);
});

careRoutes.put('/schedules/:scheduleId{[0-9]+}', zValidator('json', updateScheduleSchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('scheduleId'));
	const previous = (await ctx.db.execute({
		sql: 'SELECT * FROM asset_schedules WHERE id = ? AND household_id = ? LIMIT 1',
		args: [id, ctx.householdId],
	})).rows[0] as ScheduleRow | undefined;
	if (!previous) return c.json({ error: 'Schedule not found' }, 404);

	const body = c.req.valid('json');
	const conditions = body.conditions
		? (body.conditions as ScheduleCondition[])
		: parseScheduleConditions(previous.conditions);
	const error = validateScheduleConditions(conditions, await assetMeterIds(ctx.db, Number(previous.asset_id)));
	if (error) return c.json({ error }, 400);

	await ctx.db.execute({
		sql: `UPDATE asset_schedules SET task = ?, conditions = ?, match_mode = ?, lead_days = ?, updated_at = ?
		      WHERE id = ? AND household_id = ?`,
		args: [
			body.task ?? previous.task,
			JSON.stringify(conditions),
			body.match ?? parseScheduleMatch(previous.match_mode),
			body.leadDays ?? Number(previous.lead_days ?? 14),
			new Date().toISOString(), id, ctx.householdId,
		],
	});
	return c.json({ schedule: await loadSchedule(ctx.db, id, ctx.householdId) });
});

async function setScheduleArchived(db: any, id: number, householdId: number, archivedAt: string | null): Promise<boolean> {
	const result = await db.execute({
		sql: 'UPDATE asset_schedules SET archived_at = ?, updated_at = ? WHERE id = ? AND household_id = ?',
		args: [archivedAt, new Date().toISOString(), id, householdId],
	});
	return Number((result as any).rowsAffected ?? 0) > 0;
}

careRoutes.post('/schedules/:scheduleId{[0-9]+}/archive', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('scheduleId'));
	const ok = await setScheduleArchived(ctx.db, id, ctx.householdId, new Date().toISOString());
	if (!ok) return c.json({ error: 'Schedule not found' }, 404);
	return c.json({ schedule: await loadSchedule(ctx.db, id, ctx.householdId) });
});

careRoutes.post('/schedules/:scheduleId{[0-9]+}/unarchive', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('scheduleId'));
	const ok = await setScheduleArchived(ctx.db, id, ctx.householdId, null);
	if (!ok) return c.json({ error: 'Schedule not found' }, 404);
	return c.json({ schedule: await loadSchedule(ctx.db, id, ctx.householdId) });
});

const skipSchema = z.object({
	windowStart: z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)'),
	reason: z.string().trim().max(300).nullable().optional(),
});

/**
 * "Not this season" — an explicit, recorded excuse for one window.
 *
 * It satisfies the checklist instance without pretending work happened: the
 * card shows the skip and the reason, and the maintenance history stays the
 * only place work is claimed.
 */
careRoutes.post('/schedules/:scheduleId{[0-9]+}/skip', zValidator('json', skipSchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('scheduleId'));
	const schedule = await loadSchedule(ctx.db, id, ctx.householdId);
	if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
	if (!schedule.conditions.some((condition) => condition.kind === 'seasonal')) {
		return c.json({ error: 'Only a seasonal schedule can be skipped for a season.' }, 400);
	}
	const body = c.req.valid('json');
	await ctx.db.execute({
		sql: `INSERT INTO asset_schedule_skips (household_id, schedule_id, window_start, reason, created_by)
		      VALUES (?, ?, ?, ?, ?)
		      ON CONFLICT(schedule_id, window_start) DO UPDATE SET reason = excluded.reason`,
		args: [ctx.householdId, id, body.windowStart, body.reason ?? null, c.get('userId')],
	});
	return c.json({ schedule: await loadSchedule(ctx.db, id, ctx.householdId) });
});

careRoutes.delete('/schedules/:scheduleId{[0-9]+}/skip', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('scheduleId'));
	const windowStart = c.req.query('windowStart');
	if (!windowStart || !DATE_ONLY.test(windowStart)) return c.json({ error: 'windowStart is required' }, 400);
	await ctx.db.execute({
		sql: 'DELETE FROM asset_schedule_skips WHERE schedule_id = ? AND household_id = ? AND window_start = ?',
		args: [id, ctx.householdId, windowStart],
	});
	return c.json({ schedule: await loadSchedule(ctx.db, id, ctx.householdId) });
});

// ---------------------------------------------------------------------------
// Maintenance log
// ---------------------------------------------------------------------------

const createEntrySchema = z.object({
	scheduleId: z.number().int().positive().nullable().optional(),
	task: z.string().trim().min(1).max(200),
	performedAt: z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)'),
	cost: z.number().int().min(0).max(100_000_000).nullable().optional(),   // cents
	notes: z.string().max(4000).nullable().optional(),
	meterReadings: z.array(z.object({
		meterId: z.number().int().positive(),
		value: z.number().finite().min(0).max(1_000_000_000),
	})).max(10).optional(),
	consumedItems: z.array(z.object({
		itemId: z.number().int().positive(),
		quantity: z.number().positive().max(100_000),
	})).max(20).optional(),
});

const updateEntrySchema = z.object({
	scheduleId: z.number().int().positive().nullable().optional(),
	task: z.string().trim().min(1).max(200).optional(),
	performedAt: z.string().regex(DATE_ONLY).optional(),
	cost: z.number().int().min(0).max(100_000_000).nullable().optional(),
	notes: z.string().max(4000).nullable().optional(),
});

/** Aggregate repeated item ids so one entry writes one ledger row per item. */
function aggregateItems(items: Array<{ itemId: number; quantity: number }>): Map<number, number> {
	const out = new Map<number, number>();
	for (const item of items) out.set(item.itemId, (out.get(item.itemId) ?? 0) + item.quantity);
	return out;
}

interface StockLine {
	itemId: number;
	quantity: number;
	name: string;
	unit: string;
	available: number;
}

/**
 * Validate every stock line before writing anything.
 *
 * A half-applied entry (the log saved, the filter not deducted) is worse than
 * a refusal: it makes the inventory quietly wrong in a way nobody looks for.
 */
async function stockLines(db: any, items: Array<{ itemId: number; quantity: number }>): Promise<{ lines: StockLine[]; error?: string }> {
	const aggregated = aggregateItems(items);
	const lines: StockLine[] = [];
	for (const [itemId, quantity] of aggregated) {
		const row = (await db.execute({
			sql: 'SELECT id, name, unit, quantity FROM inventory_items WHERE id = ? AND active = 1 LIMIT 1',
			args: [itemId],
		})).rows[0] as any;
		if (!row) return { lines: [], error: 'One of the items is not in inventory any more.' };
		const available = Number(row.quantity);
		if (quantity > available) {
			return {
				lines: [],
				error: `Not enough ${row.name}: ${available} ${row.unit ?? 'left'}, ${quantity} used.`,
			};
		}
		lines.push({ itemId, quantity, name: String(row.name), unit: String(row.unit ?? 'count'), available });
	}
	return { lines };
}

/** Write one consumed line through the same ledger the adjust route uses. */
async function consumeLine(db: any, entryId: number, householdId: number, line: StockLine, userId: string, now: string) {
	await db.execute({
		sql: `INSERT INTO inventory_adjustments (item_id, change, reason, ref_table, ref_id, note, created_by, created_at)
		      VALUES (?, ?, 'used', 'maintenance_entry', ?, ?, ?, ?)`,
		args: [
			line.itemId, -line.quantity, entryId,
			`Maintenance: ${line.name}`, userId, now,
		],
	});
	await db.execute({
		sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?',
		args: [line.quantity, now, line.itemId],
	});
	await db.execute({
		sql: 'INSERT INTO maintenance_consumed_items (household_id, entry_id, item_id, quantity) VALUES (?, ?, ?, ?)',
		args: [householdId, entryId, line.itemId, line.quantity],
	});
}

async function entryFor(db: any, id: number, householdId: number): Promise<MaintenanceEntry | null> {
	const row = (await db.execute({
		sql: 'SELECT * FROM maintenance_entries WHERE id = ? AND household_id = ? LIMIT 1',
		args: [id, householdId],
	})).rows[0] as MaintenanceEntryRow | undefined;
	if (!row) return null;
	const consumed = (await db.execute({
		sql: `SELECT ci.item_id, ci.quantity, i.name, i.unit
		      FROM maintenance_consumed_items ci LEFT JOIN inventory_items i ON i.id = ci.item_id
		      WHERE ci.entry_id = ?`,
		args: [id],
	})).rows as any[];
	return shapeEntry(row, consumed.map((item) => ({
		itemId: Number(item.item_id),
		quantity: Number(item.quantity),
		name: item.name ?? undefined,
		unit: item.unit ?? undefined,
	})));
}

careRoutes.get('/:id{[0-9]+}/maintenance', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	const entries = await loadEntries(ctx.db, Number(asset.id));
	return c.json({ entries, rollup: costRollup(entries) });
});

careRoutes.post('/:id{[0-9]+}/maintenance', zValidator('json', createEntrySchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);

	const body = c.req.valid('json');
	// A schedule from another asset would make "what's due" lie, so it is a
	// validation error rather than a silent unlink.
	if (body.scheduleId != null) {
		const schedule = (await ctx.db.execute({
			sql: 'SELECT 1 FROM asset_schedules WHERE id = ? AND asset_id = ? AND household_id = ? LIMIT 1',
			args: [body.scheduleId, asset.id, ctx.householdId],
		})).rows[0];
		if (!schedule) return c.json({ error: 'Schedule not found on this asset' }, 404);
	}
	const meterIds = await assetMeterIds(ctx.db, Number(asset.id));
	for (const reading of body.meterReadings ?? []) {
		if (!meterIds.has(reading.meterId)) return c.json({ error: 'Meter not found on this asset' }, 404);
	}
	const stock = await stockLines(ctx.db, body.consumedItems ?? []);
	if (stock.error) return c.json({ error: stock.error }, 400);

	const now = new Date().toISOString();
	const inserted = await ctx.db.execute({
		sql: `INSERT INTO maintenance_entries
		      (household_id, asset_id, schedule_id, task, performed_at, cost, notes, created_by)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			ctx.householdId, asset.id, body.scheduleId ?? null, body.task, body.performedAt,
			body.cost ?? null, body.notes ?? null, c.get('userId'),
		],
	});
	const entryId = Number((inserted as any).lastInsertRowid);

	// The odometer read at the oil change is part of the same story: one form,
	// one save, and the meter is current without a second visit to the app.
	for (const reading of body.meterReadings ?? []) {
		await ctx.db.execute({
			sql: `INSERT INTO asset_meter_readings
			      (household_id, meter_id, value, recorded_at, source, maintenance_entry_id, created_by)
			      VALUES (?, ?, ?, ?, 'maintenance', ?, ?)`,
			args: [ctx.householdId, reading.meterId, reading.value, body.performedAt, entryId, c.get('userId')],
		});
	}
	for (const line of stock.lines) {
		await consumeLine(ctx.db, entryId, ctx.householdId, line, c.get('userId'), now);
	}

	return c.json({ entry: await entryFor(ctx.db, entryId, ctx.householdId) }, 201);
});

careRoutes.put('/maintenance/:entryId{[0-9]+}', zValidator('json', updateEntrySchema), async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('entryId'));
	const previous = (await ctx.db.execute({
		sql: 'SELECT * FROM maintenance_entries WHERE id = ? AND household_id = ? LIMIT 1',
		args: [id, ctx.householdId],
	})).rows[0] as MaintenanceEntryRow | undefined;
	if (!previous) return c.json({ error: 'Entry not found' }, 404);

	const body = c.req.valid('json');
	if (body.scheduleId != null) {
		const schedule = (await ctx.db.execute({
			sql: 'SELECT 1 FROM asset_schedules WHERE id = ? AND asset_id = ? AND household_id = ? LIMIT 1',
			args: [body.scheduleId, previous.asset_id, ctx.householdId],
		})).rows[0];
		if (!schedule) return c.json({ error: 'Schedule not found on this asset' }, 404);
	}

	await ctx.db.execute({
		sql: `UPDATE maintenance_entries SET
		        schedule_id = ?, task = ?, performed_at = ?, cost = ?, notes = ?, updated_at = ?
		      WHERE id = ? AND household_id = ?`,
		args: [
			body.scheduleId === undefined ? previous.schedule_id : (body.scheduleId ?? null),
			body.task ?? previous.task,
			body.performedAt ?? previous.performed_at,
			body.cost === undefined ? previous.cost : (body.cost ?? null),
			body.notes === undefined ? previous.notes : (body.notes ?? null),
			new Date().toISOString(), id, ctx.householdId,
		],
	});
	return c.json({ entry: await entryFor(ctx.db, id, ctx.householdId) });
});

/**
 * Deleting a mistake puts the stock back.
 *
 * The ledger is append-only, so the reversal is a compensating adjustment —
 * never a deleted row — and the entry's own consumed lines go with it.
 */
careRoutes.delete('/maintenance/:entryId{[0-9]+}', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const id = Number(c.req.param('entryId'));
	const entry = (await ctx.db.execute({
		sql: 'SELECT * FROM maintenance_entries WHERE id = ? AND household_id = ? LIMIT 1',
		args: [id, ctx.householdId],
	})).rows[0] as MaintenanceEntryRow | undefined;
	if (!entry) return c.json({ error: 'Entry not found' }, 404);

	const now = new Date().toISOString();
	const consumed = (await ctx.db.execute({
		sql: 'SELECT item_id, quantity FROM maintenance_consumed_items WHERE entry_id = ?',
		args: [id],
	})).rows as any[];
	for (const line of consumed) {
		await ctx.db.execute({
			sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at)
			      VALUES (?, ?, 'correction', ?, ?, ?)`,
			args: [
				Number(line.item_id), Number(line.quantity),
				'Maintenance entry deleted — stock restored', c.get('userId'), now,
			],
		});
		await ctx.db.execute({
			sql: 'UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
			args: [Number(line.quantity), now, Number(line.item_id)],
		});
	}
	// Readings the entry carried are removed with it: they were part of the
	// same record, and leaving them behind would keep a meter current with
	// work that no longer exists.
	await ctx.db.execute({
		sql: 'DELETE FROM asset_meter_readings WHERE maintenance_entry_id = ?',
		args: [id],
	});
	// The receipt and the before/after photos belong to the entry: they go
	// with it, bytes and all.
	const attachmentIds = (await ctx.db.execute({
		sql: "SELECT id FROM attachments WHERE ref_type = 'maintenance' AND ref_id = ?",
		args: [id],
	})).rows.map((row: any) => Number(row.id));
	await deleteAttachmentRows(ctx.db, c.get('familyId'), attachmentIds);
	await ctx.db.execute({ sql: 'DELETE FROM maintenance_consumed_items WHERE entry_id = ?', args: [id] });
	await ctx.db.execute({
		sql: 'DELETE FROM maintenance_entries WHERE id = ? AND household_id = ?',
		args: [id, ctx.householdId],
	});
	return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// The two read surfaces
// ---------------------------------------------------------------------------

/** Everything one asset's page needs, in one round trip. */
careRoutes.get('/:id{[0-9]+}/care', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);
	const asset = await assetFor(ctx.db, Number(c.req.param('id')), ctx.householdId);
	if (!asset) return c.json({ error: 'Asset not found' }, 404);
	const today = await todayForAsset(ctx.db, asset);
	const [meters, entries] = await Promise.all([
		loadMeters(ctx.db, Number(asset.id), today),
		loadEntries(ctx.db, Number(asset.id)),
	]);
	const schedules = await loadSchedules(ctx.db, Number(asset.id), today, meters);
	return c.json({
		today,
		asset: shapeAsset(asset),
		meters,
		schedules,
		entries,
		rollup: costRollup(entries),
		attachments: await loadAttachments(ctx.db, Number(asset.id)),
	});
});

/**
 * "What's due" across every asset — the HOME dashboard surface.
 *
 * Overdue first, then due, each by how close it is. One row per schedule, with
 * the asset named so the card can link straight to it.
 */
careRoutes.get('/due', async (c) => {
	const ctx = await familyContext(c);
	if (!ctx) return c.json({ error: 'Not a member of any family' }, 403);

	const assets = (await ctx.db.execute({
		sql: `SELECT id, name, home_id FROM home_assets
		      WHERE household_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE`,
		args: [ctx.householdId],
	})).rows as any[];
	if (!assets.length) return c.json({ today: await todayForAsset(ctx.db, null), items: [] });

	const assetIds = assets.map((asset) => Number(asset.id));
	const placeholders = assetIds.map(() => '?').join(', ');
	const scheduleRows = (await ctx.db.execute({
		sql: `SELECT * FROM asset_schedules
		      WHERE household_id = ? AND archived_at IS NULL AND asset_id IN (${placeholders})
		      ORDER BY task COLLATE NOCASE`,
		args: [ctx.householdId, ...assetIds],
	})).rows as unknown as ScheduleRow[];
	if (!scheduleRows.length) return c.json({ today: await todayForAsset(ctx.db, null), items: [] });

	const meters = (await ctx.db.execute({
		sql: `SELECT * FROM asset_meters WHERE asset_id IN (${placeholders}) ORDER BY id`,
		args: assetIds,
	})).rows as unknown as MeterRow[];
	const readings = meters.length
		? ((await ctx.db.execute({
			sql: `SELECT * FROM asset_meter_readings
			      WHERE meter_id IN (${meters.map(() => '?').join(', ')})
			      ORDER BY recorded_at DESC, id DESC`,
			args: meters.map((meter) => meter.id),
		})).rows as unknown as MeterReadingRow[])
		: [];
	const readingsByMeter = new Map<number, MeterReading[]>();
	for (const row of readings) {
		const list = readingsByMeter.get(Number(row.meter_id)) ?? [];
		list.push({
			id: Number(row.id),
			value: Number(row.value),
			recordedAt: datePart(String(row.recorded_at)),
			source: String(row.source ?? 'manual'),
			maintenanceEntryId: null,
		});
		readingsByMeter.set(Number(row.meter_id), list);
	}
	const lookup = new Map<number, MeterLookup>();
	for (const meter of meters) {
		lookup.set(Number(meter.id), {
			kind: String(meter.kind),
			unit: String(meter.unit),
			label: meter.label ?? null,
			readings: readingsByMeter.get(Number(meter.id)) ?? [],
		});
	}

	const context = await scheduleContext(ctx.db, scheduleRows.map((row) => Number(row.id)));
	const assetById = new Map(assets.map((asset) => [Number(asset.id), asset]));
	// A cabin in another province has its own "today". Resolve each home once
	// rather than pretending the family's clock is the only one.
	const familyToday = await todayForAsset(ctx.db, null);
	const todayByHome = new Map<number | null, string>();
	todayByHome.set(null, familyToday);
	for (const asset of assets) {
		const homeId = asset.home_id === null || asset.home_id === undefined ? null : Number(asset.home_id);
		if (!todayByHome.has(homeId)) todayByHome.set(homeId, await todayForAsset(ctx.db, { home_id: homeId } as AssetRow));
	}

	const items = scheduleRows
		.map((row) => {
			const asset = assetById.get(Number(row.asset_id));
			const homeId = asset?.home_id === null || asset?.home_id === undefined ? null : Number(asset.home_id);
			const today = todayByHome.get(homeId) ?? familyToday;
			const schedule = shapeSchedule(row, today, lookup, context);
			return {
				scheduleId: schedule.id,
				assetId: Number(row.asset_id),
				assetName: String(asset?.name ?? 'Asset'),
				homeId,
				task: schedule.task,
				state: schedule.status.state,
				dueAt: schedule.status.dueAt,
				remainingDays: schedule.status.remainingDays,
				detail: statusLine(schedule.status),
				season: schedule.status.season,
			};
		})
		.filter((item) => item.state !== 'ok')
		.sort((a, b) => {
			if (a.state !== b.state) return a.state === 'overdue' ? -1 : 1;
			const left = a.remainingDays ?? Number.MAX_SAFE_INTEGER;
			const right = b.remainingDays ?? Number.MAX_SAFE_INTEGER;
			return left - right;
		});

	return c.json({ today: familyToday, items });
});

export default careRoutes;
