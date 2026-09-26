import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import type { BabyRow, GrowthRow, GrowthWithBabyRow } from '../db-types';

const growthRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const createGrowthSchema = z.object({
  memberId: z.number(),
  measurementDate: z.string().datetime(),
  weight: z.number().positive().optional(), // in lbs or kg
  height: z.number().positive().optional(), // in inches or cm
  headCircumference: z.number().positive().optional(), // in inches or cm
  bmi: z.number().positive().optional(),
  unitSystem: z.enum(['imperial', 'metric']).default('imperial'),
  notes: z.string().optional(),
});

const updateGrowthSchema = z.object({
  measurementDate: z.string().datetime().optional(),
  weight: z.number().positive().optional(),
  height: z.number().positive().optional(),
  headCircumference: z.number().positive().optional(),
  bmi: z.number().positive().optional(),
  unitSystem: z.enum(['imperial', 'metric']).optional(),
  notes: z.string().optional(),
});

// WHO/CDC Growth Standards Data (simplified for this example)
const WHO_STANDARDS = {
  weight_for_age: {
    male: [
      { age_weeks: 0, p3: 2.6, p15: 2.9, p50: 3.3, p85: 3.8, p97: 4.4 },
      { age_weeks: 2, p3: 3.3, p15: 3.7, p50: 4.1, p85: 4.6, p97: 5.2 },
      { age_weeks: 4, p3: 4.0, p15: 4.4, p50: 4.9, p85: 5.5, p97: 6.2 },
      { age_weeks: 8, p3: 5.1, p15: 5.6, p50: 6.2, p85: 6.9, p97: 7.8 },
      { age_weeks: 12, p3: 5.8, p15: 6.4, p50: 7.0, p85: 7.8, p97: 8.8 },
      { age_weeks: 16, p3: 6.3, p15: 6.9, p50: 7.6, p85: 8.5, p97: 9.5 },
      { age_weeks: 20, p3: 6.7, p15: 7.3, p50: 8.0, p85: 8.9, p97: 10.0 },
      { age_weeks: 24, p3: 7.0, p15: 7.6, p50: 8.3, p85: 9.3, p97: 10.4 },
      { age_weeks: 28, p3: 7.2, p15: 7.9, p50: 8.6, p85: 9.6, p97: 10.8 },
      { age_weeks: 32, p3: 7.4, p15: 8.1, p50: 8.9, p85: 9.9, p97: 11.1 },
      { age_weeks: 36, p3: 7.6, p15: 8.3, p50: 9.1, p85: 10.2, p97: 11.4 },
      { age_weeks: 40, p3: 7.7, p15: 8.5, p50: 9.3, p85: 10.4, p97: 11.6 },
      { age_weeks: 44, p3: 7.9, p15: 8.6, p50: 9.5, p85: 10.6, p97: 11.8 },
      { age_weeks: 48, p3: 8.0, p15: 8.7, p50: 9.6, p85: 10.7, p97: 12.0 },
    ],
    female: [
      { age_weeks: 0, p3: 2.5, p15: 2.8, p50: 3.2, p85: 3.7, p97: 4.2 },
      { age_weeks: 2, p3: 3.2, p15: 3.5, p50: 3.9, p85: 4.4, p97: 5.0 },
      { age_weeks: 4, p3: 3.8, p15: 4.2, p50: 4.7, p85: 5.2, p97: 5.9 },
      { age_weeks: 8, p3: 4.8, p15: 5.3, p50: 5.9, p85: 6.6, p97: 7.4 },
      { age_weeks: 12, p3: 5.4, p15: 5.9, p50: 6.6, p85: 7.3, p97: 8.2 },
      { age_weeks: 16, p3: 5.9, p15: 6.4, p50: 7.1, p85: 7.9, p97: 8.8 },
      { age_weeks: 20, p3: 6.2, p15: 6.8, p50: 7.5, p85: 8.4, p97: 9.4 },
      { age_weeks: 24, p3: 6.5, p15: 7.1, p50: 7.8, p85: 8.7, p97: 9.7 },
      { age_weeks: 28, p3: 6.7, p15: 7.3, p50: 8.1, p85: 9.0, p97: 10.1 },
      { age_weeks: 32, p3: 6.9, p15: 7.5, p50: 8.3, p85: 9.3, p97: 10.4 },
      { age_weeks: 36, p3: 7.0, p15: 7.7, p50: 8.5, p85: 9.5, p97: 10.6 },
      { age_weeks: 40, p3: 7.2, p15: 7.8, p50: 8.6, p85: 9.7, p97: 10.8 },
      { age_weeks: 44, p3: 7.3, p15: 7.9, p50: 8.8, p85: 9.8, p97: 11.0 },
      { age_weeks: 48, p3: 7.4, p15: 8.0, p50: 8.9, p85: 10.0, p97: 11.1 },
    ]
  },
  height_for_age: {
    male: [
      { age_weeks: 0, p3: 45.6, p15: 47.2, p50: 48.7, p85: 50.2, p97: 51.8 },
      { age_weeks: 2, p3: 48.2, p15: 49.8, p50: 51.3, p85: 52.8, p97: 54.4 },
      { age_weeks: 4, p3: 50.5, p15: 52.1, p50: 53.6, p85: 55.1, p97: 56.7 },
      { age_weeks: 8, p3: 54.6, p15: 56.2, p50: 57.7, p85: 59.2, p97: 60.8 },
      { age_weeks: 12, p3: 57.1, p15: 58.7, p50: 60.2, p85: 61.7, p97: 63.3 },
      { age_weeks: 16, p3: 59.0, p15: 60.6, p50: 62.1, p85: 63.6, p97: 65.2 },
      { age_weeks: 20, p3: 60.6, p15: 62.2, p50: 63.7, p85: 65.2, p97: 66.8 },
      { age_weeks: 24, p3: 62.0, p15: 63.6, p50: 65.1, p85: 66.6, p97: 68.2 },
      { age_weeks: 28, p3: 63.3, p15: 64.9, p50: 66.4, p85: 67.9, p97: 69.5 },
      { age_weeks: 32, p3: 64.5, p15: 66.1, p50: 67.6, p85: 69.1, p97: 70.7 },
      { age_weeks: 36, p3: 65.6, p15: 67.2, p50: 68.7, p85: 70.2, p97: 71.8 },
      { age_weeks: 40, p3: 66.7, p15: 68.3, p50: 69.8, p85: 71.3, p97: 72.9 },
      { age_weeks: 44, p3: 67.7, p15: 69.3, p50: 70.8, p85: 72.3, p97: 73.9 },
      { age_weeks: 48, p3: 68.7, p15: 70.3, p50: 71.8, p85: 73.3, p97: 74.9 },
    ],
    female: [
      { age_weeks: 0, p3: 45.1, p15: 46.7, p50: 48.2, p85: 49.7, p97: 51.3 },
      { age_weeks: 2, p3: 47.7, p15: 49.3, p50: 50.8, p85: 52.3, p97: 53.9 },
      { age_weeks: 4, p3: 50.0, p15: 51.6, p50: 53.1, p85: 54.6, p97: 56.2 },
      { age_weeks: 8, p3: 54.0, p15: 55.6, p50: 57.1, p85: 58.6, p97: 60.2 },
      { age_weeks: 12, p3: 56.5, p15: 58.1, p50: 59.6, p85: 61.1, p97: 62.7 },
      { age_weeks: 16, p3: 58.4, p15: 60.0, p50: 61.5, p85: 63.0, p97: 64.6 },
      { age_weeks: 20, p3: 59.9, p15: 61.5, p50: 63.0, p85: 64.5, p97: 66.1 },
      { age_weeks: 24, p3: 61.3, p15: 62.9, p50: 64.4, p85: 65.9, p97: 67.5 },
      { age_weeks: 28, p3: 62.5, p15: 64.1, p50: 65.6, p85: 67.1, p97: 68.7 },
      { age_weeks: 32, p3: 63.7, p15: 65.3, p50: 66.8, p85: 68.3, p97: 69.9 },
      { age_weeks: 36, p3: 64.7, p15: 66.3, p50: 67.8, p85: 69.3, p97: 70.9 },
      { age_weeks: 40, p3: 65.7, p15: 67.3, p50: 68.8, p85: 70.3, p97: 71.9 },
      { age_weeks: 44, p3: 66.7, p15: 68.3, p50: 69.8, p85: 71.3, p97: 72.9 },
      { age_weeks: 48, p3: 67.6, p15: 69.2, p50: 70.7, p85: 72.2, p97: 73.8 },
    ]
  }
};

// Helper function to calculate age in weeks from birth date
function calculateAgeInWeeks(birthDate: string, measurementDate: string): number {
  const birth = new Date(birthDate);
  const measurement = new Date(measurementDate);
  const diffTime = Math.abs(measurement.getTime() - birth.getTime());
  const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
  return diffWeeks;
}

// Helper function to find percentile for a measurement
function findPercentile(value: number, standardData: Array<{age_weeks: number, p3: number, p15: number, p50: number, p85: number, p97: number}>): number {
  if (standardData.length === 0) return 50;
  
  let closestData = standardData[0];
  if (!closestData) return 50;
  
  let minDiff = Math.abs(closestData.age_weeks - 0);
  
  for (const data of standardData) {
    if (Math.abs(data.age_weeks) < minDiff) {
      minDiff = Math.abs(data.age_weeks);
      closestData = data;
    }
  }
  
  // Simple interpolation to find approximate percentile
  if (value <= closestData.p3) return 3;
  if (value <= closestData.p15) return 15;
  if (value <= closestData.p50) return 50;
  if (value <= closestData.p85) return 85;
  if (value <= closestData.p97) return 97;
  return 99; // Above 97th percentile
}

// Get all growth records for a baby with WHO/CDC comparisons
growthRoutes.get('/', async (c) => {
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
      SELECT b.id, b.birth_date, b.gender
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
    
    const baby = memberCheck.rows[0] as unknown as BabyRow;
    
    // Get growth records for the baby
    const growthResult = await db.execute({
      sql: `
      SELECT id, baby_id, measurement_date, weight, height, head_circumference, bmi, unit_system, notes, created_at
      FROM growth
      WHERE baby_id = ?
      LIMIT 100
    `,
      args: [memberId]
    });
    
    // Calculate WHO/CDC comparisons for each record
    const growthWithComparisons = (growthResult.rows as unknown as GrowthRow[])
      .map(record => {
      const ageInWeeks = calculateAgeInWeeks(baby.birth_date, record.measurement_date);
      const gender = baby.gender || 'male'; // Default to male if not specified
      
      let weightPercentile = null;
      let heightPercentile = null;
      
      if (record.weight) {
        const weightStandard = WHO_STANDARDS.weight_for_age[gender as 'male' | 'female'];
        if (weightStandard) {
          // Simplified calculation - in reality would need interpolation between data points
          const closestData = weightStandard.reduce((prev, curr) => 
            Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
          );
          
          if (closestData) {
            weightPercentile = findPercentile(record.weight, [closestData]);
          }
        }
      }
      
      if (record.height) {
        const heightStandard = WHO_STANDARDS.height_for_age[gender as 'male' | 'female'];
        if (heightStandard) {
          const closestData = heightStandard.reduce((prev, curr) => 
            Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
          );
          
          if (closestData) {
            heightPercentile = findPercentile(record.height, [closestData]);
          }
        }
      }
      
      return {
        ...record,
        age_in_weeks: ageInWeeks,
        weight_percentile: weightPercentile,
        height_percentile: heightPercentile,
        comparisons: {
          weight: weightPercentile ? `At ${weightPercentile}th percentile for age` : 'No comparison available',
          height: heightPercentile ? `At ${heightPercentile}th percentile for age` : 'No comparison available'
        }
      };
    })
      .sort((a, b) => (b.measurement_date ?? '').localeCompare(a.measurement_date ?? ''))
      .slice(0, 100);
    
    return c.json({ growth: growthWithComparisons });
  } catch (error) {
    console.error('Get growth records error:', error);
    return c.json({ error: 'Failed to fetch growth records' }, 500);
  }
});

// Get a specific growth record with WHO/CDC comparisons
growthRoutes.get('/:id{[0-9]+}', async (c) => {
  try {
    const growthId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this growth record
    const growthResult = await db.execute({
      sql: `
      SELECT g.id, g.baby_id, g.measurement_date, g.weight, g.height, g.head_circumference, g.bmi, g.unit_system, g.notes, g.created_at,
             b.birth_date, b.gender
      FROM growth g
      JOIN babies b ON g.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE g.id = ? AND uh.user_id = ?
    `,
      args: [growthId, userId]
    });
    
    if (growthResult.rows.length === 0) {
      return c.json({ error: 'Growth record not found or access denied' }, 404);
    }
    
    const record = growthResult.rows[0] as unknown as GrowthWithBabyRow;
    const ageInWeeks = calculateAgeInWeeks(record.birth_date, record.measurement_date);
    const gender = record.gender || 'male';
    
    let weightPercentile = null;
    let heightPercentile = null;
    
    if (record.weight) {
      const weightStandard = WHO_STANDARDS.weight_for_age[gender as 'male' | 'female'];
      if (weightStandard) {
        const closestData = weightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          weightPercentile = findPercentile(record.weight, [closestData]);
        }
      }
    }
    
    if (record.height) {
      const heightStandard = WHO_STANDARDS.height_for_age[gender as 'male' | 'female'];
      if (heightStandard) {
        const closestData = heightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          heightPercentile = findPercentile(record.height, [closestData]);
        }
      }
    }
    
    const growthRecord = {
      ...record,
      age_in_weeks: ageInWeeks,
      weight_percentile: weightPercentile,
      height_percentile: heightPercentile,
      comparisons: {
        weight: weightPercentile ? `At ${weightPercentile}th percentile for age` : 'No comparison available',
        height: heightPercentile ? `At ${heightPercentile}th percentile for age` : 'No comparison available'
      }
    };
    
    return c.json({ growth: growthRecord });
  } catch (error) {
    console.error('Get growth record error:', error);
    return c.json({ error: 'Failed to fetch growth record' }, 500);
  }
});

// Create a new growth record
growthRoutes.post('/', zValidator('json', createGrowthSchema), async (c) => {
  try {
    const { memberId, measurementDate, weight, height, headCircumference, bmi, unitSystem, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const memberCheck = await db.execute({
      sql: `
      SELECT b.id, b.birth_date, b.gender
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
    
    const baby = memberCheck.rows[0] as unknown as BabyRow;
    
    // Calculate BMI if not provided and we have weight and height
    let calculatedBmi = bmi;
    if (!calculatedBmi && weight && height) {
      let metricWeight = weight;
      let metricHeight = height;
      
      if (unitSystem === 'imperial') {
        metricWeight = weight * 0.453592; // lbs to kg
        metricHeight = height * 0.0254;   // inches to meters
      } else {
        metricHeight = height / 100;      // cm to meters
      }
      
      if (metricHeight > 0) {
        calculatedBmi = metricWeight / (metricHeight * metricHeight);
      }
    }
    
    // Insert new growth record
    const result = await db.execute({
      sql: `
        INSERT INTO growth (
          baby_id, measurement_date, weight, height, head_circumference, bmi, unit_system, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        memberId, 
        measurementDate, 
        weight || null, 
        height || null, 
        headCircumference || null, 
        calculatedBmi || null, 
        unitSystem, 
        notes || null, 
        new Date().toISOString()
      ]
    });
    
    // Return the created growth record with WHO/CDC comparisons
    const growthResult = await db.execute({
      sql: `
      SELECT id, baby_id, measurement_date, weight, height, head_circumference, bmi, unit_system, notes, created_at
      FROM growth
      WHERE id = ?
    `,
      args: [Number(result.lastInsertRowid)]
    });
    
    const record = growthResult.rows[0] as unknown as GrowthRow;
    const ageInWeeks = calculateAgeInWeeks(baby.birth_date, record.measurement_date);
    const gender = baby.gender || 'male';
    
    let weightPercentile = null;
    let heightPercentile = null;
    
    if (record.weight) {
      const weightStandard = WHO_STANDARDS.weight_for_age[gender as 'male' | 'female'];
      if (weightStandard) {
        const closestData = weightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          weightPercentile = findPercentile(record.weight, [closestData]);
        }
      }
    }
    
    if (record.height) {
      const heightStandard = WHO_STANDARDS.height_for_age[gender as 'male' | 'female'];
      if (heightStandard) {
        const closestData = heightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          heightPercentile = findPercentile(record.height, [closestData]);
        }
      }
    }
    
    const growthRecord = {
      ...record,
      age_in_weeks: ageInWeeks,
      weight_percentile: weightPercentile,
      height_percentile: heightPercentile,
      comparisons: {
        weight: weightPercentile ? `At ${weightPercentile}th percentile for age` : 'No comparison available',
        height: heightPercentile ? `At ${heightPercentile}th percentile for age` : 'No comparison available'
      }
    };
    
    return c.json({ 
      message: 'Growth record created successfully', 
      growth: growthRecord 
    });
  } catch (error) {
    console.error('Create growth record error:', error);
    return c.json({ error: 'Failed to create growth record' }, 500);
  }
});

// Update a growth record
growthRoutes.put('/:id{[0-9]+}', zValidator('json', updateGrowthSchema), async (c) => {
  try {
    const growthId = parseInt(c.req.param('id'));
    const { measurementDate, weight, height, headCircumference, bmi, unitSystem, notes } = c.req.valid('json');
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this growth record
    const growthCheck = await db.execute({
      sql: `
      SELECT g.id, g.baby_id, g.measurement_date, g.weight, g.height, g.head_circumference, g.bmi, g.unit_system,
             b.birth_date, b.gender
      FROM growth g
      JOIN babies b ON g.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE g.id = ? AND uh.user_id = ?
    `,
      args: [growthId, userId]
    });
    
    if (growthCheck.rows.length === 0) {
      return c.json({ error: 'Growth record not found or access denied' }, 404);
    }
    
    const existingRecord = growthCheck.rows[0] as unknown as GrowthWithBabyRow;
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (measurementDate !== undefined) {
      updates.push('measurement_date = ?');
      params.push(measurementDate);
    }
    
    if (weight !== undefined) {
      updates.push('weight = ?');
      params.push(weight);
    }
    
    if (height !== undefined) {
      updates.push('height = ?');
      params.push(height);
    }
    
    if (headCircumference !== undefined) {
      updates.push('head_circumference = ?');
      params.push(headCircumference);
    }
    
    if (bmi !== undefined) {
      updates.push('bmi = ?');
      params.push(bmi);
    }
    
    if (unitSystem !== undefined) {
      updates.push('unit_system = ?');
      params.push(unitSystem);
    }
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    
    // Update BMI if weight and height are being updated and BMI wasn't explicitly provided
    if ((weight !== undefined || height !== undefined) && bmi === undefined) {
      const newWeight = weight !== undefined ? weight : existingRecord.weight;
      const newHeight = height !== undefined ? height : existingRecord.height;
      const effectiveUnitSystem = unitSystem !== undefined ? unitSystem : existingRecord.unit_system;
      
      if (newWeight && newHeight) {
        let metricWeight = newWeight;
        let metricHeight = newHeight;
        
        if (effectiveUnitSystem === 'imperial') {
          metricWeight = newWeight * 0.453592; // lbs to kg
          metricHeight = newHeight * 0.0254;   // inches to meters
        } else {
          metricHeight = newHeight / 100;      // cm to meters
        }
        
        if (metricHeight > 0) {
          const newBmi = metricWeight / (metricHeight * metricHeight);
          updates.push('bmi = ?');
          params.push(newBmi);
        }
      }
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    // Add updated timestamp
    params.push(new Date().toISOString());
    params.push(growthId); // For WHERE clause
    
    const query = `UPDATE growth SET ${updates.join(', ')}, created_at = ? WHERE id = ?`;
    
    await db.execute({
      sql: query,
      args: params
    });
    
    // Return updated growth record with WHO/CDC comparisons
    const updatedGrowthResult = await db.execute({
      sql: `
      SELECT id, baby_id, measurement_date, weight, height, head_circumference, bmi, unit_system, notes, created_at
      FROM growth
      WHERE id = ?
    `,
      args: [growthId]
    });
    
    const record = updatedGrowthResult.rows[0] as unknown as GrowthRow;
    const ageInWeeks = calculateAgeInWeeks(existingRecord.birth_date, record.measurement_date || existingRecord.measurement_date);
    const gender = existingRecord.gender || 'male';
    
    let weightPercentile = null;
    let heightPercentile = null;
    
    if (record.weight) {
      const weightStandard = WHO_STANDARDS.weight_for_age[gender as 'male' | 'female'];
      if (weightStandard) {
        const closestData = weightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          weightPercentile = findPercentile(record.weight, [closestData]);
        }
      }
    }
    
    if (record.height) {
      const heightStandard = WHO_STANDARDS.height_for_age[gender as 'male' | 'female'];
      if (heightStandard) {
        const closestData = heightStandard.reduce((prev, curr) => 
          Math.abs(curr.age_weeks - ageInWeeks) < Math.abs(prev.age_weeks - ageInWeeks) ? curr : prev
        );
        
        if (closestData) {
          heightPercentile = findPercentile(record.height, [closestData]);
        }
      }
    }
    
    const growthRecord = {
      ...record,
      age_in_weeks: ageInWeeks,
      weight_percentile: weightPercentile,
      height_percentile: heightPercentile,
      comparisons: {
        weight: weightPercentile ? `At ${weightPercentile}th percentile for age` : 'No comparison available',
        height: heightPercentile ? `At ${heightPercentile}th percentile for age` : 'No comparison available'
      }
    };
    
    return c.json({ 
      message: 'Growth record updated successfully', 
      growth: growthRecord 
    });
  } catch (error) {
    console.error('Update growth record error:', error);
    return c.json({ error: 'Failed to update growth record' }, 500);
  }
});

// Delete a growth record
growthRoutes.delete('/:id{[0-9]+}', async (c) => {
  try {
    const growthId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this growth record
    const growthCheck = await db.execute({
      sql: `
      SELECT g.id
      FROM growth g
      JOIN babies b ON g.baby_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE g.id = ? AND uh.user_id = ?
    `,
      args: [growthId, userId]
    });
    
    if (growthCheck.rows.length === 0) {
      return c.json({ error: 'Growth record not found or access denied' }, 404);
    }
    
    // Delete the growth record
    await db.execute({
      sql: 'DELETE FROM growth WHERE id = ?',
      args: [growthId]
    });
    
    return c.json({ message: 'Growth record deleted successfully' });
  } catch (error) {
    console.error('Delete growth record error:', error);
    return c.json({ error: 'Failed to delete growth record' }, 500);
  }
});

// Get growth chart data for visualization
growthRoutes.get('/:id{[0-9]+}/chart-data', async (c) => {
  try {
    const memberId = parseInt(c.req.param('id'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    // Verify user has access to this baby
    const memberCheck = await db.execute({
      sql: `
      SELECT b.id, b.birth_date, b.gender
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
    
    const baby = memberCheck.rows[0] as unknown as BabyRow;
    const gender = baby.gender || 'male';
    
    // Get all growth records for this baby
    const growthResult = await db.execute({
      sql: `
      SELECT id, measurement_date, weight, height, head_circumference, bmi
      FROM growth
      WHERE baby_id = ?
    `,
      args: [memberId]
    });
    
    // Prepare chart data with WHO standards
    const chartData = {
      measurements: (growthResult.rows as unknown as GrowthRow[]).map(record => ({
        ...record,
        age_in_weeks: calculateAgeInWeeks(baby.birth_date, record.measurement_date)
      })),
      who_standards: {
        weight_for_age: WHO_STANDARDS.weight_for_age[gender as 'male' | 'female'],
        height_for_age: WHO_STANDARDS.height_for_age[gender as 'male' | 'female']
      }
    };
    
    return c.json(chartData);
  } catch (error) {
    console.error('Get growth chart data error:', error);
    return c.json({ error: 'Failed to fetch growth chart data' }, 500);
  }
});

export { growthRoutes };