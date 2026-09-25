import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import type { MoodRow } from '../db-types';

const moodRoutes = new Hono<AuthEnv>();

const createMoodSchema = z.object({
  babyId: z.number(),
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

async function babyAccess(db: any, babyId: number, userId: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT b.id FROM babies b
          JOIN user_households uh ON uh.household_id = b.household_id
          WHERE b.id = ? AND uh.user_id = ? LIMIT 1`,
    args: [babyId, userId],
  });
  return res.rows.length > 0;
}

moodRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const babyId = parseInt(c.req.query('babyId') || '0');
  if (!babyId) return c.json({ error: 'babyId is required' }, 400);
  if (!(await babyAccess(db, babyId, userId))) return c.json({ error: 'Access denied' }, 403);

  const res = await db.execute({
    sql: `SELECT id, baby_id, mood, recorded_at, notes, created_at FROM moods WHERE baby_id = ? ORDER BY recorded_at DESC`,
    args: [babyId],
  });
  return c.json({ moods: res.rows.map((r) => ({
    id: Number(r?.id), babyId: Number(r?.baby_id), mood: r?.mood, recordedAt: r?.recorded_at, notes: r?.notes, createdAt: r?.created_at,
  })) });
});

moodRoutes.post('/', zValidator('json', createMoodSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const { babyId, mood, recordedAt, notes } = c.req.valid('json');
  if (!(await babyAccess(db, babyId, userId))) return c.json({ error: 'Access denied' }, 403);

  const now = new Date().toISOString();
  const ins = await db.execute({
    sql: `INSERT INTO moods (baby_id, mood, recorded_at, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [babyId, mood, recordedAt || now, notes || null, now],
  });
  return c.json({ message: 'Mood recorded', mood: { id: Number(ins.lastInsertRowid), babyId, mood, recordedAt: recordedAt || now, notes } }, 201);
});

moodRoutes.put('/:id{[0-9]+}', zValidator('json', updateMoodSchema), async (c) => {
  const db = c.get('db');
  const userId = getUserId(c);
  const id = parseInt(c.req.param('id'));
  const { mood, recordedAt, notes } = c.req.valid('json');
  const rowRes = await db.execute({ sql: `SELECT baby_id FROM moods WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Mood not found' }, 404);
  const babyId = Number((rowRes.rows[0] as any).baby_id);
  if (!(await babyAccess(db, babyId, userId))) return c.json({ error: 'Access denied' }, 403);

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
  const rowRes = await db.execute({ sql: `SELECT baby_id FROM moods WHERE id = ? LIMIT 1`, args: [id] });
  if (rowRes.rows.length === 0) return c.json({ error: 'Mood not found' }, 404);
  const babyId = Number((rowRes.rows[0] as any).baby_id);
  if (!(await babyAccess(db, babyId, userId))) return c.json({ error: 'Access denied' }, 403);

  await db.execute({ sql: `DELETE FROM moods WHERE id = ?`, args: [id] });
  return c.json({ message: 'Mood deleted' });
});

export { moodRoutes };