import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import type { SqliteFacade } from './db-core';
import type { Logger } from './logger';
import { getFamilyClient } from './db-namespaces';

// Route handlers read the authenticated user via c.get('userId'), the routed
// family via c.get('familyId'), that family's namespace client via c.get('db'),
// and a logger already bound to the request's correlation id via c.get('log').
// Route groups that handle protected endpoints must be typed as Hono<AuthEnv>
// so c.get resolves to the right types.
export type AuthEnv = {
  Variables: {
    userId: string;
    familyId: string;
    db: SqliteFacade;
    /** Correlation id, echoed back on the response as X-Request-Id. */
    requestId: string;
    /** Request-scoped logger. Prefer this over the root `log`. */
    log: Logger;
  };
};

// Endpoints reachable without a token. Everything else under /api/v1 requires
// a valid Bearer JWT (verified in requireAuth).
export const PUBLIC_AUTH_PATHS = new Set([
	'/api/v1/auth/register',
	'/api/v1/auth/login',
	'/api/v1/auth/verify-email',
	'/api/v1/auth/forgot-password',
	'/api/v1/auth/reset-password',
]);

// A known default here would let anyone mint a valid session token.
export function jwtSecret(): string {
	const env = process.env.JWT_SECRET?.trim();
	if (!env) {
		throw new Error(
			'JWT_SECRET is not set. It is required: there is no default. ' +
				'Generate one with `openssl rand -hex 32` and supply it via the environment. ' +
				'Changing it later invalidates every issued session.',
		);
	}
	return env;
}

// Global auth guard for protected API routes. Verifies the Bearer token and
// puts the verified identity on the request context: userId, familyId, and the
// routed family namespace client. Never trusts client-supplied identity headers
// (the previous X-User-ID approach allowed account takeover).
//
// Only token verification is wrapped in try/catch. `await next()` must stay
// outside it: when it was inside, a throw from any route handler was caught
// here and reported to the client as 401 Unauthorized, hiding real 500s from
// both the caller and the error handler.
export async function requireAuth(c: Context<AuthEnv>, next: Next): Promise<Response | void> {
	const log = c.get('log');
	const requestId = c.get('requestId');
	const unauthorized = (reason: string) => {
		log.warn('request rejected by auth guard', {
			event: 'auth_rejected',
			reason,
			method: c.req.method,
			path: c.req.path,
		});
		return c.json({ error: 'Unauthorized', requestId }, 401);
	};

	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return unauthorized('missing_bearer_token');
	}
	const token = authHeader.substring(7);

	let payload: jwt.JwtPayload;
	try {
		payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
	} catch {
		// The token itself is never logged — it is a bearer credential.
		return unauthorized('invalid_token');
	}
	if (payload.userId === undefined || payload.userId === null) {
		return unauthorized('token_missing_user_id');
	}
	if (payload.familyId === undefined || payload.familyId === null) {
		return unauthorized('token_missing_family_id');
	}

	const userId = String(payload.userId);
	const familyId = String(payload.familyId);
	try {
		c.set('db', getFamilyClient(familyId));
	} catch (error) {
		// Thrown when the family is not provisioned or the id is malformed.
		log.warn('family namespace unavailable', {
			event: 'auth_family_unavailable',
			familyId,
			userId,
			err: error,
		});
		return unauthorized('family_unavailable');
	}

	c.set('userId', userId);
	c.set('familyId', familyId);
	// Re-bind so handler logs below carry the identity without each call site adding it.
	c.set('log', log.child({ userId, familyId }));

	return next();
}