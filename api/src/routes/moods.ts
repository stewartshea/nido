import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import type { MoodRow } from '../db-types';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';

const moodRoutes = new Hono<AuthEnv>();

const createMoodSchema = z.object({
  memberId: z.number(),
  mood: z.string().min(1).max(60),
  recordedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const updateMoodSchema = z.object({
  mood: z.string().min(1).max(60).optional(),
  recordedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
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

moodRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const memberId = parseInt(c.req.query('memberId') || '0');
  if (!memberId) return c.json({ error: 'memberId is required' }, 400);
  const subjectId = await resolveProfile(db, memberId, userId);
  if (!subjectId) return c.json({ error: 'Access denied' }, 403);

  const { limit, offset } = parsePaging((k) => c.req.query(k));

  const res = await db.execute({
    sql: `SELECT id, subject_id, mood, recorded_at, notes, created_at, created_by FROM moods WHERE subject_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?`,
    args: [subjectId, limit, offset],
  });
  const total = await countMatching(db, 'moods', [subjectId]);
  await attachCreatedBy(db, res.rows as any[]);
  return c.json({ moods: res.rows.map((r) => ({
    id: Number(r?.id), memberId: Number(r?.subject_id), mood: r?.mood, recordedAt: r?.recorded_at, notes: r?.notes, createdAt: r?.created_at,
    createdBy: r?.created_by ?? null, createdByName: (r as any)?.created_by_name ?? null,
  })), total });
});

moodRoutes.post('/', zValidator('json', createMoodSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const { memberId, mood, recordedAt, notes } = c.req.valid('json');
  const subjectId = await resolveProfile(db, memberId, userId);
  if (!subjectId) return c.json({ error: 'Access denied' }, 403);

  const now = new Date().toISOString();
  const ins = await db.execute({
    sql: `INSERT INTO moods (subject_id, mood, recorded_at, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [subjectId, mood, recordedAt || now, notes || null, now, userId],
  });
  return c.json({ message: 'Mood recorded', mood: { id: Number(ins.lastInsertRowid), memberId: subjectId, mood, recordedAt: recordedAt || now, notes } }, 201);
});

moodRoutes.put('/:id{[0-9]+}', zValidator('json', updateMoodSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const id = parseInt(c.req.param('id'));
  const { mood, recordedAt, notes } = c.req.valid('json');
  const rowRes = await db.execute({ sql: `SELECT subject_id FROM moods WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Mood not found' }, 404);
  const memberId = Number((rowRes.rows[0] as any).subject_id);
  if (!(await babyAccessById(db, memberId, userId))) return c.json({ error: 'Access denied' }, 403);

  const updates: string[] = [];
  const params: Array<number | string | null> = [];
  if (mood !== undefined) { updates.push('mood = ?'); params.push(mood); }
  if (recordedAt !== undefined) { updates.push('recorded_at = ?'); params.push(recordedAt); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id);
  await db.execute({ sql: `UPDATE moods SET ${updates.join(', ')} WHERE id = ?`, args: params });
  return c.json({ message: 'Mood updated' });
});

moodRoutes.delete('/:id{[0-9]+}', async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const id = parseInt(c.req.param('id'));
  const rowRes = await db.execute({ sql: `SELECT subject_id FROM moods WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Mood not found' }, 404);
  const memberId = Number((rowRes.rows[0] as any).subject_id);
  if (!(await babyAccessById(db, memberId, userId))) return c.json({ error: 'Access denied' }, 403);

  await db.execute({ sql: `DELETE FROM moods WHERE id = ?`, args: [id] });
  return c.json({ message: 'Mood deleted' });
});

export { moodRoutes };