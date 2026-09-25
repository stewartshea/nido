import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const reminderRoutes = new Hono<AuthEnv>();

const createReminderSchema = z.object({
  kind: z.enum(['inactivity', 'interval']),
  category: z.string().max(40).optional(),
  targetType: z.enum(['member', 'home']).default('member'),
  targetId: z.number().optional(),
  label: z.string().max(200).optional(),
  hours: z.number().int().positive().optional(),
  intervalDays: z.number().int().positive().optional(),
});

const updateReminderSchema = z.object({
  kind: z.enum(['inactivity', 'interval']).optional(),
  category: z.string().max(40).nullable().optional(),
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

// Latest timestamp for an inactivity category across tables (per member/home).
async function latestFor(db: any, familyId: number, category: string, targetId: number | null): Promise<number | null> {
  const memberWhere = targetId ? 'b.household_id = ? AND b.id = ?' : 'b.household_id = ?';
  const memberArgs = targetId ? [familyId, targetId] : [familyId];

  let sql = '';
  if (category === 'feeds' || category === 'pumping' || category === 'feed') {
    sql = `SELECT MAX(f.start_time) AS t FROM feedings f JOIN babies b ON b.id = f.baby_id WHERE ${memberWhere} AND f.type ${category === 'pumping' ? "='pump'" : "!='pump'"}`;
  } else if (category === 'diapers') {
    sql = `SELECT MAX(d.change_time) AS t FROM diapers d JOIN babies b ON b.id = d.baby_id WHERE ${memberWhere}`;
  } else if (category === 'sleep') {
    sql = `SELECT MAX(s.start_time) AS t FROM sleep s JOIN babies b ON b.id = s.baby_id WHERE ${memberWhere}`;
  } else {
    return null;
  }
  const res = await db.execute({ sql, args: memberArgs });
  const row = res.rows[0];
  const t = row && (row as any).t;
  return t ? new Date(String(t)).getTime() : null;
}

async function evaluateReminder(db: any, r: any): Promise<{ overdue: boolean; since: number | null }> {
  const now = Date.now();
  if (r.kind === 'inactivity') {
    const hours = Number(r.hours ?? 0);
    const lastTs = await latestFor(db, Number(r.family_id), String(r.category), r.target_id ? Number(r.target_id) : null);
    if (!lastTs) return { overdue: true, since: null };
    return { overdue: now - lastTs > hours * 3600 * 1000, since: lastTs };
  }
  // interval
  const days = Number(r.interval_days ?? 0);
  const lastTs = r.last_at ? new Date(String(r.last_at)).getTime() : null;
  if (!lastTs) return { overdue: true, since: null };
  return { overdue: now - lastTs > days * 24 * 3600 * 1000, since: lastTs };
}

function shape(r: any, ev: { overdue: boolean; since: number | null }) {
	return {
		id: Number(r?.id),
		kind: r?.kind,
		category: r?.category,
		targetType: r?.target_type,
		targetId: r?.target_id ? Number(r.target_id) : null,
		label: r?.label,
		hours: r?.hours ? Number(r.hours) : null,
		intervalDays: r?.interval_days ? Number(r.interval_days) : null,
		lastAt: r?.last_at,
		enabled: Number(r?.enabled ?? 1) === 1,
		overdue: ev.overdue,
		since: ev.since ? new Date(ev.since).toISOString() : null,
	};
}

// GET / — list the caller's family reminders with live overdue status.
reminderRoutes.get('/', async (c) => {
	const db = c.get('db');
	const userId = getUserId(c);
	const famRes = await db.execute({ sql: 'SELECT household_id FROM user_households WHERE user_id = ?', args: [userId] });
	const fam = famRes.rows[0];
	if (!fam) return c.json({ reminders: [] });
	const familyId = Number((fam as any).household_id);

	const res = await db.execute({
		sql: `SELECT * FROM reminders WHERE family_id = ? ORDER BY created_at`,
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
	const ins = await db.execute({
		sql: `INSERT INTO reminders (family_id, kind, category, target_type, target_id, label, hours, interval_days, last_at, enabled, created_by, created_at)
		      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		args: [familyId, v.kind, v.category || null, v.targetType, v.targetId || null, v.label || null,
			v.hours ?? null, v.intervalDays ?? null, null, 1, userId, new Date().toISOString()],
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
	const updates: string[] = [];
	const params: Array<number | string | null> = [];
	const set = (col: string, val: number | string | null | undefined) => { if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === null ? null : val); } };
	set('kind', v.kind); set('category', v.category); set('target_type', v.targetType); set('target_id', v.targetId);
	set('label', v.label); set('hours', v.hours); set('interval_days', v.intervalDays); set('enabled', v.enabled === undefined ? undefined : v.enabled ? 1 : 0);
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