// mcp/caller.ts
// How an MCP tool reaches a family's data: through the same /api/v1 routes the
// web app uses, not a parallel query path.
//
// The MCP endpoint is not a JWT-authenticated request, so to reuse the routes
// the caller mints a short-lived (60 s) JWT for the token's family — with the
// token creator as the actor — and dispatches it through Hono's own
// `app.fetch()`. That keeps zod validation, `familyAccess` authorization,
// `created_by` provenance and the request logger identical to a browser call.
//
// `setInternalFetch` is wired once at boot by server.ts; the module holds no
// reference to the app itself, so there is no import cycle.
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { getFamilyClient } from '../namespaces';
import { log } from '../logger';

type InternalFetcher = (req: Request) => Promise<Response>;

let internalFetch: InternalFetcher | null = null;

/** Wire the running Hono app's fetch. Called once, at boot, from server.ts. */
export function setInternalFetch(fn: InternalFetcher): void {
  internalFetch = fn;
}

/** A non-2xx response from an underlying route, surfaced to the agent. */
export class McpRouteError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(typeof payload === 'object' && payload && 'error' in payload ? String((payload as any).error) : 'route error');
    this.name = 'McpRouteError';
  }
}

/**
 * The user an agent call acts as. The token records its creator; if that
 * account has since left the family, fall back to any member of it, so a token
 * outlives one person's departure but never crosses into another family.
 */
async function resolveActorUserId(familyId: string, preferred: string | null): Promise<string | null> {
  const db = getFamilyClient(familyId);
  if (preferred) {
    const res = await db.execute({
      sql: 'SELECT 1 FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
      args: [preferred, NAMESPACE_HOUSEHOLD_ID],
    });
    if (res.rows.length > 0) return preferred;
  }
  const first = await db.execute({
    sql: 'SELECT user_id FROM user_households WHERE household_id = ? ORDER BY rowid ASC LIMIT 1',
    args: [NAMESPACE_HOUSEHOLD_ID],
  });
  const row = first.rows[0] as { user_id?: string } | undefined;
  return row?.user_id == null ? null : String(row.user_id);
}

export interface FamilyCallOptions {
  familyId: string;
  actorUserId: string | null;
  /** Path under /api/v1, including any query string. */
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** For log lines only. */
  tool: string;
}

/** Call one family route as the token's actor. Returns the parsed JSON body; throws McpRouteError on non-2xx. */
export async function callFamilyRoute<T = any>(options: FamilyCallOptions): Promise<T> {
  if (!internalFetch) throw new Error('MCP internal fetch is not installed');
  const { familyId, actorUserId, path, method = 'GET', body, tool } = options;

  const userId = await resolveActorUserId(familyId, actorUserId);
  if (!userId) {
    throw new McpRouteError(403, { error: 'This family has no account to act as' });
  }

  const token = jwt.sign({ userId, familyId }, jwtSecret(), { expiresIn: '60s' });
  const res = await internalFetch(
    new Request(`http://internal${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Marks the actor in the request log without a DB column.
        'X-Nido-Via': 'mcp',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    log.warn('mcp tool call rejected by route', {
      event: 'mcp_route_error',
      tool,
      familyId,
      status: res.status,
    });
    throw new McpRouteError(res.status, parsed);
  }
  log.debug('mcp tool call completed', { event: 'mcp_call', tool, familyId, via: 'mcp' });
  return parsed as T;
}
