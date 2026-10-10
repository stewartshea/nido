import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import {
	evaluateReminder,
	parseConditions,
	parseMatch,
	reminderCatalog,
	validateConditions,
	type ReminderCondition,
} from '../reminder-conditions';

const reminderRoutes = new Hono<AuthEnv>();

const conditionSchema = z.object({
	category: z.string().min(1).max(40),
	values: z.array(z.string().min(1).max(60)).max(20).optional(),
});

const createReminderSchema = z.object({
	kind: z.enum(['inactivity', 'interval']),
	category: z.string().max(40).optional(),
	// A rule may watch several things at once ("no pump or feed in 3h"), and the
	// conditions combine as 'any' (either counts) or 'all' (only the whole set).
	conditions: z.array(conditionSchema).min(1).max(10).optional(),
	match: z.enum(['any', 'all']).optional(),
	targetType: z.enum(['member', 'home']).default('member'),
	targetId: z.number().optional(),
	label: z.string().max(200).optional(),
	hours: z.number().int().positive().optional(),
	intervalDays: z.number().int().positive().optional(),
});

const updateReminderSchema = z.object({
	kind: z.enum(['inactivity', 'interval']).optional(),
	category: z.string().max(40).nullable().optional(),
	conditions: z.array(conditionSchema).min(1).max(10).nullable().optional(),
	match: z.enum(['any', 'all']).optional(),
	targetType: z.enum(['member', 'home']).optional(),
	targetId: z.number().nullable().optional(),
	label: z.string().max(200).nullable().optional(),
	hours: z.number().int().positive().nullable().optional(),
	intervalDays: z.number().int().positive().nullable().optional(),
	enabled: z.boolean().optional(),
});

const getUserId = (c: any) => c.get('userId') as string;

async function familyAccess(db: any, familyId: number, userId: string): Promise<boolean> {
	const res = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, familyId],
	});
	return res.rows.length > 0;
}

function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string' || !value.trim()) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

/** A family's own option values, so a rule can watch a routine it invented. */
async function familyOptionOverrides(db: any): Promise<Record<string, Record<string, string[]>>> {
	const res = await db.execute({
		sql: 'SELECT category_options FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const raw = (res.rows[0] as { category_options?: unknown } | undefined)?.category_options;
	return parseJson<Record<string, Record<string, string[]>>>(raw, {});
}

function shape(r: any, ev: { overdue: boolean; since: number | null }) {
	const conditions: ReminderCondition[] =
		r?.kind === 'inactivity' ? parseConditions(r?.conditions, r?.category) : [];
	return {
		id: Number(r?.id),
		kind: r?.kind,
		category: r?.category,
		conditions,
		match: parseMatch(r?.match_mode),
		targetType: r?.target_type,
		targetId: r?.target_id ? Number(r.target_id) : null,
		label: r?.label,
		hours: r?.hours ? Number(r.hours) : null,
		intervalDays: r?.interval_days ? Number(r.interval_days) : null,
		lastAt: r?.last_at,
		enabled: Number(r?.enabled ?? 1) === 1,
		overdue: ev.overdue,
		since: ev.since ? new Date(ev.since).toISOString() : null,
		// Rules are family-wide, so the UI must be able to attribute them.
		createdBy: r?.created_by ?? null,
		createdByName: r?.creator_first_name ?? null,
	};
}

// GET /catalog — what a rule can watch, with the option values each accepts.
// The web builds its picker from this rather than a hard-coded list, so a new
// category or a family's own routine option shows up without a code change.
reminderRoutes.get('/catalog', async (c) => {
	const db = c.get('db');
	const custom = await familyOptionOverrides(db);
	return c.json({ categories: reminderCatalog(custom) });
});

// GET / — list the caller's family reminders with live overdue status.
reminderRoutes.get('/', async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const famRes = await db.execute({ sql: 'SELECT household_id FROM user_households WHERE user_id = ?', args: [userId] });
	const fam = famRes.rows[0];
	if (!fam) return c.json({ reminders: [] });
	const familyId = Number((fam as any).household_id);

	const res = await db.execute({
		sql: `SELECT r.*, u.first_name AS creator_first_name FROM reminders r
		      LEFT JOIN users u ON u.id = r.created_by
		      WHERE r.family_id = ? ORDER BY r.created_at`,
		args: [familyId],
	});
	const reminders: any[] = [];
	for (const r of res.rows as any[]) {
		const ev = await evaluateReminder(db, r);
		reminders.push(shape(r, ev));
	}
	return c.json({ reminders });
});

// POST / — create a reminder (any family member).
reminderRoutes.post('/', zValidator('json', createReminderSchema), async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const famRes = await db.execute({ sql: 'SELECT household_id FROM user_households WHERE user_id = ?', args: [userId] });
	const fam = famRes.rows[0];
	if (!fam) return c.json({ error: 'Not a member of any family' }, 403);
	const familyId = Number((fam as any).household_id);

	const v = c.req.valid('json');

	// A rule's conditions are optional for an interval rule — empty means a
	// manual chore completed with "mark done" — but an inactivity rule needs at
	// least one. Accept the legacy single `category` so an older client works.
	let conditions: ReminderCondition[] = [];
	if (v.kind === 'inactivity') {
		conditions = v.conditions ?? (v.category ? [{ category: v.category }] : []);
		if (!v.hours) return c.json({ error: 'Choose how many hours is too long.' }, 400);
	} else {
		if (!v.intervalDays) return c.json({ error: 'Choose how many days apart.' }, 400);
		conditions = v.conditions ?? [];
	}
	if (conditions.length) {
		const custom = await familyOptionOverrides(db);
		const invalid = validateConditions(conditions, custom);
		if (invalid) return c.json({ error: invalid }, 400);
	} else if (v.kind === 'inactivity') {
		return c.json({ error: 'Choose at least one thing to watch.' }, 400);
	}

	const ins = await db.execute({
		sql: `INSERT INTO reminders (family_id, kind, category, conditions, match_mode, target_type, target_id, label, hours, interval_days, last_at, enabled, created_by, created_at)
		      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		args: [
			familyId,
			v.kind,
			// The first condition's category stays in `category` so the existing
			// index and any older reader still see something meaningful.
			conditions[0]?.category ?? v.category ?? null,
			conditions.length ? JSON.stringify(conditions) : null,
			parseMatch(v.match),
			v.targetType,
			v.targetId || null,
			v.label || null,
			v.hours ?? null,
			v.intervalDays ?? null,
			null,
			1,
			userId,
			new Date().toISOString(),
		],
	});
	const id = Number(ins.lastInsertRowid);
	const rowRes = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	return c.json({ message: 'Reminder created', reminder: shape(rowRes.rows[0], { overdue: false, since: null }) }, 201);
});

// PUT /:id — update a reminder.
reminderRoutes.put('/:id{[0-9]+}', zValidator('json', updateReminderSchema), async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const id = parseInt(c.req.param('id'));
	const rowRes = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	const r = rowRes.rows[0] as any;
	if (!r) return c.json({ error: 'Reminder not found' }, 404);
	if (!(await familyAccess(db, Number(r.family_id), userId))) return c.json({ error: 'Access denied' }, 403);

	const v = c.req.valid('json');

	if (v.conditions !== undefined && v.conditions !== null) {
		const custom = await familyOptionOverrides(db);
		const invalid = validateConditions(v.conditions, custom);
		if (invalid) return c.json({ error: invalid }, 400);
	}

	const updates: string[] = [];
	const params: Array<number | string | null> = [];
	const set = (col: string, val: number | string | null | undefined) => { if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === null ? null : val); } };
	set('kind', v.kind); set('category', v.category); set('match_mode', v.match); set('target_type', v.targetType); set('target_id', v.targetId);
	set('label', v.label); set('hours', v.hours); set('interval_days', v.intervalDays); set('enabled', v.enabled === undefined ? undefined : v.enabled ? 1 : 0);
	if (v.conditions !== undefined) {
		set('conditions', v.conditions === null ? null : JSON.stringify(v.conditions));
		if (v.conditions && v.conditions.length) set('category', v.conditions[0]?.category ?? null);
	}
	if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
	params.push(id);
	await db.execute({ sql: `UPDATE reminders SET ${updates.join(', ')} WHERE id = ?`, args: params });

	const fresh = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	return c.json({ message: 'Reminder updated', reminder: shape(fresh.rows[0], await evaluateReminder(db, fresh.rows[0])) });
});

// POST /:id/done — mark an interval reminder as completed (resets last_at).
reminderRoutes.post('/:id{[0-9]+}/done', async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const id = parseInt(c.req.param('id'));
	const rowRes = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	const r = rowRes.rows[0];
	if (!r) return c.json({ error: 'Reminder not found' }, 404);
	if (!(await familyAccess(db, Number((r as any).family_id), userId))) return c.json({ error: 'Access denied' }, 403);

	const now = new Date().toISOString();
	await db.execute({ sql: `UPDATE reminders SET last_at = ? WHERE id = ?`, args: [now, id] });
	const fresh = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	return c.json({ message: 'Reminder marked done', reminder: shape(fresh.rows[0], { overdue: false, since: null }) });
});

// DELETE /:id — remove a reminder.
reminderRoutes.delete('/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const id = parseInt(c.req.param('id'));
	const rowRes = await db.execute({ sql: 'SELECT * FROM reminders WHERE id = ?', args: [id] });
	const r = rowRes.rows[0];
	if (!r) return c.json({ error: 'Reminder not found' }, 404);
	if (!(await familyAccess(db, Number((r as any).family_id), userId))) return c.json({ error: 'Access denied' }, 403);

	await db.execute({ sql: `DELETE FROM reminders WHERE id = ?`, args: [id] });
	return c.json({ message: 'Reminder deleted' });
});

export { reminderRoutes };
