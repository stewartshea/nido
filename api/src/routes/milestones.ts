// routes/milestones.ts
//
// The alias for one release (docs/event-model-design.md §6, step 4): every
// kind the milestones catch-all used to hold is a category of `events` now,
// and this route translates the old vocabulary — `kind`, and a bare
// `category` option value — onto it, so callers written before the event
// model keep working. Phase 1c deletes this file along with the table.
//
// One behavioral break is deliberate: a future `achievedDate` used to mean
// "scheduled", silently, by punning on one column (§3.6). It is refused here
// with a pointer at /plans, where booking lives — records are always past.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging } from '../paging';
import { type AuthEnv } from '../auth';
import { CATEGORIES, EVENT_KIND_CATEGORIES, RECORD_SKEW_MS, type CategoryId } from '../category-registry';
import {
	upcomingAppointmentsForSubject, upcomingAppointmentsForFamily, APPOINTMENT_LIST_LOOKAHEAD_DAYS,
} from '../appointments';
import { createEvent, shapeEventRow } from './events';

const milestoneRoutes = new Hono<AuthEnv>();

// The kinds that share this route are exactly the events categories — the
// zod is derived rather than listed, so a category moved onto events is
// loggable here the day it moves.
const MILESTONE_KINDS = EVENT_KIND_CATEGORIES;

const createMilestoneSchema = z.object({
  memberId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  achievedDate: z.string().datetime(),
  kind: z.enum(MILESTONE_KINDS as unknown as [string, ...string[]]).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  achievedDate: z.string().datetime().optional(),
  kind: z.enum(MILESTONE_KINDS as unknown as [string, ...string[]]).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

/** The data document for a kind's option value, under the kind's own key. */
function dataForKind(kind: string, option: string | undefined) {
	return option ? { [CATEGORIES[kind as CategoryId].optionKey]: option } : {};
}

/** A shaped event row in the old milestones response shape. */
function legacyRow(shaped: any) {
	return {
		id: shaped.id,
		subject_id: shaped.subject_id,
		title: shaped.title,
		description: shaped.description,
		achieved_date: shaped.achieved_date,
		kind: shaped.kind,
		category: shaped.option,
		tags: shaped.tags,
		created_at: shaped.created_at,
		created_by: shaped.created_by,
	};
}

// Get all milestones for a member
milestoneRoutes.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    const memberId = parseInt(c.req.query('memberId') || '0');

    if (!memberId) {
      return c.json({ error: 'Member ID is required' }, 400);
    }

    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }

    const { limit, offset } = parsePaging((k) => c.req.query(k));

    const rows = (await db.execute({
      sql: `
      SELECT * FROM events
      WHERE subject_id = ? AND category IN (${MILESTONE_KINDS.map(() => '?').join(', ')})
      ORDER BY occurred_at DESC, id DESC
      LIMIT ? OFFSET ?
    `,
      args: [scope.subjectId, ...MILESTONE_KINDS, limit, offset]
    })).rows as any[];
    const total = Number(((await db.execute({
      sql: `SELECT COUNT(*) AS n FROM events WHERE subject_id = ? AND category IN (${MILESTONE_KINDS.map(() => '?').join(', ')})`,
      args: [scope.subjectId, ...MILESTONE_KINDS],
    })).rows[0] as { n?: number }).n ?? 0);

    const milestones = [];
    for (const row of rows) milestones.push(legacyRow(await shapeEventRow(db, row)));
    await attachCreatedBy(db, milestones);
    return c.json({ milestones, total });
  } catch (error) {
    c.get('log').error('get milestones failed', { err: error });
    return c.json({ error: 'Failed to fetch milestones' }, 500);
  }
});

// Get a specific milestone
milestoneRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');

    const row = (await db.execute({
      sql: `
      SELECT e.* FROM events e
      JOIN subjects b ON e.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE e.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    })).rows[0];

    if (!row) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }

    return c.json({ milestone: legacyRow(await shapeEventRow(db, row)) });
  } catch (error) {
    c.get('log').error('get milestone failed', { err: error });
    return c.json({ error: 'Failed to fetch milestone' }, 500);
  }
});

// Create a new milestone
milestoneRoutes.post('/', zValidator('json', createMilestoneSchema), async (c) => {
  try {
    const { memberId, title, description, achievedDate, kind, category, tags } = c.req.valid('json');
    const db = c.get('db');
    const made = await createEvent(db, c.get('userId'), {
      memberId,
      category: (kind ?? 'milestones') as CategoryId,
      occurredAt: achievedDate,
      title,
      notes: description,
      data: dataForKind(kind ?? 'milestones', category),
      tags,
    });
    if (made.error) {
      // The statuses are the events route's: 404 for a member the caller
      // cannot see, 409 for the future-date refusal that carries the way out.
      return c.json({ error: made.error }, made.status);
    }
    return c.json({
      message: 'Milestone recorded successfully',
      milestone: legacyRow(made.row),
    }, 201);
  } catch (error) {
    c.get('log').error('create milestone failed', { err: error });
    return c.json({ error: 'Failed to record milestone' }, 500);
  }
});

// Update a milestone
milestoneRoutes.put('/:id{[0-9]+}', zValidator('json', updateMilestoneSchema), async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const { title, description, achievedDate, kind, category, tags } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');

    const row = (await db.execute({
      sql: `
      SELECT e.* FROM events e
      JOIN subjects b ON e.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE e.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    })).rows[0];
    if (!row) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }

    if (achievedDate && new Date(achievedDate).getTime() - Date.now() > RECORD_SKEW_MS) {
      return c.json({ error: 'That time is still in the future — schedule it instead (POST /plans).' }, 409);
    }

    // The alias lets `kind` move a row between events categories, which the
    // events route deliberately does not, so it owns its own UPDATE.
    const updates: string[] = [];
    const params: unknown[] = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (achievedDate !== undefined) { updates.push('occurred_at = ?'); params.push(achievedDate); }
    if (description !== undefined) { updates.push('notes = ?'); params.push(description); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(tags.length ? JSON.stringify(tags) : null); }
    const nextCategory = kind ?? String(row.category);
    const nextData = category !== undefined
      ? dataForKind(nextCategory, category || undefined)
      : JSON.parse(typeof row.data === 'string' && row.data ? row.data : '{}');
    updates.push('category = ?', 'data = ?');
    params.push(nextCategory, JSON.stringify(nextData));
    params.push(milestoneId);

    await db.execute({
      sql: `UPDATE events SET ${updates.join(', ')} WHERE id = ?`,
      args: params
    });

    const updated = (await db.execute({
      sql: 'SELECT * FROM events WHERE id = ?',
      args: [milestoneId]
    })).rows[0];
    return c.json({
      message: 'Milestone updated successfully',
      milestone: legacyRow(await shapeEventRow(db, updated))
    });
  } catch (error) {
    c.get('log').error('update milestone failed', { err: error });
    return c.json({ error: 'Failed to update milestone' }, 500);
  }
});

// Delete a milestone
milestoneRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');

    const row = (await db.execute({
      sql: `
      SELECT e.id FROM events e
      JOIN subjects b ON e.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE e.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    })).rows[0];
    if (!row) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }

    await db.execute({
      sql: 'DELETE FROM events WHERE id = ?',
      args: [milestoneId]
    });

    return c.json({ message: 'Milestone deleted successfully' });
  } catch (error) {
    c.get('log').error('delete milestone failed', { err: error });
    return c.json({ error: 'Failed to delete milestone' }, 500);
  }
});

// Get upcoming appointments: open plans, whatever category they were booked
// under. Kept beside /categories and /trends; the numeric /:id route
// matches digits only, so a literal path here is never shadowed.
milestoneRoutes.get('/upcoming', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    const memberId = parseInt(c.req.query('memberId') || '0');
    const days = parseInt(c.req.query('days') || String(APPOINTMENT_LIST_LOOKAHEAD_DAYS));

    if (memberId) {
      const scope = await resolveTrackableMember(db, userId, memberId);
      if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);
      const appointments = await upcomingAppointmentsForSubject(db, scope.subjectId, { days });
      return c.json({ appointments, total: appointments.length, days });
    }

    const appointments = await upcomingAppointmentsForFamily(db, { days });
    return c.json({ appointments, total: appointments.length, days });
  } catch (error) {
    c.get('log').error('get upcoming appointments failed', { err: error });
    return c.json({ error: 'Failed to fetch upcoming appointments' }, 500);
  }
});

milestoneRoutes.get('/categories', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');

    // The option values a family has actually used, across every kind. The
    // value lives in the data document under the kind's own key now, so the
    // distinct set is extracted per row rather than by one column.
    const rows = (await db.execute({
      sql: `
      SELECT e.category, e.data FROM events e
      JOIN subjects b ON e.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE uh.user_id = ? AND e.category IN (${MILESTONE_KINDS.map(() => '?').join(', ')})
    `,
      args: [userId, ...MILESTONE_KINDS]
    })).rows as any[];
    const seen = new Set<string>();
    for (const row of rows) {
      const shaped = await shapeEventRow(db, row);
      if (shaped.option) seen.add(String(shaped.option));
    }
    const categories = [...seen].sort().map((value) => ({
      id: value,
      name: value.charAt(0).toUpperCase() + value.slice(1),
    }));
    return c.json({ categories });
  } catch (error) {
    c.get('log').error('get categories failed', { err: error });
    return c.json({ error: 'Failed to fetch milestone categories' }, 500);
  }
});

milestoneRoutes.get('/trends', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    const memberId = parseInt(c.req.query('memberId') || '0');
    const category = c.req.query('category') || '';
    const days = parseInt(c.req.query('days') || '30');

    if (!memberId) return c.json({ error: 'memberId is required' }, 400);

    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = (await db.execute({
      sql: `SELECT category, data FROM events
            WHERE subject_id = ? AND occurred_at >= ? AND category IN (${MILESTONE_KINDS.map(() => '?').join(', ')})`,
      args: [scope.subjectId, since, ...MILESTONE_KINDS],
    })).rows as any[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      const shaped = await shapeEventRow(db, row);
      const key = String(shaped.option ?? 'uncategorized');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const trends = [...counts.entries()]
      .map(([value, count]) => ({ category: value, count }))
      .sort((a, b) => b.count - a.count);
    const total = trends.reduce((s, t) => s + t.count, 0);
    return c.json({ trends, total, days, memberId, since });
  } catch (error) {
    c.get('log').error('get trends failed', { err: error });
    return c.json({ error: 'Failed to fetch trends' }, 500);
  }
});

export { milestoneRoutes };
