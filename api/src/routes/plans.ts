// routes/plans.ts
//
// A plan is a thing that is going to: booked-for (scheduled_at) and booked-at
// (created_at) are separate facts, status is planned/fulfilled/missed/
// cancelled, and fulfilment writes the ordinary event through the shared
// createEvent path — so confirming a booked vitamin dose is what takes the
// bottle down, with no second copy of any rule (docs/event-model-design.md
// §3.6).
//
// A plan is answerable from the moment it is booked (a garage that comes a
// day early is fulfilled early, with the real occurred_at); once scheduled_at
// passes while it is still planned, the client reads it as overdue — the
// prompt — and the question clears only by being answered.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { resolveTrackableMember } from '../member-scope';
import { type AuthEnv } from '../auth';
import { CATEGORIES, type CategoryId } from '../registry';
import { createEvent, shapeEventRow } from './events';

export const planRoutes = new Hono<AuthEnv>();

// Booking is offered for a bookable category whose records are events — the
// ones fulfilment can actually write. Vaccinations declare book in the
// registry (§9 records the intent) but stay a typed table until Phase 2, so
// a vaccine plan could never be answered; the storage check is what keeps the
// promise honest and dies with the typed tables.
const bookableNow = (category: CategoryId): boolean =>
	CATEGORIES[category].tense.includes('book') && CATEGORIES[category].storage.table === 'events';

const createPlanSchema = z.object({
	memberId: z.number(),
	category: z.string().min(1).max(40),
	scheduledAt: z.string().datetime(),
	title: z.string().min(1).max(200).optional(),
	notes: z.string().max(5000).optional(),
	data: z.record(z.unknown()).optional(),
});

const rescheduleSchema = z.object({ scheduledAt: z.string().datetime() });
const fulfilSchema = z.object({
	occurredAt: z.string().datetime().optional(),
	title: z.string().min(1).max(200).optional(),
	notes: z.string().max(5000).optional(),
	data: z.record(z.unknown()).optional(),
});

/** A stored plan row, with the answer the client needs to render it. */
async function shapePlanRow(db: any, row: any) {
	const data = typeof row.data === 'string' && row.data ? JSON.parse(row.data) : {};
	return {
		id: row.id,
		subject_id: row.subject_id,
		category: row.category,
		scheduled_at: row.scheduled_at,
		title: row.title,
		notes: row.notes,
		data,
		status: row.status,
		fulfilled_by: row.fulfilled_by,
		origin_event_id: row.origin_event_id,
		created_at: row.created_at,
		created_by: row.created_by,
		// The question the plan currently is: an answerable booking whose time
		// has arrived. Everything else renders as history.
		overdue: row.status === 'planned' && new Date(String(row.scheduled_at)).getTime() <= Date.now(),
	};
}

/** The plan a family member can see, or null when it is not theirs. */
async function planFor(db: any, userId: string, id: number) {
	return (await db.execute({
		sql: `SELECT p.* FROM plans p
		      JOIN subjects s ON p.subject_id = s.id
		      JOIN households h ON s.household_id = h.id
		      JOIN user_households uh ON h.id = uh.household_id
		      WHERE p.id = ? AND uh.user_id = ?`,
		args: [id, userId],
	})).rows[0] ?? null;
}

planRoutes.post('/', zValidator('json', createPlanSchema), async (c) => {
	try {
		const db = c.get('db');
		const { memberId, category, scheduledAt, title, notes, data } = c.req.valid('json');
		if (!bookableNow(category as CategoryId)) {
			return c.json({ error: `"${category}" cannot be booked` }, 400);
		}
		const entry = CATEGORIES[category as CategoryId];
		const parsedData = entry.schema.safeParse(data ?? {});
		if (!parsedData.success) {
			return c.json({ error: `That does not fit a ${entry.label.toLowerCase()}` }, 400);
		}
		const scope = await resolveTrackableMember(db, c.get('userId'), memberId);
		if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

		const ins = await db.execute({
			sql: `INSERT INTO plans (subject_id, category, scheduled_at, title, notes, data, created_by, created_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				scope.subjectId, category, scheduledAt,
				title ?? null, notes ?? null, JSON.stringify(parsedData.data),
				c.get('userId'), new Date().toISOString(),
			],
		});
		const row = (await db.execute({ sql: 'SELECT * FROM plans WHERE id = ?', args: [Number(ins.lastInsertRowid)] })).rows[0];
		return c.json({ message: 'Booked', plan: await shapePlanRow(db, row) }, 201);
	} catch (error) {
		c.get('log').error('book plan failed', { err: error });
		return c.json({ error: 'Failed to book' }, 500);
	}
});

// The list the upcoming page reads: open bookings soonest first, with
// ?status= for history. Overdue plans sort first in practice because their
// scheduled_at is smallest — which is the point: the question rises to the
// top rather than aging out of sight the way a future-dated record used to.
planRoutes.get('/', async (c) => {
	try {
		const db = c.get('db');
		const status = c.req.query('status') || 'planned';
		const memberId = parseInt(c.req.query('memberId') || '0');
		const args: unknown[] = [status];
		let where = 'p.status = ?';
		let join = '';
		if (memberId) {
			const scope = await resolveTrackableMember(db, c.get('userId'), memberId);
			if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);
			where += ' AND p.subject_id = ?';
			args.push(scope.subjectId);
		}
		// Family-wide reads join through the household the caller belongs to;
		// a member filter is already access-checked, so it needs no join.
		if (!memberId) join = `JOIN subjects s ON p.subject_id = s.id
		      JOIN households h ON s.household_id = h.id
		      JOIN user_households uh ON h.id = uh.household_id AND uh.user_id = ?`;
		const rows = (await db.execute({
			sql: `SELECT p.* FROM plans p ${join} WHERE ${where} ORDER BY p.scheduled_at ASC`,
			args: memberId ? args : [c.get('userId'), ...args],
		})).rows as any[];
		const plans = [];
		for (const row of rows) plans.push(await shapePlanRow(db, row));
		return c.json({ plans, total: plans.length });
	} catch (error) {
		c.get('log').error('list plans failed', { err: error });
		return c.json({ error: 'Failed to list plans' }, 500);
	}
});

planRoutes.post('/:id{[0-9]+}/reschedule', zValidator('json', rescheduleSchema), async (c) => {
	try {
		const db = c.get('db');
		const id = parseInt(c.req.param('id'));
		const plan = await planFor(db, c.get('userId'), id);
		if (!plan) return c.json({ error: 'Plan not found or access denied' }, 404);
		if (plan.status !== 'planned') return c.json({ error: 'Only an open plan can be rescheduled' }, 409);
		const { scheduledAt } = c.req.valid('json');
		await db.execute({ sql: 'UPDATE plans SET scheduled_at = ? WHERE id = ?', args: [scheduledAt, id] });
		const row = (await db.execute({ sql: 'SELECT * FROM plans WHERE id = ?', args: [id] })).rows[0];
		return c.json({ message: 'Rescheduled', plan: await shapePlanRow(db, row) });
	} catch (error) {
		c.get('log').error('reschedule plan failed', { err: error });
		return c.json({ error: 'Failed to reschedule' }, 500);
	}
});

// Missed and cancelled both close a plan without an event; the difference is
// the fact they record. Missed says it did not happen and will not (and is
// reportable: "two missed doses this quarter"); cancelled says it is no longer
// expected at all. Neither bills stock — only the event an answer creates ever
// does.
for (const [verb, status, message] of [
	['missed', 'missed', 'Marked missed'],
	['cancel', 'cancelled', 'Cancelled'],
] as const) {
	planRoutes.post(`/:id{[0-9]+}/${verb}`, async (c) => {
		try {
			const db = c.get('db');
			const id = parseInt(c.req.param('id'));
			const plan = await planFor(db, c.get('userId'), id);
			if (!plan) return c.json({ error: 'Plan not found or access denied' }, 404);
			if (plan.status !== 'planned') return c.json({ error: 'Only an open plan can be answered' }, 409);
			await db.execute({ sql: 'UPDATE plans SET status = ? WHERE id = ?', args: [status, id] });
			const row = (await db.execute({ sql: 'SELECT * FROM plans WHERE id = ?', args: [id] })).rows[0];
			return c.json({ message, plan: await shapePlanRow(db, row) });
		} catch (error) {
			c.get('log').error(`${verb} plan failed`, { err: error });
			return c.json({ error: 'Failed to update the plan' }, 500);
		}
	});
}

// "Done" — the ordinary log form pre-filled from the plan. occurredAt
// defaults to the scheduled time and is editable, which is exactly where
// scheduled ≠ actual gets captured. The event is written by the same path a
// direct log takes (tense, skew, zod, stock billing), then linked back.
planRoutes.post('/:id{[0-9]+}/fulfil', zValidator('json', fulfilSchema), async (c) => {
	try {
		const db = c.get('db');
		const userId = c.get('userId');
		const id = parseInt(c.req.param('id'));
		const plan = await planFor(db, userId, id);
		if (!plan) return c.json({ error: 'Plan not found or access denied' }, 404);
		if (plan.status !== 'planned') return c.json({ error: 'Only an open plan can be fulfilled' }, 409);

		const { occurredAt, title, notes, data } = c.req.valid('json');
		// The plan's own fields pre-fill the record; the answer only has to say
		// when it actually happened, and may correct anything else.
		const planData = typeof plan.data === 'string' && plan.data ? JSON.parse(plan.data) : {};
		// resolveTrackableMember takes the member id; a plan row stores the
		// subject id, so look the member up through the same alignment the
		// write path uses. The explicit legacy link wins over the aligned
		// fallback, and only a trackable member can carry the record — the
		// owner's member id can coincide with a child's subject id, and the
		// bare COALESCE would match them first.
		const member = (await db.execute({
			sql: `SELECT fm.id AS member_id
			      FROM family_members fm
			      LEFT JOIN subjects aligned ON aligned.id = fm.id AND aligned.household_id = fm.household_id
			      WHERE COALESCE(fm.legacy_subject_id, aligned.id) = ?
			        AND COALESCE(fm.trackable, 1) = 1
			      ORDER BY fm.legacy_subject_id IS NULL
			      LIMIT 1`,
			args: [plan.subject_id],
		})).rows[0];
		if (!member) return c.json({ error: 'The member this plan is for no longer exists' }, 409);

		const made = await createEvent(db, userId, {
			memberId: Number(member.member_id),
			category: plan.category,
			occurredAt: occurredAt ?? String(plan.scheduled_at),
			title: title ?? (plan.title ? String(plan.title) : undefined),
			notes: notes ?? (plan.notes ? String(plan.notes) : undefined),
			data: { ...planData, ...(data ?? {}) },
		});
		if (made.error) return c.json({ error: made.error }, made.status);

		await db.execute({
			sql: 'UPDATE plans SET status = ?, fulfilled_by = ? WHERE id = ?',
			args: ['fulfilled', made.row.id, id],
		});
		const row = (await db.execute({ sql: 'SELECT * FROM plans WHERE id = ?', args: [id] })).rows[0];
		return c.json({
			message: 'Recorded — the plan is answered',
			plan: await shapePlanRow(db, row),
			event: await shapeEventRow(db, (await db.execute({
				sql: 'SELECT * FROM events WHERE id = ?', args: [made.row.id],
			})).rows[0]),
		});
	} catch (error) {
		c.get('log').error('fulfil plan failed', { err: error });
		return c.json({ error: 'Failed to record the plan' }, 500);
	}
});
