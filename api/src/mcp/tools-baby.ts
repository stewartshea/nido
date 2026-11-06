// mcp/tools-baby.ts
// The infant/child tool catalog: the reads that answer "how was the week" and
// "what's coming up", plus the feed write. Everything is a shell over an
// existing route; no query logic lives here.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MAX_PAGE,
  type RouteRecord,
  type ToolContext,
  childrenOf,
  defaultWindow,
  fetchList,
  fetchMembers,
  fetchObject,
  inWindow,
  jsonResult,
  registerMemberRange,
  sumAmountOz,
  toolError,
} from './tool-kit';

export function registerBabyTools(server: McpServer, ctx: ToolContext): void {
  // ── Members ───────────────────────────────────────────────────────────────
  server.registerTool(
    'list_children',
    {
      title: 'List children',
      description:
        'List the children in this family that can be logged against (id, name, birth date, stage, tracked categories).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const members = childrenOf(await fetchMembers(ctx));
        return jsonResult({
          children: members.map((m) => ({
            id: m.id,
            name: m.name,
            birthDate: m.birthDate ?? null,
            gender: m.gender ?? null,
            stage: m.stage ?? null,
            trackable: m.trackable ?? true,
            categories: m.categories ?? [],
          })),
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Time-series reads (one shape, seven tools) ────────────────────────────
  registerMemberRange(server, ctx, {
    name: 'get_feedings',
    title: 'Get feedings',
    describe: 'Feedings for one child.',
    route: 'feedings',
    listKey: 'feedings',
    timeKey: 'start_time',
  });
  registerMemberRange(server, ctx, {
    name: 'get_diapers',
    title: 'Get diapers',
    describe: 'Diaper changes for one child.',
    route: 'diapers',
    listKey: 'diapers',
    timeKey: 'change_time',
  });
  registerMemberRange(server, ctx, {
    name: 'get_sleep',
    title: 'Get sleep',
    describe: 'Sleep sessions for one child.',
    route: 'sleep',
    listKey: 'sleep',
    timeKey: 'start_time',
  });
  registerMemberRange(server, ctx, {
    name: 'get_growth',
    title: 'Get growth',
    describe:
      'Growth measurements for one child (weight, height, head circumference) with WHO/CDC age percentiles computed by the growth route.',
    route: 'growth',
    listKey: 'growth',
    timeKey: 'measurement_date',
  });
  registerMemberRange(server, ctx, {
    name: 'get_milestones',
    title: 'Get milestones',
    describe: 'Milestones recorded for one child.',
    route: 'milestones',
    listKey: 'milestones',
    timeKey: 'achieved_date',
  });
  registerMemberRange(server, ctx, {
    name: 'get_journal',
    title: 'Get journal',
    describe: 'Journal entries for one child.',
    route: 'journal',
    listKey: 'entries',
    timeKey: 'entryDate',
    outKey: 'entries',
  });

  // ── Vaccinations (records, optionally the schedule) ───────────────────────
  server.registerTool(
    'get_vaccinations',
    {
      title: 'Get vaccinations',
      description:
        'Vaccination records for one child, optionally with the recommended schedule. Newest first, filtered to the given date range.',
      inputSchema: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        includeSchedule: z.boolean().optional().describe('Also return the recommended vaccination schedule'),
        from: z.string().optional().describe('ISO 8601 start of the range (inclusive)'),
        to: z.string().optional().describe('ISO 8601 end of the range (inclusive)'),
        limit: z.number().int().positive().max(MAX_PAGE).optional().describe('Max records to return (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ memberId, includeSchedule, from, to, limit }) => {
      try {
        const all = await fetchList<RouteRecord>(
          ctx,
          `/api/v1/vaccinations?memberId=${memberId}&limit=${MAX_PAGE}`,
          'vaccinations',
          'get_vaccinations',
        );
        const rows = inWindow(all, 'date_given', from, to, limit ?? 100);
        const payload: Record<string, unknown> = { vaccinations: rows, returned: rows.length, available: all.length };
        if (includeSchedule) {
          const schedule = await fetchObject<{ schedule: unknown }>(ctx, '/api/v1/vaccinations/schedule', 'get_vaccinations');
          payload.schedule = schedule.schedule;
        }
        return jsonResult(payload);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Appointments: schedule-derived upcoming + booked plans ────────────────
  server.registerTool(
    'get_appointments',
    {
      title: 'Get appointments',
      description:
        'Upcoming appointments for the family (or one child): schedule-derived ones and the appointments booked as plans.',
      inputSchema: {
        memberId: z.number().int().positive().optional().describe('Limit to one child id from list_children'),
        days: z.number().int().positive().max(365).optional().describe('Look-ahead window in days (default: the server default)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ memberId, days }) => {
      try {
        const qs = new URLSearchParams();
        if (memberId) qs.set('memberId', String(memberId));
        if (days) qs.set('days', String(days));
        const suffix = qs.size ? `?${qs}` : '';
        const upcoming = await fetchObject<{ appointments: unknown[]; total: number; days: number }>(
          ctx,
          `/api/v1/milestones/upcoming${suffix}`,
          'get_appointments',
        );
        const plansQs = new URLSearchParams({ status: 'planned' });
        if (memberId) plansQs.set('memberId', String(memberId));
        const plans = await fetchObject<{ plans: unknown[]; total: number }>(
          ctx,
          `/api/v1/plans?${plansQs}`,
          'get_appointments',
        );
        return jsonResult({
          days: upcoming.days,
          upcoming: upcoming.appointments ?? [],
          booked: plans.plans ?? [],
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Family summary ────────────────────────────────────────────────────────
  server.registerTool(
    'get_family_summary',
    {
      title: 'Family summary',
      description:
        'A bounded rollup for "how was the week": per-child feed, diaper and sleep counts plus totals over a date range, so one call answers the question instead of many.',
      inputSchema: {
        from: z.string().optional().describe('ISO 8601 start (default: 7 days before `to`)'),
        to: z.string().optional().describe('ISO 8601 end (default: now)'),
        days: z.number().int().positive().max(90).optional().describe('Window length when `from` is omitted (default 7)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, days }) => {
      try {
        const window = defaultWindow(from, to, days ?? 7);
        const members = childrenOf(await fetchMembers(ctx));
        const perChild = [];
        let feeds = 0;
        let feedOz = 0;
        let diapers = 0;
        let sleepMs = 0;

        for (const child of members) {
          const [feedRows, diaperRows, sleepRows] = await Promise.all([
            fetchList<RouteRecord>(ctx, `/api/v1/feedings?memberId=${child.id}&limit=${MAX_PAGE}`, 'feedings', 'get_family_summary').catch(() => []),
            fetchList<RouteRecord>(ctx, `/api/v1/diapers?memberId=${child.id}&limit=${MAX_PAGE}`, 'diapers', 'get_family_summary').catch(() => []),
            fetchList<RouteRecord>(ctx, `/api/v1/sleep?memberId=${child.id}&limit=${MAX_PAGE}`, 'sleep', 'get_family_summary').catch(() => []),
          ]);
          const f = inWindow(feedRows, 'start_time', window.from, window.to, MAX_PAGE);
          const d = inWindow(diaperRows, 'change_time', window.from, window.to, MAX_PAGE);
          const s = inWindow(sleepRows, 'start_time', window.from, window.to, MAX_PAGE);
          const childSleepMs = s.reduce((acc, r) => acc + (Number(r.duration) || 0), 0);
          const childOz = sumAmountOz(f);

          feeds += f.length;
          feedOz += childOz;
          diapers += d.length;
          sleepMs += childSleepMs;

          perChild.push({
            memberId: child.id,
            name: child.name,
            feedings: f.length,
            feedAmountOz: childOz,
            diapers: d.length,
            sleepSessions: s.length,
            sleepHours: Math.round((childSleepMs / 3_600_000) * 100) / 100,
          });
        }

        return jsonResult({
          window,
          children: perChild,
          totals: {
            feedings: feeds,
            feedAmountOz: Math.round(feedOz * 100) / 100,
            diapers,
            sleepSessions: perChild.reduce((acc, c) => acc + c.sleepSessions, 0),
            sleepHours: Math.round((sleepMs / 3_600_000) * 100) / 100,
          },
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Write ─────────────────────────────────────────────────────────────────
  // The write tools (log_feed, log_diaper, ...) live in tools-write.ts, where
  // every create and update of the record categories is registered together.
}
