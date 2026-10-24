// routes/events.ts
//
// POST /events — the one write path for everything that happened.
//
// An event is a thing that happened: its `occurred_at` is always in the past at
// write time (docs/event-model-design.md §3.6), its category is one of the
// registry's, and its `data` document is validated by that category's zod.
// The future is a plan, not an event — /plans is where bookings live.
//
// The eight kinds the milestones catch-all used to hold land here as plain
// categories: a vitamin is `category: 'vitamins'`, not "milestones where kind
// is vitamins", and the id-preserving backfill means every old ref still
// points at the right row.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging } from '../paging';
import { type AuthEnv } from '../auth';
import { CATEGORIES, CATEGORY_IDS, RECORD_SKEW_MS, type CategoryId } from '../registry';
import { emitActivity } from '../inventory-consume';

export const eventRoutes = new Hono<AuthEnv>();

// The eight kinds stored on events today. Everything else still lives behind
// its typed table and its own route (feeds, diapers, sleep, growth,
// vaccinations, moods, journal) until Phase 2 folds them in — the registry's
// storage field says which, so nothing here has to guess.
export const EVENT_CATEGORY_IDS = CATEGORY_IDS.filter((id) => CATEGORIES[id].storage.table === 'events');

const createEventSchema = z.object({
	memberId: z.number(),
	category: z.enum(EVENT_CATEGORY_IDS as unknown as [CategoryId, ...CategoryId[]]),
	occurredAt: z.string().datetime(),
	title: z.string().min(1).max(200).optional(),
	notes: z.string().max(5000).optional(),
	data: z.record(z.unknown()).optional(),
	tags: z.array(z.string().max(40)).max(10).optional(),
});

const updateEventSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	notes: z.string().max(5000).optional(),
	occurredAt: z.string().datetime().optional(),
	data: z.record(z.unknown()).optional(),
	tags: z.array(z.string().max(40)).max(10).optional(),
});

/** What a stored event row looks like back to a caller, in the old shape. */
export async function shapeEventRow(db: any, row: any) {
	const entry = CATEGORIES[row.category as CategoryId];
	const data = typeof row.data === 'string' && row.data ? JSON.parse(row.data) : {};
	return {
		id: row.id,
		subject_id: row.subject_id,
		category: row.category,
		occurred_at: row.occurred_at,
		title: row.title,
		notes: row.notes,
		data,
		tags: typeof row.tags === 'string' && row.tags ? JSON.parse(row.tags) : null,
		created_at: row.created_at,
		created_by: row.created_by,
		// The pre-1b API surface spoke of `kind` and a bare `category` option
		// value; the alias routes and the summary tiles keep speaking it, so
		// the row carries both translations.
		kind: row.category,
		achieved_date: row.occurred_at,
		description: row.notes,
		option: entry ? (data[entry.optionKey] ?? null) : null,
	};
}

/**
 * Create an event row — shared by this route and by plan fulfilment, which is
 * the same write with a link back to the plan it answers.
 * Returns the stored row (shaped), or an error string the caller turns into a
 * response; the separation is what lets fulfilment reuse the whole path —
 * zod, tense, skew, stock billing — without a second copy of it.
 */
export async function createEvent(
	db: any,
	userId: string,
	input: { memberId: number; category: CategoryId; occurredAt: string; title?: string; notes?: string; data?: Record<string, unknown>; tags?: string[] },
): Promise<{ row: any; error: null; status: 201 } | { row: null; error: string; status: 400 | 404 | 409 }> {
	const entry = CATEGORIES[input.category];
	if (!entry) return { row: null, error: 'Unknown category', status: 400 };
	if (!entry.tense.includes('record')) {
		return { row: null, error: `"${input.category}" cannot be recorded`, status: 400 };
	}
	// An event is always past at write time. The skew tolerance keeps clock
	// drift between devices from turning honest logs into rejections (§3.6).
	if (new Date(input.occurredAt).getTime() - Date.now() > RECORD_SKEW_MS) {
		return { row: null, error: 'That time is still in the future — schedule it instead of recording it.', status: 409 };
	}
	const parsedData = entry.schema.safeParse(input.data ?? {});
	if (!parsedData.success) {
		return { row: null, error: `That does not look like a ${entry.label.toLowerCase()}: ${parsedData.error.issues[0]?.message ?? 'invalid data'}`, status: 400 };
	}

	const scope = await resolveTrackableMember(db, userId, input.memberId);
	if (!scope) return { row: null, error: 'Member not found or access denied', status: 404 };

	const result = await db.execute({
		sql: `INSERT INTO events (subject_id, category, occurred_at, title, notes, data, tags, created_by, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			scope.subjectId,
			input.category,
			input.occurredAt,
			input.title ?? null,
			input.notes ?? null,
			JSON.stringify(parsedData.data),
			input.tags?.length ? JSON.stringify(input.tags) : null,
			userId,
			new Date().toISOString(),
		],
	});
	const row = (await db.execute({
		sql: 'SELECT * FROM events WHERE id = ?',
		args: [Number(result.lastInsertRowid)],
	})).rows[0];

	// Stock billing is best effort, as on every route: the record is already
	// stored, and a consumption failure must not lose it. The caller's route
	// logs its own errors; there is no logger to hand down here.
	try {
		await emitActivity(db, {
			category: input.category,
			refTable: 'events',
			refId: Number(result.lastInsertRowid),
			subjectId: scope.subjectId,
			attrs: parsedData.data as Record<string, string | null>,
			createdBy: userId,
		});
	} catch {
		// already stored; the stock count is behind until the next record
	}

	return { row: await shapeEventRow(db, row), error: null, status: 201 };
}

eventRoutes.post('/', zValidator('json', createEventSchema), async (c) => {
	try {
		const { memberId, category, occurredAt, title, notes, data, tags } = c.req.valid('json');
		const made = await createEvent(c.get('db'), c.get('userId'), { memberId, category, occurredAt, title, notes, data, tags });
		if (made.error) return c.json({ error: made.error }, made.status);
		return c.json({ message: 'Recorded', event: made.row }, 201);
	} catch (error) {
		c.get('log').error('create event failed', { err: error });
		return c.json({ error: 'Failed to record' }, 500);
	}
});

eventRoutes.get('/', async (c) => {
	try {
		const db = c.get('db');
		const memberId = parseInt(c.req.query('memberId') || '0');
		const category = c.req.query('category') || '';
		if (!memberId) return c.json({ error: 'Member ID is required' }, 400);
		const scope = await resolveTrackableMember(db, c.get('userId'), memberId);
		if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

		const { limit, offset } = parsePaging((k) => c.req.query(k));
		const args: unknown[] = [scope.subjectId];
		let where = 'subject_id = ?';
		if (category) {
			if (!EVENT_CATEGORY_IDS.includes(category as CategoryId)) return c.json({ error: 'Unknown category' }, 400);
			where += ' AND category = ?';
			args.push(category);
		}
		const rows = (await db.execute({
			sql: `SELECT * FROM events WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
			args: [...args, limit, offset],
		})).rows as any[];
		const total = Number(((await db.execute({
			sql: `SELECT COUNT(*) AS n FROM events WHERE ${where}`,
			args,
		})).rows[0] as { n?: number } | undefined)?.n ?? 0);
		const events = [];
		for (const row of rows) events.push(await shapeEventRow(db, row));
		await attachCreatedBy(db, events);
		return c.json({ events, total });
	} catch (error) {
		c.get('log').error('list events failed', { err: error });
		return c.json({ error: 'Failed to list events' }, 500);
	}
});

eventRoutes.get('/:id{[0-9]+}', async (c) => {
	try {
		const db = c.get('db');
		const row = (await db.execute({
			sql: `SELECT e.* FROM events e
			      JOIN subjects s ON e.subject_id = s.id
			      JOIN households h ON s.household_id = h.id
			      JOIN user_households uh ON h.id = uh.household_id
			      WHERE e.id = ? AND uh.user_id = ?`,
			args: [parseInt(c.req.param('id')), c.get('userId')],
		})).rows[0];
		if (!row) return c.json({ error: 'Event not found or access denied' }, 404);
		return c.json({ event: await shapeEventRow(db, row) });
	} catch (error) {
		c.get('log').error('get event failed', { err: error });
		return c.json({ error: 'Failed to fetch event' }, 500);
	}
});

eventRoutes.put('/:id{[0-9]+}', zValidator('json', updateEventSchema), async (c) => {
	try {
		const db = c.get('db');
		const userId = c.get('userId');
		const id = parseInt(c.req.param('id'));
		const existing = (await db.execute({
			sql: `SELECT e.* FROM events e
			      JOIN subjects s ON e.subject_id = s.id
			      JOIN households h ON s.household_id = h.id
			      JOIN user_households uh ON h.id = uh.household_id
			      WHERE e.id = ? AND uh.user_id = ?`,
			args: [id, userId],
		})).rows[0];
		if (!existing) return c.json({ error: 'Event not found or access denied' }, 404);

		const { title, notes, occurredAt, data, tags } = c.req.valid('json');
		if (occurredAt && new Date(occurredAt).getTime() - Date.now() > RECORD_SKEW_MS) {
			return c.json({ error: 'That time is still in the future — schedule it instead of editing it into one.' }, 400);
		}
		const updates: string[] = [];
		const args: unknown[] = [];
		if (title !== undefined) { updates.push('title = ?'); args.push(title); }
		if (notes !== undefined) { updates.push('notes = ?'); args.push(notes); }
		if (occurredAt !== undefined) { updates.push('occurred_at = ?'); args.push(occurredAt); }
		if (data !== undefined) {
			const entry = CATEGORIES[existing.category as CategoryId];
			const parsed = entry.schema.safeParse(data);
			if (!parsed.success) return c.json({ error: 'That data does not fit the category' }, 400);
			updates.push('data = ?');
			args.push(JSON.stringify(parsed.data));
		}
		if (tags !== undefined) { updates.push('tags = ?'); args.push(tags.length ? JSON.stringify(tags) : null); }
		if (!updates.length) return c.json({ message: 'No updates provided' });
		args.push(id);
		await db.execute({ sql: `UPDATE events SET ${updates.join(', ')} WHERE id = ?`, args });
		const row = (await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] })).rows[0];
		return c.json({ message: 'Event updated', event: await shapeEventRow(db, row) });
	} catch (error) {
		c.get('log').error('update event failed', { err: error });
		return c.json({ error: 'Failed to update event' }, 500);
	}
});

eventRoutes.delete('/:id{[0-9]+}', async (c) => {
	try {
		const db = c.get('db');
		const id = parseInt(c.req.param('id'));
		const owned = (await db.execute({
			sql: `SELECT e.id FROM events e
			      JOIN subjects s ON e.subject_id = s.id
			      JOIN households h ON s.household_id = h.id
			      JOIN user_households uh ON h.id = uh.household_id
			      WHERE e.id = ? AND uh.user_id = ?`,
			args: [id, c.get('userId')],
		})).rows[0];
		if (!owned) return c.json({ error: 'Event not found or access denied' }, 404);
		await db.execute({ sql: 'DELETE FROM events WHERE id = ?', args: [id] });
		return c.json({ message: 'Event deleted' });
	} catch (error) {
		c.get('log').error('delete event failed', { err: error });
		return c.json({ error: 'Failed to delete event' }, 500);
	}
});
