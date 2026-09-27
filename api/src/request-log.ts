// request-log.ts
// Request-scoped observability for the Hono app: a correlation id, a logger
// bound to that request, an access log with timing, and the terminal handlers
// that turn an uncaught throw or an unmatched route into a log line carrying
// the same id.
//
// This replaces `hono/logger`, which emitted an unparseable one-line-per-
// request string with no id, no duration, and no context to correlate against.

import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { log as rootLog, type Logger } from './logger';
import type { AuthEnv } from './auth';

/**
 * Accept an inbound `X-Request-Id` only if it is short and boring. It is
 * attacker-controlled and ends up in a log line, so anything that could forge
 * a log entry, inject a newline, or bloat the field is replaced instead.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Probes, by default. Kubernetes hits these every few seconds per pod. */
const DEFAULT_SKIP_PATHS = ['/health', '/ready'];

function skipPaths(): Set<string> {
  const configured = process.env.LOG_SKIP_PATHS?.trim();
  if (configured === undefined) return new Set(DEFAULT_SKIP_PATHS);
  if (configured.trim() === '') return new Set<string>();
  return new Set(
    configured
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0),
  );
}

function clientIp(c: Context): string | undefined {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    // Left-most entry is the original client when every hop appended.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip') ?? undefined;
}

export function requestLogger() {
  const skipped = skipPaths();

  return async (c: Context<AuthEnv>, next: Next): Promise<void> => {
    const startedAt = performance.now();
    const inboundId = c.req.header('x-request-id');
    const requestId = inboundId && SAFE_REQUEST_ID.test(inboundId) ? inboundId : randomUUID();

    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);

    // Bound to the request, so every log call from a route or from the
    // request-id carrying middleware below lands with the same correlation id
    // without each call site having to thread it through.
    const reqLog: Logger = rootLog.child({ requestId });
    c.set('log', reqLog);

    // Set before `next()`: requireAuth may reject the request outright, and a
    // 401 with no id in the response is a 401 nobody can trace.
    let failure: unknown;
    try {
      await next();
    } catch (error) {
      // Re-thrown so Hono's errorHandler (below) still runs; captured here so
      // the access log can report the real status rather than 200.
      failure = error;
      throw error;
    } finally {
      // userId/familyId are set by requireAuth further down the chain, so they
      // are only readable now, after the chain has run.
      const path = c.req.path;
      if (!skipped.has(path)) {
        const durationMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
        const status = failure ? statusOf(failure) : c.res?.status ?? 0;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const route = c.req.routePath;

        reqLog[level]('request', {
          event: 'http_request',
          method: c.req.method,
          path,
          // The router pattern, e.g. /api/v1/feedings/:id. Present only when
          // the path matched a route, which is what makes a 404 separable from
          // a 500 on the same URL.
          ...(route && route !== path ? { route } : {}),
          // The query string is deliberately absent: /auth/verify carries a
          // single-use token in it.
          status,
          durationMs,
          contentLength: c.res?.headers.get('content-length') ?? undefined,
          ip: clientIp(c),
          userAgent: c.req.header('user-agent') ?? undefined,
          userId: c.get('userId'),
          familyId: c.get('familyId'),
          ...(failure ? { err: failure } : {}),
        });
      }
    }
  };
}

function statusOf(error: unknown): number {
  if (error instanceof HTTPException) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 100 && status <= 599 ? status : 500;
}

/**
 * Terminal error handler. Hono's default logs the raw error with `console.error`
 * — no request context, and no id in the response to let a user quote back.
 */
export function onError(error: Error, c: Context<AuthEnv>): Response {
  const reqLog = c.get('log') ?? rootLog;
  const status = statusOf(error);
  const requestId = c.get('requestId');

  // `getResponse` marks an error that already carries a real Response (a
  // redirect, a pre-built body). Pass those through untouched or the response
  // is silently replaced by a 500.
  if (typeof (error as { getResponse?: unknown }).getResponse === 'function') {
    return (error as HTTPException).getResponse();
  }

  if (status >= 500) {
    reqLog.error('unhandled request error', {
      event: 'http_error',
      method: c.req.method,
      path: c.req.path,
      route: c.req.routePath,
      status,
      userId: c.get('userId'),
      familyId: c.get('familyId'),
      err: error,
    });
  } else {
    // A 4xx that reached here is a deliberate throw (abort, redirect-as-exception)
    // rather than a bug. Worth seeing, not worth an alert.
    reqLog.warn('request rejected', {
      event: 'http_client_error',
      method: c.req.method,
      path: c.req.path,
      status,
      userId: c.get('userId'),
      err: error,
    });
  }

  // `message` is included only for a deliberate client error. For a 5xx the
  // message is an internal string (SQL text, a stack fragment) and has no
  // business crossing the trust boundary; the requestId is how it gets
  // correlated back to the log line that does have it.
  const body =
    status >= 500
      ? { error: 'Internal Server Error', requestId }
      : { error: error.message || 'Request failed', requestId };

  return c.json(body, status as 400);
}

export function onNotFound(c: Context<AuthEnv>): Response {
  const reqLog = c.get('log') ?? rootLog;
  const requestId = c.get('requestId');
  reqLog.warn('no route matched', {
    event: 'http_not_found',
    method: c.req.method,
    path: c.req.path,
    userId: c.get('userId'),
  });
  return c.json({ error: 'Not Found', requestId }, 404);
}
