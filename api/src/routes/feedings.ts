import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { FeedingRow } from '../db-types';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';
import { type AuthEnv } from '../auth';

const feedingRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createFeedingSchema = z.object({
	memberId: z.number(),
	startTime: z.string().datetime(),
	endTime: z.string().datetime().optional(),
	amount: z.number().positive().optional(),
	amountUnit: z.enum(['ml', 'oz']).optional(),
	type: z.enum(['breast', 'bottle', 'pump', 'formula', 'solid']),
	side: z.enum(['left', 'right', 'both']).optional(),
	leftBreastAt: z.string().datetime().optional(),
	rightBreastAt: z.string().datetime().optional(),
	leftDuration: z.number().int().nonnegative().optional(),
	rightDuration: z.number().int().nonnegative().optional(),
	formulaId: z.number().optional(),
	notes: z.string().optional(),
});

const updateFeedingSchema = z.object({
	startTime: z.string().datetime().optional(),
	endTime: z.string().datetime().optional(),
	amount: z.number().positive().optional(),
	amountUnit: z.enum(['ml', 'oz']).optional(),
	type: z.enum(['breast', 'bottle', 'pump', 'formula', 'solid']).optional(),
	side: z.enum(['left', 'right', 'both']).nullable().optional(),
	leftBreastAt: z.string().datetime().nullable().optional(),
	rightBreastAt: z.string().datetime().nullable().optional(),
	leftDuration: z.number().int().nonnegative().nullable().optional(),
	rightDuration: z.number().int().nonnegative().nullable().optional(),
	formulaId: z.number().optional(),
	notes: z.string().optional(),
});

// Get all feedings for a baby
feedingRoutes.get('/', async (c) => {
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
    const subjectId = scope.subjectId;
    const { limit, offset } = parsePaging((k) => c.req.query(k));

    const feedingsResult = await db.execute({
      sql: `
      SELECT id, subject_id, start_time, end_time, duration, amount, amount_unit, type, side, left_breast_at, right_breast_at, left_duration, right_duration, formula_id, notes, created_at, created_by
      FROM feedings
      WHERE subject_id = ?
      ORDER BY start_time DESC, id DESC
      LIMIT ? OFFSET ?
    `,
      args: [subjectId, limit, offset]
    });
    const total = await countMatching(db, 'feedings', [subjectId]);
    
    // Calculate duration if not already calculated
    const feedings = (feedingsResult.rows as unknown as FeedingRow[])
      .map(feeding => {
        if (!feeding.duration && feeding.start_time && feeding.end_time) {
          const start = new Date(feeding.start_time).getTime();
          const end = new Date(feeding.end_time).getTime();
          const duration = Math.max(0, end - start);
          return { ...feeding, duration };
        }
        return feeding;
      });

    await attachCreatedBy(db, feedings);
    return c.json({ feedings, total });
  } catch (error) {
    c.get('log').error('get feedings failed', { err: error });
    return c.json({ error: 'Failed to fetch feedings' }, 500);
  }
});

// Get a specific feeding
feedingRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const feedingId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this feeding
    const feedingResult = await db.execute({
      sql: `
      SELECT f.id, f.subject_id, f.start_time, f.end_time, f.duration, f.amount, f.amount_unit, f.type, f.side, f.left_breast_at, f.right_breast_at, f.left_duration, f.right_duration, f.formula_id, f.notes, f.created_at, f.created_by
      FROM feedings f
      JOIN subjects b ON f.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE f.id = ? AND uh.user_id = ?
    `,
      args: [feedingId, userId]
    });
    
    if (feedingResult.rows.length === 0) {
      return c.json({ error: 'Feeding not found or access denied' }, 404);
    }
    
    const feeding = feedingResult.rows[0] as unknown as FeedingRow;
    
    // Calculate duration if not already calculated
    if (!feeding.duration && feeding.start_time && feeding.end_time) {
      const start = new Date(feeding.start_time).getTime();
      const end = new Date(feeding.end_time).getTime();
      const duration = Math.max(0, end - start);
      Object.assign(feeding, { duration });
    }
    
    return c.json({ feeding });
  } catch (error) {
    c.get('log').error('get feeding failed', { err: error });
    return c.json({ error: 'Failed to fetch feeding' }, 500);
  }
});

// Create a new feeding
feedingRoutes.post('/', zValidator('json', createFeedingSchema), async (c) => {
  try {
    const { memberId, startTime, endTime, amount, amountUnit, type, side, leftBreastAt, rightBreastAt, leftDuration, rightDuration, formulaId, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    
    // Calculate duration if both start and end times are provided
    let duration = null;
    if (startTime && endTime) {
      const start = new Date(startTime).getTime();
      const end = new Date(endTime).getTime();
      duration = Math.max(0, end - start);
    }
    
    // Insert new feeding
    const result = await db.execute({
      sql: `
        INSERT INTO feedings (
          subject_id, start_time, end_time, duration, amount, amount_unit, type, side, left_breast_at, right_breast_at, left_duration, right_duration, formula_id, notes, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        scope.subjectId, 
        startTime, 
        endTime || null, 
        duration, 
        amount || null,
        amountUnit || 'oz',
        type, 
        side || null, 
        leftBreastAt || null,
        rightBreastAt || null,
        leftDuration ?? null,
        rightDuration ?? null,
        formulaId || null, 
        notes || null, 
        new Date().toISOString(),
        userId
      ]
    });
    
    // Return the created feeding
    const feedingResult = await db.execute({
      sql: `
      SELECT id, subject_id, start_time, end_time, duration, amount, amount_unit, type, side, left_breast_at, right_breast_at, left_duration, right_duration, formula_id, notes, created_at, created_by
      FROM feedings
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    return c.json({ 
      message: 'Feeding created successfully', 
      feeding: feedingResult.rows[0] 
    });
  } catch (error) {
    c.get('log').error('create feeding failed', { err: error });
    return c.json({ error: 'Failed to create feeding' }, 500);
  }
});

// Update a feeding
feedingRoutes.put('/:id{[0-9]+}', zValidator('json', updateFeedingSchema), async (c) => {
  try {
    const feedingId = parseInt(c.req.param('id'));
    const { startTime, endTime, amount, amountUnit, type, side, leftBreastAt, rightBreastAt, leftDuration, rightDuration, formulaId, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this feeding
    const feedingCheck = await db.execute({
      sql: `
      SELECT f.id, f.subject_id
      FROM feedings f
      JOIN subjects b ON f.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE f.id = ? AND uh.user_id = ?
    `,
      args: [feedingId, userId]
    });
    
    if (feedingCheck.rows.length === 0) {
      return c.json({ error: 'Feeding not found or access denied' }, 404);
    }
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (startTime !== undefined) {
      updates.push('start_time = ?');
      params.push(startTime);
    }
    
    if (endTime !== undefined) {
      updates.push('end_time = ?');
      params.push(endTime);
      
      // Recalculate duration if both start and end times are provided
      if (startTime !== undefined) {
        const start = new Date(startTime).getTime();
        const end = new Date(endTime).getTime();
        const duration = Math.max(0, end - start);
        updates.push('duration = ?');
        params.push(duration);
      } else {
        // If only end time is updated, get start time from the database
        const existingFeeding = await db.execute({
      sql: 'SELECT start_time FROM feedings WHERE id = ?',
      args: [feedingId]
    });
        
        const existingFeedingRow = existingFeeding.rows[0];
        if (existingFeedingRow && existingFeedingRow.start_time) {
          const start = new Date(existingFeedingRow.start_time as string).getTime();
          const end = new Date(endTime).getTime();
          const duration = Math.max(0, end - start);
          updates.push('duration = ?');
          params.push(duration);
        }
      }
    }
    
    if (amount !== undefined) {
      updates.push('amount = ?');
      params.push(amount);
    }
    
    if (amountUnit !== undefined) {
      updates.push('amount_unit = ?');
      params.push(amountUnit);
    }
    
    if (type !== undefined) {
      updates.push('type = ?');
      params.push(type);
    }
    
    if (side !== undefined) {
      updates.push('side = ?');
      params.push(side);
    }
    
    if (leftBreastAt !== undefined) {
      updates.push('left_breast_at = ?');
      params.push(leftBreastAt);
    }

    if (rightBreastAt !== undefined) {
      updates.push('right_breast_at = ?');
      params.push(rightBreastAt);
    }

    if (leftDuration !== undefined) {
      updates.push('left_duration = ?');
      params.push(leftDuration);
    }

    if (rightDuration !== undefined) {
      updates.push('right_duration = ?');
      params.push(rightDuration);
    }

    if (formulaId !== undefined) {
      updates.push('formula_id = ?');
      params.push(formulaId);
    }
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    params.push(feedingId); // For WHERE clause
    
    const query = `UPDATE feedings SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated feeding
    const updatedFeedingResult = await db.execute({
      sql: `
      SELECT id, subject_id, start_time, end_time, duration, amount, amount_unit, type, side, left_breast_at, right_breast_at, left_duration, right_duration, formula_id, notes, created_at, created_by
      FROM feedings
      WHERE id = ?
    `,
      args: [feedingId]
    });
    
    const feeding = updatedFeedingResult.rows[0] as unknown as FeedingRow;
    
    // Calculate duration if not already calculated
    if (!feeding.duration && feeding.start_time && feeding.end_time) {
      const start = new Date(feeding.start_time).getTime();
      const end = new Date(feeding.end_time).getTime();
      const duration = Math.max(0, end - start);
      Object.assign(feeding, { duration });
    }
    
    return c.json({ 
      message: 'Feeding updated successfully', 
      feeding 
    });
  } catch (error) {
    c.get('log').error('update feeding failed', { err: error });
    return c.json({ error: 'Failed to update feeding' }, 500);
  }
});

// Delete a feeding
feedingRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const feedingId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this feeding
    const feedingCheck = await db.execute({
      sql: `
      SELECT f.id
      FROM feedings f
      JOIN subjects b ON f.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE f.id = ? AND uh.user_id = ?
    `,
      args: [feedingId, userId]
    });
    
    if (feedingCheck.rows.length === 0) {
      return c.json({ error: 'Feeding not found or access denied' }, 404);
    }
    
    // Delete the feeding
    await db.execute({
      sql: 'DELETE FROM feedings WHERE id = ?',
      args: [feedingId]
    });
    
    return c.json({ message: 'Feeding deleted successfully' });
  } catch (error) {
    c.get('log').error('delete feeding failed', { err: error });
    return c.json({ error: 'Failed to delete feeding' }, 500);
  }
});

export { feedingRoutes };
