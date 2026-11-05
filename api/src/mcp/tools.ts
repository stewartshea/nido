// mcp/tools.ts
// The tool catalog: thin, typed shells over the routes the web app already
// exposes. Nothing here queries the database directly — every tool calls
// `callFamilyRoute`, which dispatches to the real /api/v1 route, so validation,
// authorization and provenance are the web app's.
//
// This is the MVP slice (issue #83): the reads that make a weekly report work,
// one write, and the family export resource. The rest of the catalog registers
// the same way.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callFamilyRoute, McpRouteError } from './caller';

export interface ToolContext {
  familyId: string;
  actorUserId: string | null;
}

interface RouteMember {
  id: number;
  name: string;
  type?: string;
  birthDate?: string | null;
  gender?: string | null;
  stage?: string | null;
  trackable?: boolean;
  categories?: string[];
}

interface RouteRecord {
  id: number;
  subject_id: number;
  start_time?: string;
  end_time?: string;
  change_time?: string;
  duration?: number | null;
  amount?: number | null;
  amount_unit?: string | null;
  type?: string;
  side?: string | null;
  notes?: string | null;
  [key: string]: unknown;
}

const MAX_PAGE = 500;

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/** A thrown route error becomes a tool error the agent can read, not a crash. */
function toolError(err: unknown) {
  const message =
    err instanceof McpRouteError
      ? `Request failed (${err.status}): ${typeof err.payload === 'object' && err.payload && 'error' in (err.payload as any) ? (err.payload as any).error : 'unknown error'}`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function children(members: RouteMember[]): RouteMember[] {
  return members.filter((m) => (m.type ?? 'child') === 'child');
}

/** Records whose time column falls within [from, to], optionally capped. */
function inWindow(rows: RouteRecord[], timeKey: 'start_time' | 'change_time', from?: string, to?: string, limit = 100): RouteRecord[] {
  const fromMs = from ? Date.parse(from) : undefined;
  const toMs = to ? Date.parse(to) : undefined;
  const filtered = rows.filter((r) => {
    const t = Date.parse(String(r[timeKey] ?? ''));
    if (Number.isNaN(t)) return false;
    if (fromMs !== undefined && t < fromMs) return false;
    if (toMs !== undefined && t > toMs) return false;
    return true;
  });
  return filtered.slice(0, limit);
}

function sumAmountOz(rows: RouteRecord[]): number {
  let total = 0;
  for (const r of rows) {
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += r.amount_unit === 'ml' ? amount / 29.5735295625 : amount;
  }
  return Math.round(total * 100) / 100;
}

function defaultWindow(from?: string, to?: string, days = 7): { from: string; to: string } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

async function fetchMembers(ctx: ToolContext): Promise<RouteMember[]> {
  const data = await callFamilyRoute<{ members: RouteMember[] }>({
    ...ctx,
    path: '/api/v1/families/members',
    tool: 'list_children',
  });
  return data.members ?? [];
}

async function fetchRecords(ctx: ToolContext, category: string, memberId: number, tool: string): Promise<RouteRecord[]> {
  const data = await callFamilyRoute<Record<string, RouteRecord[]>>({
    ...ctx,
    path: `/api/v1/${category}?memberId=${memberId}&limit=${MAX_PAGE}`,
    tool,
  });
  return (data[category] as RouteRecord[]) ?? [];
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  // ── Read ────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_children',
    {
      title: 'List children',
      description: 'List the children in this family that can be logged against (id, name, birth date, stage, tracked categories).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const members = children(await fetchMembers(ctx));
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

  const rangedRead = (
    name: string,
    title: string,
    category: string,
    tableKey: string,
    timeKey: 'start_time' | 'change_time',
    describe: string,
  ) => {
    server.registerTool(
      name,
      {
        title,
        description: `${describe} Newest first, filtered to the given date range (ISO 8601).`,
        inputSchema: {
          memberId: z.number().int().positive().describe('The child id from list_children'),
          from: z.string().optional().describe('ISO 8601 start of the range (inclusive)'),
          to: z.string().optional().describe('ISO 8601 end of the range (inclusive)'),
          limit: z.number().int().positive().max(MAX_PAGE).optional().describe('Max records to return (default 100)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ memberId, from, to, limit }) => {
        try {
          const all = await fetchRecords(ctx, category, memberId, name);
          const rows = inWindow(all, timeKey, from, to, limit ?? 100);
          return jsonResult({ [tableKey]: rows, returned: rows.length, available: all.length });
        } catch (err) {
          return toolError(err);
        }
      },
    );
  };

  rangedRead('get_feedings', 'Get feedings', 'feedings', 'feedings', 'start_time', 'Feedings for one child.');
  rangedRead('get_diapers', 'Get diapers', 'diapers', 'diapers', 'change_time', 'Diaper changes for one child.');
  rangedRead('get_sleep', 'Get sleep', 'sleep', 'sleep', 'start_time', 'Sleep sessions for one child.');

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
        const members = children(await fetchMembers(ctx));
        const perChild = [];
        let feeds = 0;
        let feedOz = 0;
        let diapers = 0;
        let sleepMs = 0;

        for (const child of members) {
          const [feedRows, diaperRows, sleepRows] = await Promise.all([
            fetchRecords(ctx, 'feedings', child.id, 'get_family_summary').catch(() => []),
            fetchRecords(ctx, 'diapers', child.id, 'get_family_summary').catch(() => []),
            fetchRecords(ctx, 'sleep', child.id, 'get_family_summary').catch(() => []),
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

  // ── Write ───────────────────────────────────────────────────────────────
  server.registerTool(
    'log_feed',
    {
      title: 'Log a feeding',
      description: 'Record a feeding (breast, bottle, formula, pump or solid) for one child. Appears in the log like any other entry.',
      inputSchema: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        type: z.enum(['breast', 'bottle', 'formula', 'pump', 'solid']).describe('Feeding type'),
        startTime: z.string().optional().describe('ISO 8601 start (default: now)'),
        endTime: z.string().optional().describe('ISO 8601 end'),
        amount: z.number().positive().optional().describe('Amount, for bottle/formula/pump'),
        amountUnit: z.enum(['ml', 'oz']).optional().describe('Unit for `amount` (default oz)'),
        side: z.enum(['left', 'right', 'both']).optional().describe('Breast side, for a breast feed'),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const payload = {
          ...args,
          startTime: args.startTime ?? new Date().toISOString(),
        };
        const data = await callFamilyRoute<{ message: string; feeding: RouteRecord }>({
          ...ctx,
          path: '/api/v1/feedings',
          method: 'POST',
          body: payload,
          tool: 'log_feed',
        });
        return jsonResult({ message: data.message, feeding: data.feeding });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Resource ────────────────────────────────────────────────────────────
  server.registerResource(
    'family-export',
    'nido://family/export',
    {
      title: 'Family export',
      description: 'The whole family as JSON — members, formulas, records, settings — the same payload as GET /api/v1/families/export. Owner/admin only.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const data = await callFamilyRoute({
        ...ctx,
        path: '/api/v1/families/export',
        tool: 'family_export',
      });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
