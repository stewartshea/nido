import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const milestoneRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createMilestoneSchema = z.object({
  memberId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  achievedDate: z.string().datetime(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  achievedDate: z.string().datetime().optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

// Get all milestones for a baby
milestoneRoutes.get('/', async (c) => {
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
    
    // Get milestones for the baby
    const milestonesResult = await db.execute({
      sql: `
      SELECT id, baby_id, title, description, achieved_date, category, tags, created_at
      FROM milestones
      WHERE baby_id = ?
    `,
      args: [memberId]
    });
    
    const milestonesSorted = [...milestonesResult.rows]
      .sort((a, b) => String(b.achieved_date ?? '').localeCompare(String(a.achieved_date ?? '')));
    
    return c.json({ milestones: milestonesSorted });
  } catch (error) {
    console.error('Get milestones error:', error);
    return c.json({ error: 'Failed to fetch milestones' }, 500);
  }
});

// Get a specific milestone
milestoneRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this milestone
    const milestoneResult = await db.execute({
      sql: `
      SELECT m.id, m.baby_id, m.title, m.description, m.achieved_date, m.category, m.created_at
      FROM milestones m
      JOIN babies b ON m.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE m.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    });
    
    if (milestoneResult.rows.length === 0) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }
    
    return c.json({ milestone: milestoneResult.rows[0] });
  } catch (error) {
    console.error('Get milestone error:', error);
    return c.json({ error: 'Failed to fetch milestone' }, 500);
  }
});

// Create a new milestone
milestoneRoutes.post('/', zValidator('json', createMilestoneSchema), async (c) => {
  try {
    const { memberId, title, description, achievedDate, category, tags } = c.req.valid('json');
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
    
    const tagsJson = tags?.length ? JSON.stringify(tags) : null;

    // Insert new milestone
    const result = await db.execute({
      sql: `
        INSERT INTO milestones (
          baby_id, title, description, achieved_date, category, tags, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        memberId, 
        title, 
        description || null, 
        achievedDate, 
        category || null,
        tagsJson,
        new Date().toISOString()
      ]
    });
    
    // Return the created milestone
    const milestoneResult = await db.execute({
      sql: `
      SELECT id, baby_id, title, description, achieved_date, category, created_at
      FROM milestones
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    return c.json({ 
      message: 'Milestone recorded successfully', 
      milestone: milestoneResult.rows[0] 
    });
  } catch (error) {
    console.error('Create milestone error:', error);
    return c.json({ error: 'Failed to record milestone' }, 500);
  }
});

// Update a milestone
milestoneRoutes.put('/:id{[0-9]+}', zValidator('json', updateMilestoneSchema), async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const { title, description, achievedDate, category, tags } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this milestone
    const milestoneCheck = await db.execute({
      sql: `
      SELECT m.id, m.baby_id
      FROM milestones m
      JOIN babies b ON m.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE m.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    });
    
    if (milestoneCheck.rows.length === 0) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    
    if (achievedDate !== undefined) {
      updates.push('achieved_date = ?');
      params.push(achievedDate);
    }
    
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }

    if (tags !== undefined) {
      updates.push('tags = ?');
      params.push(tags.length ? JSON.stringify(tags) : null);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    params.push(milestoneId); // For WHERE clause
    
    const query = `UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated milestone
    const updatedMilestoneResult = await db.execute({
      sql: `
      SELECT id, baby_id, title, description, achieved_date, category, created_at
      FROM milestones
      WHERE id = ?
    `,
      args: [milestoneId]
    });
    
    return c.json({ 
      message: 'Milestone updated successfully', 
      milestone: updatedMilestoneResult.rows[0] 
    });
  } catch (error) {
    console.error('Update milestone error:', error);
    return c.json({ error: 'Failed to update milestone' }, 500);
  }
});

// Delete a milestone
milestoneRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const milestoneId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this milestone
    const milestoneCheck = await db.execute({
      sql: `
      SELECT m.id
      FROM milestones m
      JOIN babies b ON m.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE m.id = ? AND uh.user_id = ?
    `,
      args: [milestoneId, userId]
    });
    
    if (milestoneCheck.rows.length === 0) {
      return c.json({ error: 'Milestone not found or access denied' }, 404);
    }
    
    // Delete the milestone
    await db.execute({
      sql: 'DELETE FROM milestones WHERE id = ?',
      args: [milestoneId]
    });
    
    return c.json({ message: 'Milestone deleted successfully' });
  } catch (error) {
    console.error('Delete milestone error:', error);
    return c.json({ error: 'Failed to delete milestone' }, 500);
  }
});

milestoneRoutes.get('/categories', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');

    const res = await db.execute({
      sql: `
      SELECT DISTINCT category FROM milestones m
      JOIN babies b ON m.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE uh.user_id = ? AND m.category IS NOT NULL AND trim(m.category) <> ''
      ORDER BY category
    `,
      args: [userId],
    });
    const categories = res.rows.map((r: any) => ({
      id: String(r.category),
      name: String(r.category).charAt(0).toUpperCase() + String(r.category).slice(1),
    }));
    return c.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
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

    const memberCheck = await db.execute({
      sql: `
      SELECT b.id FROM babies b
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE b.id = ? AND uh.user_id = ?
    `,
      args: [memberId, userId],
    });
    if (memberCheck.rows.length === 0) return c.json({ error: 'Member not found or access denied' }, 404);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let sql = 'SELECT category, COUNT(*) as count FROM milestones WHERE baby_id = ? AND achieved_date >= ?';
    const args: any[] = [memberId, since];
    if (category) { sql += ' AND category = ?'; args.push(category); }
    sql += ' GROUP BY category ORDER BY count DESC';

    const res = await db.execute({ sql, args });
    const trends = res.rows.map((r: any) => ({
      category: String(r.category || 'uncategorized'),
      count: Number(r.count || 0),
    }));

    const total = trends.reduce((s, t) => s + t.count, 0);
    return c.json({ trends, total, days, memberId, since });
  } catch (error) {
    console.error('Get trends error:', error);
    return c.json({ error: 'Failed to fetch trends' }, 500);
  }
});

export { milestoneRoutes };