import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { SleepRow } from '../db-types';
import { type AuthEnv } from '../auth';

const sleepRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createSleepSchema = z.object({
  babyId: z.number(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const updateSleepSchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

// Get all sleep records for a baby
sleepRoutes.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    const babyId = parseInt(c.req.query('babyId') || '0');
    
    if (!babyId) {
      return c.json({ error: 'Baby ID is required' }, 400);
    }
    
    // Verify user has access to this baby
    const babyCheck = await db.execute({
      sql: `
      SELECT b.id
      FROM babies b
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE b.id = ? AND uh.user_id = ?
    `,
      args: [babyId, userId]
    });
    
    if (babyCheck.rows.length === 0) {
      return c.json({ error: 'Baby not found or access denied' }, 404);
    }
    
    // Get sleep records for the baby
    const sleepResult = await db.execute({
      sql: `
      SELECT id, baby_id, start_time, end_time, duration, location, notes, created_at
      FROM sleep
      WHERE baby_id = ?
      LIMIT 100
    `,
      args: [babyId]
    });
    
    // Calculate duration if not already calculated
    const sleepRecords = (sleepResult.rows as unknown as SleepRow[])
      .map(record => {
        if (!record.duration && record.start_time && record.end_time) {
          const start = new Date(record.start_time).getTime();
          const end = new Date(record.end_time).getTime();
          const duration = Math.max(0, end - start);
          return { ...record, duration };
        }
        return record;
      })
      .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
      .slice(0, 100);
    
    return c.json({ sleep: sleepRecords });
  } catch (error) {
    console.error('Get sleep records error:', error);
    return c.json({ error: 'Failed to fetch sleep records' }, 500);
  }
});

// Get a specific sleep record
sleepRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const sleepId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this sleep record
    const sleepResult = await db.execute({
      sql: `
      SELECT s.id, s.baby_id, s.start_time, s.end_time, s.duration, s.location, s.notes, s.created_at
      FROM sleep s
      JOIN babies b ON s.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE s.id = ? AND uh.user_id = ?
    `,
      args: [sleepId, userId]
    });
    
    if (sleepResult.rows.length === 0) {
      return c.json({ error: 'Sleep record not found or access denied' }, 404);
    }
    
    const sleepRecord = sleepResult.rows[0] as unknown as SleepRow;
    
    // Calculate duration if not already calculated
    if (!sleepRecord.duration && sleepRecord.start_time && sleepRecord.end_time) {
      const start = new Date(sleepRecord.start_time).getTime();
      const end = new Date(sleepRecord.end_time).getTime();
      const duration = Math.max(0, end - start);
      Object.assign(sleepRecord, { duration });
    }
    
    return c.json({ sleep: sleepRecord });
  } catch (error) {
    console.error('Get sleep record error:', error);
    return c.json({ error: 'Failed to fetch sleep record' }, 500);
  }
});

// Create a new sleep record
sleepRoutes.post('/', zValidator('json', createSleepSchema), async (c) => {
  try {
    const { babyId, startTime, endTime, location, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const babyCheck = await db.execute({
      sql: `
      SELECT b.id
      FROM babies b
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE b.id = ? AND uh.user_id = ?
    `,
      args: [babyId, userId]
    });
    
    if (babyCheck.rows.length === 0) {
      return c.json({ error: 'Baby not found or access denied' }, 404);
    }
    
    // Calculate duration if both start and end times are provided
    let duration = null;
    if (startTime && endTime) {
      const start = new Date(startTime).getTime();
      const end = new Date(endTime).getTime();
      duration = Math.max(0, end - start);
    }
    
    // Insert new sleep record
    const result = await db.execute({
      sql: `
        INSERT INTO sleep (
          baby_id, start_time, end_time, duration, location, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        babyId, 
        startTime, 
        endTime || null, 
        duration, 
        location || null, 
        notes || null, 
        new Date().toISOString()
      ]
    });
    
    // Return the created sleep record
    const sleepResult = await db.execute({
      sql: `
      SELECT id, baby_id, start_time, end_time, duration, location, notes, created_at
      FROM sleep
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    const sleepRecord = sleepResult.rows[0] as unknown as SleepRow;
    
    // Calculate duration if not already calculated
    if (!sleepRecord.duration && sleepRecord.start_time && sleepRecord.end_time) {
      const start = new Date(sleepRecord.start_time).getTime();
      const end = new Date(sleepRecord.end_time).getTime();
      const duration = Math.max(0, end - start);
      Object.assign(sleepRecord, { duration });
    }
    
    return c.json({ 
      message: 'Sleep record created successfully', 
      sleep: sleepRecord 
    });
  } catch (error) {
    console.error('Create sleep record error:', error);
    return c.json({ error: 'Failed to create sleep record' }, 500);
  }
});

// Update a sleep record
sleepRoutes.put('/:id{[0-9]+}', zValidator('json', updateSleepSchema), async (c) => {
  try {
    const sleepId = parseInt(c.req.param('id'));
    const { startTime, endTime, location, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this sleep record
    const sleepCheck = await db.execute({
      sql: `
      SELECT s.id, s.baby_id
      FROM sleep s
      JOIN babies b ON s.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE s.id = ? AND uh.user_id = ?
    `,
      args: [sleepId, userId]
    });
    
    if (sleepCheck.rows.length === 0) {
      return c.json({ error: 'Sleep record not found or access denied' }, 404);
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
        const existingSleep = await db.execute({
      sql: 'SELECT start_time FROM sleep WHERE id = ?',
      args: [sleepId]
    });
        
        const existingSleepRow = existingSleep.rows[0];
        if (existingSleepRow && existingSleepRow.start_time) {
          const start = new Date(existingSleepRow.start_time as string).getTime();
          const end = new Date(endTime).getTime();
          const duration = Math.max(0, end - start);
          updates.push('duration = ?');
          params.push(duration);
        }
      }
    }
    
    if (location !== undefined) {
      updates.push('location = ?');
      params.push(location);
    }
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    params.push(sleepId); // For WHERE clause
    
    const query = `UPDATE sleep SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated sleep record
    const updatedSleepResult = await db.execute({
      sql: `
      SELECT id, baby_id, start_time, end_time, duration, location, notes, created_at
      FROM sleep
      WHERE id = ?
    `,
      args: [sleepId]
    });
    
    const sleepRecord = updatedSleepResult.rows[0] as unknown as SleepRow;
    
    // Calculate duration if not already calculated
    if (!sleepRecord.duration && sleepRecord.start_time && sleepRecord.end_time) {
      const start = new Date(sleepRecord.start_time).getTime();
      const end = new Date(sleepRecord.end_time).getTime();
      const duration = Math.max(0, end - start);
      Object.assign(sleepRecord, { duration });
    }
    
    return c.json({ 
      message: 'Sleep record updated successfully', 
      sleep: sleepRecord 
    });
  } catch (error) {
    console.error('Update sleep record error:', error);
    return c.json({ error: 'Failed to update sleep record' }, 500);
  }
});

// Delete a sleep record
sleepRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const sleepId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this sleep record
    const sleepCheck = await db.execute({
      sql: `
      SELECT s.id
      FROM sleep s
      JOIN babies b ON s.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE s.id = ? AND uh.user_id = ?
    `,
      args: [sleepId, userId]
    });
    
    if (sleepCheck.rows.length === 0) {
      return c.json({ error: 'Sleep record not found or access denied' }, 404);
    }
    
    // Delete the sleep record
    await db.execute({
      sql: 'DELETE FROM sleep WHERE id = ?',
      args: [sleepId]
    });
    
    return c.json({ message: 'Sleep record deleted successfully' });
  } catch (error) {
    console.error('Delete sleep record error:', error);
    return c.json({ error: 'Failed to delete sleep record' }, 500);
  }
});

export { sleepRoutes };