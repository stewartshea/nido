import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';
import { type AuthEnv } from '../auth';

const diaperRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createDiaperSchema = z.object({
  memberId: z.number(),
  changeTime: z.string().datetime(),
  type: z.enum(['wet', 'dirty', 'both', 'dry']),
  color: z.string().optional(), // For solid waste
  consistency: z.string().optional(), // Loose, formed, etc.
  notes: z.string().optional(),
});

const updateDiaperSchema = z.object({
  changeTime: z.string().datetime().optional(),
  type: z.enum(['wet', 'dirty', 'both', 'dry']).optional(),
  color: z.string().optional(),
  consistency: z.string().optional(),
  notes: z.string().optional(),
});

// Get all diapers for a baby
diaperRoutes.get('/', async (c) => {
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
    const babyId = scope.babyId;
    
    // Get diapers for the baby
    const { limit, offset } = parsePaging((k) => c.req.query(k));

    const diapersResult = await db.execute({
      sql: `
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at, created_by
      FROM diapers
      WHERE baby_id = ?
      ORDER BY change_time DESC, id DESC
      LIMIT ? OFFSET ?
    `,
      args: [babyId, limit, offset]
    });
    const total = await countMatching(db, 'diapers', [babyId]);

    const diapers = diapersResult.rows as any[];

    await attachCreatedBy(db, diapers);
    return c.json({ diapers, total });
  } catch (error) {
    c.get('log').error('get diapers failed', { err: error });
    return c.json({ error: 'Failed to fetch diapers' }, 500);
  }
});

// Get a specific diaper
diaperRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const diaperId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this diaper
    const diaperResult = await db.execute({
      sql: `
      SELECT d.id, d.baby_id, d.change_time, d.type, d.color, d.consistency, d.notes, d.created_at, d.created_by
      FROM diapers d
      JOIN babies b ON d.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE d.id = ? AND uh.user_id = ?
    `,
      args: [diaperId, userId]
    });
    
    if (diaperResult.rows.length === 0) {
      return c.json({ error: 'Diaper not found or access denied' }, 404);
    }
    
    return c.json({ diaper: diaperResult.rows[0] });
  } catch (error) {
    c.get('log').error('get diaper failed', { err: error });
    return c.json({ error: 'Failed to fetch diaper' }, 500);
  }
});

// Create a new diaper
diaperRoutes.post('/', zValidator('json', createDiaperSchema), async (c) => {
  try {
    const { memberId, changeTime, type, color, consistency, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    const babyId = scope.babyId;
    
    // Insert new diaper
    const result = await db.execute({
      sql: `
        INSERT INTO diapers (
          baby_id, change_time, type, color, consistency, notes, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        babyId, 
        changeTime, 
        type, 
        color || null, 
        consistency || null, 
        notes || null, 
        new Date().toISOString(),
        userId
      ]
    });
    
    // A logged change is also a unit consumed. Decrement here so every client
    // path benefits; the ledger insert is idempotent per diaper id, so a retry
    // cannot count the same change twice.
    const diaperId = Number(result.lastInsertRowid);
    try {
      const linked = await db.execute({
        sql: `SELECT id, decrement_per_event FROM inventory_items
              WHERE active = 1 AND event_category = 'diapers' AND baby_id = ?`,
        args: [babyId],
      });
      for (const item of linked.rows as any[]) {
        const per = item.decrement_per_event === null || item.decrement_per_event === undefined ? 1 : Number(item.decrement_per_event);
        try {
          await db.execute({
            sql: `INSERT INTO inventory_adjustments (item_id, change, reason, ref_table, ref_id, created_by, created_at)
                  VALUES (?, ?, 'used', 'diapers', ?, ?, ?)`,
            args: [item.id, -per, diaperId, userId, new Date().toISOString()],
          });
        } catch {
          continue;
        }
        await db.execute({
          sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?',
          args: [per, new Date().toISOString(), item.id],
        });
      }
    } catch (err: any) {
      // The diaper itself is already stored. Failing the request here would
      // report a lost record that was in fact saved.
      c.get('log').warn('inventory decrement failed', { err });
    }

    // Return the created diaper
    const diaperResult = await db.execute({
      sql: `
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at, created_by
      FROM diapers
      WHERE id = ?
    `,
      args: [diaperId]
    });
    
    return c.json({ 
      message: 'Diaper recorded successfully', 
      diaper: diaperResult.rows[0] 
    });
  } catch (error) {
    c.get('log').error('create diaper failed', { err: error });
    return c.json({ error: 'Failed to record diaper' }, 500);
  }
});

// Update a diaper
diaperRoutes.put('/:id{[0-9]+}', zValidator('json', updateDiaperSchema), async (c) => {
  try {
    const diaperId = parseInt(c.req.param('id'));
    const { changeTime, type, color, consistency, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this diaper
    const diaperCheck = await db.execute({
      sql: `
      SELECT d.id, d.baby_id
      FROM diapers d
      JOIN babies b ON d.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE d.id = ? AND uh.user_id = ?
    `,
      args: [diaperId, userId]
    });
    
    if (diaperCheck.rows.length === 0) {
      return c.json({ error: 'Diaper not found or access denied' }, 404);
    }
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (changeTime !== undefined) {
      updates.push('change_time = ?');
      params.push(changeTime);
    }
    
    if (type !== undefined) {
      updates.push('type = ?');
      params.push(type);
    }
    
    if (color !== undefined) {
      updates.push('color = ?');
      params.push(color);
    }
    
    if (consistency !== undefined) {
      updates.push('consistency = ?');
      params.push(consistency);
    }
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    params.push(diaperId); // For WHERE clause
    
    const query = `UPDATE diapers SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated diaper
    const updatedDiaperResult = await db.execute({
      sql: `
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at, created_by
      FROM diapers
      WHERE id = ?
    `,
      args: [diaperId]
    });
    
    return c.json({ 
      message: 'Diaper updated successfully', 
      diaper: updatedDiaperResult.rows[0] 
    });
  } catch (error) {
    c.get('log').error('update diaper failed', { err: error });
    return c.json({ error: 'Failed to update diaper' }, 500);
  }
});

// Delete a diaper
diaperRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const diaperId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this diaper
    const diaperCheck = await db.execute({
      sql: `
      SELECT d.id
      FROM diapers d
      JOIN babies b ON d.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE d.id = ? AND uh.user_id = ?
    `,
      args: [diaperId, userId]
    });
    
    if (diaperCheck.rows.length === 0) {
      return c.json({ error: 'Diaper not found or access denied' }, 404);
    }
    
    // Delete the diaper
    await db.execute({
      sql: 'DELETE FROM diapers WHERE id = ?',
      args: [diaperId]
    });
    
    return c.json({ message: 'Diaper deleted successfully' });
  } catch (error) {
    c.get('log').error('delete diaper failed', { err: error });
    return c.json({ error: 'Failed to delete diaper' }, 500);
  }
});

export { diaperRoutes };