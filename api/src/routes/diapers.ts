import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
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
    
    // Verify user has access to this baby
    const memberCheck = await db.execute({
      sql: `
      SELECT b.id
      FROM babies b
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE b.id = ? AND uh.user_id = ?
    `,
      args: [memberId, userId]
    });
    
    if (memberCheck.rows.length === 0) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    
    // Get diapers for the baby
    const diapersResult = await db.execute({
      sql: `
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at
      FROM diapers
      WHERE baby_id = ?
      LIMIT 100
    `,
      args: [memberId]
    });
    
    const diapersSorted = [...diapersResult.rows]
      .sort((a, b) => String(b.change_time ?? '').localeCompare(String(a.change_time ?? '')))
      .slice(0, 100);
    
    return c.json({ diapers: diapersSorted });
  } catch (error) {
    console.error('Get diapers error:', error);
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
      SELECT d.id, d.baby_id, d.change_time, d.type, d.color, d.consistency, d.notes, d.created_at
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
    console.error('Get diaper error:', error);
    return c.json({ error: 'Failed to fetch diaper' }, 500);
  }
});

// Create a new diaper
diaperRoutes.post('/', zValidator('json', createDiaperSchema), async (c) => {
  try {
    const { memberId, changeTime, type, color, consistency, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const memberCheck = await db.execute({
      sql: `
      SELECT b.id
      FROM babies b
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE b.id = ? AND uh.user_id = ?
    `,
      args: [memberId, userId]
    });
    
    if (memberCheck.rows.length === 0) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    
    // Insert new diaper
    const result = await db.execute({
      sql: `
        INSERT INTO diapers (
          baby_id, change_time, type, color, consistency, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        memberId, 
        changeTime, 
        type, 
        color || null, 
        consistency || null, 
        notes || null, 
        new Date().toISOString()
      ]
    });
    
    // Return the created diaper
    const diaperResult = await db.execute({
      sql: `
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at
      FROM diapers
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    return c.json({ 
      message: 'Diaper recorded successfully', 
      diaper: diaperResult.rows[0] 
    });
  } catch (error) {
    console.error('Create diaper error:', error);
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
      SELECT id, baby_id, change_time, type, color, consistency, notes, created_at
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
    console.error('Update diaper error:', error);
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
    console.error('Delete diaper error:', error);
    return c.json({ error: 'Failed to delete diaper' }, 500);
  }
});

export { diaperRoutes };