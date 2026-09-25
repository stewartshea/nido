import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const vaccinationRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createVaccinationSchema = z.object({
  babyId: z.number(),
  name: z.string().min(1),
  dateGiven: z.string().datetime().optional(),
  nextDueDate: z.string().datetime().optional(),
  administeredBy: z.string().optional(),
  notes: z.string().optional(),
});

const updateVaccinationSchema = z.object({
  name: z.string().min(1).optional(),
  dateGiven: z.string().datetime().optional(),
  nextDueDate: z.string().datetime().optional(),
  administeredBy: z.string().optional(),
  notes: z.string().optional(),
});

// Get all vaccinations for a baby
vaccinationRoutes.get('/', async (c) => {
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
    
    // Get vaccinations for the baby
    const vaccinationsResult = await db.execute({
      sql: `
      SELECT id, baby_id, name, date_given, next_due_date, administered_by, notes, created_at
      FROM vaccinations
      WHERE baby_id = ?
      ORDER BY date_given DESC, next_due_date ASC
    `,
      args: [babyId]
    });
    
    return c.json({ vaccinations: vaccinationsResult.rows });
  } catch (error) {
    console.error('Get vaccinations error:', error);
    return c.json({ error: 'Failed to fetch vaccinations' }, 500);
  }
});

// Get a specific vaccination
vaccinationRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const vaccinationId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this vaccination
    const vaccinationResult = await db.execute({
      sql: `
      SELECT v.id, v.baby_id, v.name, v.date_given, v.next_due_date, v.administered_by, v.notes, v.created_at
      FROM vaccinations v
      JOIN babies b ON v.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE v.id = ? AND uh.user_id = ?
    `,
      args: [vaccinationId, userId]
    });
    
    if (vaccinationResult.rows.length === 0) {
      return c.json({ error: 'Vaccination not found or access denied' }, 404);
    }
    
    return c.json({ vaccination: vaccinationResult.rows[0] });
  } catch (error) {
    console.error('Get vaccination error:', error);
    return c.json({ error: 'Failed to fetch vaccination' }, 500);
  }
});

// Create a new vaccination
vaccinationRoutes.post('/', zValidator('json', createVaccinationSchema), async (c) => {
  try {
    const { babyId, name, dateGiven, nextDueDate, administeredBy, notes } = c.req.valid('json');
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
    
    // Insert new vaccination
    const result = await db.execute({
      sql: `
        INSERT INTO vaccinations (
          baby_id, name, date_given, next_due_date, administered_by, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        babyId, 
        name, 
        dateGiven || null, 
        nextDueDate || null, 
        administeredBy || null, 
        notes || null, 
        new Date().toISOString()
      ]
    });
    
    // Return the created vaccination
    const vaccinationResult = await db.execute({
      sql: `
      SELECT id, baby_id, name, date_given, next_due_date, administered_by, notes, created_at
      FROM vaccinations
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    return c.json({ 
      message: 'Vaccination recorded successfully', 
      vaccination: vaccinationResult.rows[0] 
    });
  } catch (error) {
    console.error('Create vaccination error:', error);
    return c.json({ error: 'Failed to record vaccination' }, 500);
  }
});

// Update a vaccination
vaccinationRoutes.put('/:id{[0-9]+}', zValidator('json', updateVaccinationSchema), async (c) => {
  try {
    const vaccinationId = parseInt(c.req.param('id'));
    const { name, dateGiven, nextDueDate, administeredBy, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this vaccination
    const vaccinationCheck = await db.execute({
      sql: `
      SELECT v.id, v.baby_id
      FROM vaccinations v
      JOIN babies b ON v.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE v.id = ? AND uh.user_id = ?
    `,
      args: [vaccinationId, userId]
    });
    
    if (vaccinationCheck.rows.length === 0) {
      return c.json({ error: 'Vaccination not found or access denied' }, 404);
    }
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    
    if (dateGiven !== undefined) {
      updates.push('date_given = ?');
      params.push(dateGiven);
    }
    
    if (nextDueDate !== undefined) {
      updates.push('next_due_date = ?');
      params.push(nextDueDate);
    }
    
    if (administeredBy !== undefined) {
      updates.push('administered_by = ?');
      params.push(administeredBy);
    }
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    params.push(vaccinationId); // For WHERE clause
    
    const query = `UPDATE vaccinations SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated vaccination
    const updatedVaccinationResult = await db.execute({
      sql: `
      SELECT id, baby_id, name, date_given, next_due_date, administered_by, notes, created_at
      FROM vaccinations
      WHERE id = ?
    `,
      args: [vaccinationId]
    });
    
    return c.json({ 
      message: 'Vaccination updated successfully', 
      vaccination: updatedVaccinationResult.rows[0] 
    });
  } catch (error) {
    console.error('Update vaccination error:', error);
    return c.json({ error: 'Failed to update vaccination' }, 500);
  }
});

// Delete a vaccination
vaccinationRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const vaccinationId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this vaccination
    const vaccinationCheck = await db.execute({
      sql: `
      SELECT v.id
      FROM vaccinations v
      JOIN babies b ON v.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE v.id = ? AND uh.user_id = ?
    `,
      args: [vaccinationId, userId]
    });
    
    if (vaccinationCheck.rows.length === 0) {
      return c.json({ error: 'Vaccination not found or access denied' }, 404);
    }
    
    // Delete the vaccination
    await db.execute({
      sql: 'DELETE FROM vaccinations WHERE id = ?',
      args: [vaccinationId]
    });
    
    return c.json({ message: 'Vaccination deleted successfully' });
  } catch (error) {
    console.error('Delete vaccination error:', error);
    return c.json({ error: 'Failed to delete vaccination' }, 500);
  }
});

// Get recommended vaccination schedule
vaccinationRoutes.get('/schedule', async (c) => {
  try {
    // Return standardized vaccination schedule (simplified for this example)
    const vaccinationSchedule = [
      {
        name: 'Hepatitis B',
        ages: ['birth', '1-2 months', '6-18 months'],
        description: 'Protects against hepatitis B virus infection',
        notes: 'Given in 3 doses'
      },
      {
        name: 'DTaP',
        ages: ['2 months', '4 months', '6 months', '15-18 months', '4-6 years'],
        description: 'Protects against diphtheria, tetanus, and pertussis',
        notes: 'Given in 5 doses'
      },
      {
        name: 'Hib',
        ages: ['2 months', '4 months', '6 months', '12-15 months'],
        description: 'Protects against Haemophilus influenzae type b',
        notes: 'Number of doses depends on product used'
      },
      {
        name: 'Polio (IPV)',
        ages: ['2 months', '4 months', '6-18 months', '4-6 years'],
        description: 'Protects against polio',
        notes: 'Given in 4 doses'
      },
      {
        name: 'PCV13',
        ages: ['2 months', '4 months', '6 months', '12-15 months'],
        description: 'Protects against pneumococcal disease',
        notes: 'Given in 4 doses'
      },
      {
        name: 'Rotavirus',
        ages: ['2 months', '4 months', '6 months'],
        description: 'Protects against rotavirus infection',
        notes: '2 or 3 doses depending on product'
      },
      {
        name: 'MMR',
        ages: ['12-15 months', '4-6 years'],
        description: 'Protects against measles, mumps, and rubella',
        notes: 'Given in 2 doses'
      },
      {
        name: 'Varicella',
        ages: ['12-15 months', '4-6 years'],
        description: 'Protects against chickenpox',
        notes: 'Given in 2 doses'
      }
    ];
    
    return c.json({ schedule: vaccinationSchedule });
  } catch (error) {
    console.error('Get vaccination schedule error:', error);
    return c.json({ error: 'Failed to fetch vaccination schedule' }, 500);
  }
});

export { vaccinationRoutes };