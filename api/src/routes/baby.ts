import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const babyRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createBabySchema = z.object({
  name: z.string().min(1),
  birthDate: z.string().datetime(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  householdId: z.number(),
});

const updateBabySchema = z.object({
  name: z.string().min(1).optional(),
  birthDate: z.string().datetime().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
});

// Get all babies for a household
babyRoutes.get('/', async (c) => {
  try {
    // In a real implementation, this would come from JWT middleware
    const userId = c.get('userId');
    const db = c.get('db');
    
    // First get the household ID for this user
    const householdResult = await db.execute({
      sql: `
        SELECT uh.household_id 
        FROM user_households uh 
        JOIN users u ON uh.user_id = u.id 
        WHERE u.id = ?
      `,
      args: [userId]
    });
    
    if (householdResult.rows.length === 0) {
      return c.json({ babies: [] }); // No household found
    }
    
    const householdRow = householdResult.rows[0];
    
    if (!householdRow) {
      return c.json({ babies: [] });
    }
    
    const householdId = Number(householdRow.household_id);
    
    // Get babies in the household
    const babiesResult = await db.execute({
      sql: `
        SELECT id, name, birth_date, gender, created_at, updated_at 
        FROM babies 
        WHERE household_id = ?
        ORDER BY created_at DESC
      `,
      args: [householdId]
    });
    
    return c.json({ babies: babiesResult.rows });
  } catch (error) {
    console.error('Get babies error:', error);
    return c.json({ error: 'Failed to fetch babies' }, 500);
  }
});

// Get a specific baby
babyRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const babyId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const babyResult = await db.execute({
      sql: `
        SELECT b.id, b.name, b.birth_date, b.gender, b.created_at, b.updated_at, h.id as household_id
        FROM babies b
        JOIN households h ON b.household_id = h.id
        JOIN user_households uh ON h.id = uh.household_id
        WHERE b.id = ? AND uh.user_id = ?
      `,
      args: [babyId, userId]
    });
    
    if (babyResult.rows.length === 0) {
      return c.json({ error: 'Baby not found or access denied' }, 404);
    }
    
    return c.json({ baby: babyResult.rows[0] });
  } catch (error) {
    console.error('Get baby error:', error);
    return c.json({ error: 'Failed to fetch baby' }, 500);
  }
});

// Create a new baby
babyRoutes.post('/', zValidator('json', createBabySchema), async (c) => {
  try {
    const { name, birthDate, gender, householdId } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this household
    const householdResult = await db.execute({
      sql: `
        SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ?
      `,
      args: [userId, householdId]
    });
    
    if (householdResult.rows.length === 0) {
      return c.json({ error: 'Access denied to household' }, 403);
    }
    
    // Insert new baby
    const result = await db.execute({
      sql: `
        INSERT INTO babies (name, birth_date, gender, household_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [name, birthDate, gender || null, householdId, new Date().toISOString(), new Date().toISOString()]
    });
    
    // Return the created baby
    const babyResult = await db.execute({
      sql: `
        SELECT id, name, birth_date, gender, created_at, updated_at 
        FROM babies 
        WHERE id = ?
      `,
      args: [Number(result.lastInsertRowid)]
    });
    
    return c.json({ 
      message: 'Baby created successfully', 
      baby: babyResult.rows[0] 
    });
  } catch (error) {
    console.error('Create baby error:', error);
    return c.json({ error: 'Failed to create baby' }, 500);
  }
});

// Update a baby
babyRoutes.put('/:id{[0-9]+}', zValidator('json', updateBabySchema), async (c) => {
  try {
    const babyId = parseInt(c.req.param('id'));
    const { name, birthDate, gender } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const babyResult = await db.execute({
      sql: `
        SELECT b.id, h.id as household_id
        FROM babies b
        JOIN households h ON b.household_id = h.id
        JOIN user_households uh ON h.id = uh.household_id
        WHERE b.id = ? AND uh.user_id = ?
      `,
      args: [babyId, userId]
    });
    
    if (babyResult.rows.length === 0) {
      return c.json({ error: 'Baby not found or access denied' }, 404);
    }
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    
    if (birthDate !== undefined) {
      updates.push('birth_date = ?');
      params.push(birthDate);
    }
    
    if (gender !== undefined) {
      updates.push('gender = ?');
      params.push(gender);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    // Add updated_at timestamp
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(babyId); // For WHERE clause
    
    const query = `UPDATE babies SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated baby
    const updatedBabyResult = await db.execute({
      sql: `
        SELECT id, name, birth_date, gender, created_at, updated_at 
        FROM babies 
        WHERE id = ?
      `,
      args: [babyId]
    });
    
    return c.json({ 
      message: 'Baby updated successfully', 
      baby: updatedBabyResult.rows[0] 
    });
  } catch (error) {
    console.error('Update baby error:', error);
    return c.json({ error: 'Failed to update baby' }, 500);
  }
});

export { babyRoutes };