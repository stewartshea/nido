import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const milestoneRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createMilestoneSchema = z.object({
  babyId: z.number(),
  title: z.string().min(1),
  description: z.string().optional(),
  achievedDate: z.string().datetime(),
  category: z.enum([
    'motor', 'cognitive', 'social', 'emotional', 'communication', 
    'physical', 'behavioral', 'sensory', 'other'
  ]).optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  achievedDate: z.string().datetime().optional(),
  category: z.enum([
    'motor', 'cognitive', 'social', 'emotional', 'communication', 
    'physical', 'behavioral', 'sensory', 'other'
  ]).optional(),
});

// Get all milestones for a baby
milestoneRoutes.get('/', async (c) => {
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
    
    // Get milestones for the baby
    const milestonesResult = await db.execute({
      sql: `
      SELECT id, baby_id, title, description, achieved_date, category, created_at
      FROM milestones
      WHERE baby_id = ?
    `,
      args: [babyId]
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
    const { babyId, title, description, achievedDate, category } = c.req.valid('json');
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
    
    // Insert new milestone
    const result = await db.execute({
      sql: `
        INSERT INTO milestones (
          baby_id, title, description, achieved_date, category, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        babyId, 
        title, 
        description || null, 
        achievedDate, 
        category || null, 
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
    const { title, description, achievedDate, category } = c.req.valid('json');
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

// Get milestone categories
milestoneRoutes.get('/categories', async (c) => {
  try {
    // Return predefined milestone categories
    const categories = [
      { id: 'motor', name: 'Motor Skills', description: 'Physical movement and coordination milestones' },
      { id: 'cognitive', name: 'Cognitive', description: 'Thinking, learning, and problem-solving milestones' },
      { id: 'social', name: 'Social', description: 'Interacting with others and social awareness' },
      { id: 'emotional', name: 'Emotional', description: 'Emotional regulation and expression' },
      { id: 'communication', name: 'Communication', description: 'Speaking, listening, and understanding' },
      { id: 'physical', name: 'Physical', description: 'Growth and physical development' },
      { id: 'behavioral', name: 'Behavioral', description: 'Behavior patterns and habits' },
      { id: 'sensory', name: 'Sensory', description: 'Processing sensory information' },
      { id: 'other', name: 'Other', description: 'Other developmental milestones' }
    ];
    
    return c.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    return c.json({ error: 'Failed to fetch milestone categories' }, 500);
  }
});

export { milestoneRoutes };