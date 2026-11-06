// mcp/tool-kit.ts
// Shared building blocks for the tool catalog: the result/error shapes, the
// date-window helpers, and the thin fetchers over the family routes the web
// app already exposes. Every tool is a shell over `callFamilyRoute`, so nothing
// here opens a database directly.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callFamilyRoute, McpRouteError } from './caller';

export interface ToolContext {
  familyId: string;
  actorUserId: string | null;
}

/** The list routes clamp to this; asking for it is how a tool sees a full window in one hop. */
export const MAX_PAGE = 500;

export interface RouteMember {
  id: number;
  name: string;
  type?: string;
  birthDate?: string | null;
  gender?: string | null;
  stage?: string | null;
  trackable?: boolean;
  categories?: string[];
}

export interface RouteAsset {
  id: number;
  name: string;
  category?: string;
  homeId?: number | null;
  archivedAt?: string | null;
}

export interface RouteRecord {
  id: number;
  subject_id?: number;
  created_at?: string;
  [key: string]: unknown;
}

export function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function payloadMessage(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String((payload as { error: unknown }).error);
  }
  return 'unknown error';
}

/** A thrown route error becomes a tool error the agent can read, not a crash. */
export function toolError(err: unknown) {
  const message =
    err instanceof McpRouteError
      ? `Request failed (${err.status}): ${payloadMessage(err.payload)}`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function childrenOf(members: RouteMember[]): RouteMember[] {
  return members.filter((m) => (m.type ?? 'child') === 'child');
}

/** Fetch one list-route page. The response key is the route's own list key. */
export async function fetchList<T>(ctx: ToolContext, path: string, listKey: string, tool: string): Promise<T[]> {
  const data = await callFamilyRoute<Record<string, T[]>>({ ...ctx, path, tool });
  return (data[listKey] as T[]) ?? [];
}

export async function fetchObject<T>(ctx: ToolContext, path: string, tool: string): Promise<T> {
  return callFamilyRoute<T>({ ...ctx, path, tool });
}

export async function fetchMembers(ctx: ToolContext): Promise<RouteMember[]> {
  return fetchList<RouteMember>(ctx, '/api/v1/families/members', 'members', 'list_children');
}

/** Active (non-archived) assets, the set the home tools iterate over. */
export async function fetchActiveAssets(ctx: ToolContext): Promise<RouteAsset[]> {
  return fetchList<RouteAsset>(ctx, '/api/v1/home-assets', 'assets', 'list_assets');
}

/**
 * Records whose time column falls within [from, to], newest-first as the route
 * returned them, capped at `limit`. A row with no time column falls back to
 * `created_at` so a null entry_date does not silently drop it.
 */
export function inWindow(
  rows: RouteRecord[],
  timeKey: string,
  from?: string,
  to?: string,
  limit = 100,
): RouteRecord[] {
  const fromMs = from ? Date.parse(from) : undefined;
  const toMs = to ? Date.parse(to) : undefined;
  const filtered = rows.filter((r) => {
    const raw = r[timeKey] ?? r.created_at ?? r.createdAt;
    const t = Date.parse(String(raw ?? ''));
    if (Number.isNaN(t)) return false;
    if (fromMs !== undefined && t < fromMs) return false;
    if (toMs !== undefined && t > toMs) return false;
    return true;
  });
  return filtered.slice(0, limit);
}

export function sumAmountOz(rows: RouteRecord[]): number {
  let total = 0;
  for (const r of rows) {
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += r.amount_unit === 'ml' ? amount / 29.5735295625 : amount;
  }
  return Math.round(total * 100) / 100;
}

export function defaultWindow(from?: string, to?: string, days = 7): { from: string; to: string } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

export interface MemberRangeSpec {
  name: string;
  title: string;
  describe: string;
  /** The /api/v1 route segment, e.g. `growth`. */
  route: string;
  /** The response key the route returns, e.g. `growth`, `milestones`, `entries`. */
  listKey: string;
  /** The row's date column, for window filtering. */
  timeKey: string;
  /** The key to return under; defaults to listKey. */
  outKey?: string;
}

/**
 * A member-scoped, date-range-filtered read. All of feedings, diapers, sleep,
 * growth, milestones, vaccinations and journal share this shape — the route
 * pages newest-first and the window is applied here.
 */
export function registerMemberRange(server: McpServer, ctx: ToolContext, spec: MemberRangeSpec): void {
  const outKey = spec.outKey ?? spec.listKey;
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: `${spec.describe} Newest first, filtered to the given date range (ISO 8601).`,
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
        const all = await fetchList<RouteRecord>(
          ctx,
          `/api/v1/${spec.route}?memberId=${memberId}&limit=${MAX_PAGE}`,
          spec.listKey,
          spec.name,
        );
        const rows = inWindow(all, spec.timeKey, from, to, limit ?? 100);
        return jsonResult({ [outKey]: rows, returned: rows.length, available: all.length });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
