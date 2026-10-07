import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import type { JournalEntryRow } from '../db-types';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';

const journalRoutes = new Hono<AuthEnv>();

const createJournalSchema = z.object({
  memberId: z.number(),
  title: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
  entryDate: z.string().datetime().optional(),
});

const updateJournalSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  body: z.string().max(20000).nullable().optional(),
  entryDate: z.string().datetime().nullable().optional(),
});

const getUserId = (c: any) => c.get('userId') as string;

async function resolveProfile(db: any, memberId: number, userId: string): Promise<number | null> {
  const scope = await resolveTrackableMember(db, userId, memberId);
  return scope ? scope.subjectId : null;
}

async function babyAccessById(db: any, subjectId: number, userId: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM subjects b JOIN user_households uh ON uh.household_id = b.household_id WHERE b.id = ? AND uh.user_id = ? LIMIT 1`,
    args: [subjectId, userId],
  });
  return res.rows.length > 0;
}

journalRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const memberId = parseInt(c.req.query('memberId') || '0');
  if (!memberId) return c.json({ error: 'memberId is required' }, 400);
  const subjectId = await resolveProfile(db, memberId, userId);
  if (!subjectId) return c.json({ error: 'Access denied' }, 403);

  const { limit, offset } = parsePaging((k) => c.req.query(k));

  const res = await db.execute({
    sql: `SELECT id, subject_id, title, body, entry_date, created_at, created_by FROM journal_entries WHERE subject_id = ? ORDER BY COALESCE(entry_date, created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    args: [subjectId, limit, offset],
  });
  const total = await countMatching(db, 'journal_entries', [subjectId]);
  await attachCreatedBy(db, res.rows as any[]);
  return c.json({ entries: res.rows.map((r) => ({
    id: Number(r?.id), memberId: Number(r?.subject_id), title: r?.title, body: r?.body, entryDate: r?.entry_date, createdAt: r?.created_at,
    createdBy: r?.created_by ?? null, createdByName: (r as any)?.created_by_name ?? null,
  })), total });
});

journalRoutes.post('/', zValidator('json', createJournalSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const { memberId, title, body, entryDate } = c.req.valid('json');
  const subjectId = await resolveProfile(db, memberId, userId);
  if (!subjectId) return c.json({ error: 'Access denied' }, 403);

  const now = new Date().toISOString();
  const ins = await db.execute({
    sql: `INSERT INTO journal_entries (subject_id, title, body, entry_date, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [subjectId, title || null, body || null, entryDate || now, now, userId],
  });
  return c.json({ message: 'Journal entry saved', entry: { id: Number(ins.lastInsertRowid), memberId: subjectId, title, body, entryDate: entryDate || now } }, 201);
});

journalRoutes.put('/:id{[0-9]+}', zValidator('json', updateJournalSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const id = parseInt(c.req.param('id'));
  const { title, body, entryDate } = c.req.valid('json');
  const rowRes = await db.execute({ sql: `SELECT subject_id FROM journal_entries WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404);
  const memberId = Number((rowRes.rows[0] as any).subject_id);
  if (!(await babyAccessById(db, memberId, userId))) return c.json({ error: 'Access denied' }, 403);

  const updates: string[] = [];
  const params: Array<number | string | null> = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (body !== undefined) { updates.push('body = ?'); params.push(body); }
  if (entryDate !== undefined) { updates.push('entry_date = ?'); params.push(entryDate); }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id);
  await db.execute({ sql: `UPDATE journal_entries SET ${updates.join(', ')} WHERE id = ?`, args: params });
  return c.json({ message: 'Journal entry updated' });
});

journalRoutes.delete('/:id{[0-9]+}', async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const id = parseInt(c.req.param('id'));
  const rowRes = await db.execute({ sql: `SELECT subject_id FROM journal_entries WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404);
  const memberId = Number((rowRes.rows[0] as any).subject_id);
  if (!(await babyAccessById(db, memberId, userId))) return c.json({ error: 'Access denied' }, 403);

  await db.execute({ sql: `DELETE FROM journal_entries WHERE id = ?`, args: [id] });
  return c.json({ message: 'Journal entry deleted' });
});

export { journalRoutes };