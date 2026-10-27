import { Hono } from 'hono';
import type { SubjectRow, SleepAggRow, DiaperAggRow, FeedingAggRow } from '../db-types';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { type AuthEnv } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID, DEFAULT_FEED_GROUPING_MINUTES } from '../db-core';
import { EVENT_KIND_CATEGORIES as MILESTONE_KINDS, CATEGORY_OPTION_KEY, RECORD_SKEW_MS } from '../category-registry';

const healthRoutes = new Hono<AuthEnv>();

/**
 * Count how many distinct feeding sessions a set of feeding rows represents.
 *
 * A breast feed and the bottle that follows it are usually separate rows but
 * one feed; `windowMs` is the largest gap between two consecutive records that
 * is still the same session. Rows are expected sorted by start time ascending.
 * Pumps must be excluded by the caller: a pump is the parent expressing, not
 * the baby eating.
 */
function countFeedSessions(rows: Array<{ start_time?: string }>, windowMs: number): number {
	let sessions = 0;
	let prevStart = Number.NEGATIVE_INFINITY;
	for (const row of rows) {
		const start = new Date(String(row.start_time)).getTime();
		if (Number.isNaN(start)) continue;
		if (start - prevStart > windowMs) sessions += 1;
		prevStart = start;
	}
	return sessions;
}

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
    
    // The last time the BABY fed. A pump row is the parent expressing, not the
    // baby eating, so it must not appear here — otherwise "last feed" can read
    // hours earlier than the baby actually ate, and a bottle that followed a
    // pump is hidden behind it.
    const latestFeeding = await db.execute({
      sql: `
      SELECT start_time, end_time, duration, amount, type, side, created_by
      FROM feedings
      WHERE subject_id = ? AND type != 'pump'
      ORDER BY start_time DESC
      LIMIT 1
    `,
      args: [subjectId]
    });

    // The parent's side of it, reported separately. "Time since the breast was
    // last used" is a supply question and is not the same as "time since the
    // baby last ate" — the baby may have had a bottle or solids since.
    const latestPump = await db.execute({
      sql: `
      SELECT start_time, end_time, duration, amount, amount_unit, type, side, created_by
      FROM feedings
      WHERE subject_id = ? AND type = 'pump'
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
      SELECT measurement_date, weight, height, head_circumference, bmi, unit_system
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
      SELECT title, notes, occurred_at, category, data
      FROM events
      WHERE subject_id = ? AND category IN ('milestones', 'firsts')
      ORDER BY occurred_at DESC
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

    // Get the most recent *past* event row per milestone-backed kind
	// (medication, vitamins, grooming, appointments, medical, milestones,
	// firsts, routines) — every kind the catch-all held is a category of
	// `events` now, so one query covers them all.
	//
	// "Last X" means "most recently happened", so future rows must not
	// qualify — and after §3.6 they cannot exist: records are past at write
	// time, and the future is a plan. The skew tolerance is what lets a
	// just-written row qualify at all. The option value comes out of the data
	// document under each category's own key, so the rows are shaped here
	// rather than in one SQL expression.
	const nowIso = new Date(Date.now() + RECORD_SKEW_MS).toISOString();

    const latestMilestoneKindsRaw = await db.execute({
      sql: `
      SELECT category, title, notes, occurred_at, data
      FROM (
        SELECT category, title, notes, occurred_at, data,
               ROW_NUMBER() OVER (PARTITION BY category ORDER BY occurred_at DESC, id DESC) rn
        FROM events
        WHERE subject_id = ? AND category IN (${MILESTONE_KINDS.map(() => '?').join(', ')}) AND occurred_at <= ?
      )
      WHERE rn = 1
      ORDER BY occurred_at DESC
    `,
      args: [subjectId, ...MILESTONE_KINDS, nowIso]
    });
    const latestMilestoneKindsRows = (latestMilestoneKindsRaw.rows as any[]).map((r) => {
      const data = typeof r.data === 'string' && r.data ? JSON.parse(r.data) : {};
      const optionKey = (CATEGORY_OPTION_KEY as Record<string, string>)[r.category] ?? 'type';
      return {
        kind: r.category,
        title: r.title,
        description: r.notes,
        achieved_date: r.occurred_at,
        category: data[optionKey] ?? null,
      };
    });

    // Get the plans still open for this member, soonest first — overdue
    // first in practice, which is the point: the prompt rises to the top
    // instead of aging out of sight. Shaped like the appointments page rows.
    const upcomingAppointments = await db.execute({
      sql: `
      SELECT id, title, notes, category, data, scheduled_at, status
      FROM plans
      WHERE subject_id = ? AND status = 'planned'
      ORDER BY scheduled_at ASC, id ASC
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

    // Build a map for easy lookup by kind on the web.
    const latestByKind: Record<string, any> = {};
    for (const r of latestMilestoneKindsRows) {
      latestByKind[r.kind] = r;
    }

    // Both upcoming tiles and the "recent" list keep the old milestones-era
    // field names, so the web keeps reading one shape while the storage
    // under it moved.
    const shapeUpcoming = (r: any) => {
      const data = typeof r.data === 'string' && r.data ? JSON.parse(r.data) : {};
      return {
        id: r.id,
        title: r.title,
        description: r.notes,
        achieved_date: r.scheduled_at,
        kind: r.category,
        category: data[(CATEGORY_OPTION_KEY as Record<string, string>)[r.category] ?? 'type'] ?? null,
      };
    };
    const upcomingAppointmentsShaped = (upcomingAppointments.rows as any[]).map(shapeUpcoming);

    const healthSummary = {
      baby: {
        id: baby.id,
        name: baby.name,
        ageInWeeks: ageInWeeks,
        gender: baby.gender,
        birthDate: baby.birth_date
      },
      latestFeeding: latestFeeding.rows[0] || null,
      latestPump: latestPump.rows[0] || null,
      latestDiaper: latestDiaper.rows[0] || null,
      latestSleep: latestSleep.rows[0] || null,
      latestGrowth: latestGrowth.rows[0] || null,
      recentMilestones: (latestMilestones.rows as any[]).map((r) => {
        const data = typeof r.data === 'string' && r.data ? JSON.parse(r.data) : {};
        return {
          title: r.title,
          description: r.notes,
          achieved_date: r.occurred_at,
          kind: r.category,
          category: data[(CATEGORY_OPTION_KEY as Record<string, string>)[r.category] ?? 'type'] ?? null,
        };
      }),
      upcomingVaccinations: upcomingVaccinations.rows,
      upcomingAppointments: upcomingAppointmentsShaped,
      latestMilestoneKinds: latestMilestoneKindsRows,
      latestByKind,
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
    
    // Feeds per day counts feeding *sessions*, not rows. A breast feed and the
    // bottle that immediately follows it are logged as two rows but are one
    // feed. The merge window is the family's `feedGroupingMinutes` setting, and
    // pumps are excluded outright — a pump is the parent expressing, not the
    // baby eating.
    const groupingRow = (await db.execute({
      sql: 'SELECT feed_grouping_minutes FROM family_settings WHERE family_id = ? LIMIT 1',
      args: [NAMESPACE_HOUSEHOLD_ID],
    })).rows[0];
    const groupingMinutes = Number((groupingRow as any)?.feed_grouping_minutes ?? DEFAULT_FEED_GROUPING_MINUTES);
    const feedSessionRows = await db.execute({
      sql: `
      SELECT start_time
      FROM feedings
      WHERE subject_id = ? AND start_time >= ? AND type != 'pump'
      ORDER BY start_time ASC, id ASC
      `,
      args: [subjectId, weekAgo.toISOString()]
    });
    const feedSessions = countFeedSessions(feedSessionRows.rows as Array<{ start_time: string }>, groupingMinutes * 60_000);
    
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
    
    // Weight is measured far less often than anything else, so a 7-day window
    // usually holds one point or none and no trend can be read from it. Thirty
    // days is the shortest window that says anything.
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);

    const weightPoints = await db.execute({
      sql: `
      SELECT measurement_date, weight, unit_system
      FROM growth
      WHERE subject_id = ? AND weight IS NOT NULL AND measurement_date >= ?
      ORDER BY measurement_date ASC
    `,
      args: [subjectId, monthAgo.toISOString()]
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
    
    // Rates, not totals: "14 changes last week" is a number nobody acts on,
    // "2 a day" is the one that says whether something changed.
    const days = 7;
    const diapersTotal = Number((diaperPatterns.rows[0] as any)?.total_changes ?? 0);
    const sleepMs = Number((sleepPatterns.rows[0] as any)?.total_duration ?? 0);

    // The WHO tables are metric and a record stores what was typed, so convert
    // before comparing or dividing two of them.
    const toKg = (weight: number, unit?: string | null) =>
      unit === 'imperial' ? weight * 0.453592 : weight;
    const points = (weightPoints.rows as any[]).map((r) => ({
      at: new Date(String(r.measurement_date)).getTime(),
      kg: toKg(Number(r.weight), r.unit_system),
    }));

    const round1 = (n: number) => Math.round(n * 10) / 10;
    let weightTrend: {
      latestKg: number;
      changePerDayKg: number;
      changePerWeekKg: number;
      spanDays: number;
      measurements: number;
    } | null = null;
    if (points.length >= 1) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const spanDays = (last.at - first.at) / 86_400_000;
      // A rate needs two readings far enough apart to mean anything; a known
      // weight is still worth reporting without one, so the latest is always
      // returned and only the rate is withheld (spanDays 0).
      const ratable = points.length >= 2 && spanDays >= 1;
      const perDay = ratable ? (last.kg - first.kg) / spanDays : 0;
      weightTrend = {
        latestKg: round1(last.kg),
        changePerDayKg: Math.round(perDay * 1000) / 1000,
        changePerWeekKg: Math.round(perDay * 7 * 1000) / 1000,
        spanDays: ratable ? Math.round(spanDays) : 0,
        measurements: points.length,
      };
    }

    const insights = {
      feeding: feedingPatterns.rows[0] as unknown as FeedingAggRow | undefined,
      sleep: {
        ...sleepPatterns.rows[0],
        avg_hours_per_period: (Number(sleepPatterns.rows[0]?.avg_duration ?? 0) / 3600000).toFixed(2),
        total_hours: (Number(sleepPatterns.rows[0]?.total_duration ?? 0) / 3600000).toFixed(2)
      },
      diaper: diaperPatterns.rows[0] as unknown as DiaperAggRow | undefined,
      period: 'last_7_days',
      trends: {
        periodDays: days,
        feedsPerDay: round1(feedSessions / days),
        diapersPerDay: round1(diapersTotal / days),
        sleepHoursPerDay: round1(sleepMs / 3_600_000 / days),
        weight: weightTrend,
      },
      generatedAt: new Date().toISOString()
    };
    
    return c.json({ insights });
  } catch (error) {
    c.get('log').error('get health insights failed', { err: error });
    return c.json({ error: 'Failed to fetch health insights' }, 500);
  }
});

export { healthRoutes };