import { Hono } from 'hono';
import type { SubjectRow, SleepAggRow, DiaperAggRow, FeedingAggRow } from '../db-types';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { type AuthEnv } from '../auth';

const healthRoutes = new Hono<AuthEnv>();

// Get comprehensive health summary for a baby
healthRoutes.get('/summary/:memberId{[0-9]+}', async (c) => {
  try {
    const memberId = parseInt(c.req.param('memberId'));
    const userId = c.get('userId');
    const db = c.get('db');

    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    const subjectId = scope.subjectId;

    const babyRes = await db.execute({
      sql: `SELECT id, name, birth_date, gender FROM subjects WHERE id = ? LIMIT 1`,
      args: [subjectId],
    });
    const baby = babyRes.rows[0] as unknown as SubjectRow;
    
    // Get latest feeding
    const latestFeeding = await db.execute({
      sql: `
      SELECT start_time, end_time, duration, amount, type, side, created_by
      FROM feedings
      WHERE subject_id = ?
      ORDER BY start_time DESC
      LIMIT 1
    `,
      args: [subjectId]
    });
    
    // Get latest diaper
    const latestDiaper = await db.execute({
      sql: `
      SELECT change_time, type, color, consistency, created_by
      FROM diapers
      WHERE subject_id = ?
      ORDER BY change_time DESC
      LIMIT 1
    `,
      args: [subjectId]
    });
    
    // Get latest sleep
    const latestSleep = await db.execute({
      sql: `
      SELECT start_time, end_time, duration, location, created_by
      FROM sleep
      WHERE subject_id = ?
      ORDER BY start_time DESC
      LIMIT 1
    `,
      args: [subjectId]
    });
    
    // Get latest growth
    const latestGrowth = await db.execute({
      sql: `
      SELECT measurement_date, weight, height, head_circumference, bmi
      FROM growth
      WHERE subject_id = ?
      ORDER BY measurement_date DESC
      LIMIT 1
    `,
      args: [subjectId]
    });
    
    // Get latest milestones
    const latestMilestones = await db.execute({
      sql: `
      SELECT title, description, achieved_date, category
      FROM milestones
      WHERE subject_id = ?
      ORDER BY achieved_date DESC
      LIMIT 5
    `,
      args: [subjectId]
    });
    
    // Get upcoming vaccinations
    const upcomingVaccinations = await db.execute({
      sql: `
      SELECT name, next_due_date, notes
      FROM vaccinations
      WHERE subject_id = ? AND next_due_date IS NOT NULL
      ORDER BY next_due_date ASC
      LIMIT 5
    `,
      args: [subjectId]
    });
    
    // Calculate age in weeks
    const birthDate = new Date(baby.birth_date);
    const today = new Date();
    const ageInWeeks = Math.floor((today.getTime() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
    
    await attachCreatedBy(db, [
      ...latestFeeding.rows,
      ...latestDiaper.rows,
      ...latestSleep.rows,
    ]);

    const healthSummary = {
      baby: {
        id: baby.id,
        name: baby.name,
        ageInWeeks: ageInWeeks,
        gender: baby.gender,
        birthDate: baby.birth_date
      },
      latestFeeding: latestFeeding.rows[0] || null,
      latestDiaper: latestDiaper.rows[0] || null,
      latestSleep: latestSleep.rows[0] || null,
      latestGrowth: latestGrowth.rows[0] || null,
      recentMilestones: latestMilestones.rows,
      upcomingVaccinations: upcomingVaccinations.rows,
      lastUpdated: new Date().toISOString()
    };
    
    return c.json({ summary: healthSummary });
  } catch (error) {
    c.get('log').error('get health summary failed', { err: error });
    return c.json({ error: 'Failed to fetch health summary' }, 500);
  }
});

// Get health insights and analytics
healthRoutes.get('/insights/:memberId{[0-9]+}', async (c) => {
  try {
    const memberId = parseInt(c.req.param('memberId'));
    const userId = c.get('userId');
    const db = c.get('db');
    
    const scope = await resolveTrackableMember(db, userId, memberId);
    if (!scope) {
      return c.json({ error: 'Member not found or access denied' }, 404);
    }
    const subjectId = scope.subjectId;
    
    // Get feeding patterns (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const feedingPatterns = await db.execute({
      sql: `
      SELECT 
        COUNT(*) as total_feedings,
        AVG(CASE WHEN amount IS NOT NULL THEN amount * CASE WHEN amount_unit = 'ml' THEN 0.033814 ELSE 1 END ELSE 0 END) as avg_amount,
        AVG(CASE WHEN duration IS NOT NULL THEN duration ELSE 0 END) as avg_duration,
        SUM(CASE WHEN type = 'breast' THEN 1 ELSE 0 END) as breast_feedings,
        SUM(CASE WHEN type = 'formula' THEN 1 ELSE 0 END) as formula_feedings,
        SUM(CASE WHEN type = 'solid' THEN 1 ELSE 0 END) as solid_feedings
      FROM feedings
      WHERE subject_id = ? AND start_time >= ?
    `,
      args: [subjectId, weekAgo.toISOString()]
    });
    
    // Get sleep patterns (last 7 days)
    const sleepPatterns = await db.execute({
      sql: `
      SELECT 
        COUNT(*) as total_sleep_periods,
        AVG(CASE WHEN duration IS NOT NULL THEN duration ELSE 0 END) as avg_duration,
        SUM(CASE WHEN duration IS NOT NULL THEN duration ELSE 0 END) as total_duration
      FROM sleep
      WHERE subject_id = ? AND start_time >= ?
    `,
      args: [subjectId, weekAgo.toISOString()]
    });
    
    // Get diaper patterns (last 7 days)
    const diaperPatterns = await db.execute({
      sql: `
      SELECT 
        COUNT(*) as total_changes,
        SUM(CASE WHEN type = 'wet' THEN 1 ELSE 0 END) as wet_changes,
        SUM(CASE WHEN type = 'dirty' THEN 1 ELSE 0 END) as dirty_changes,
        SUM(CASE WHEN type = 'both' THEN 1 ELSE 0 END) as both_changes
      FROM diapers
      WHERE subject_id = ? AND change_time >= ?
    `,
      args: [subjectId, weekAgo.toISOString()]
    });
    
    const insights = {
      feeding: feedingPatterns.rows[0] as unknown as FeedingAggRow | undefined,
      sleep: {
        ...sleepPatterns.rows[0],
        avg_hours_per_period: (Number(sleepPatterns.rows[0]?.avg_duration ?? 0) / 3600000).toFixed(2),
        total_hours: (Number(sleepPatterns.rows[0]?.total_duration ?? 0) / 3600000).toFixed(2)
      },
      diaper: diaperPatterns.rows[0] as unknown as DiaperAggRow | undefined,
      period: 'last_7_days',
      generatedAt: new Date().toISOString()
    };
    
    return c.json({ insights });
  } catch (error) {
    c.get('log').error('get health insights failed', { err: error });
    return c.json({ error: 'Failed to fetch health insights' }, 500);
  }
});

export { healthRoutes };