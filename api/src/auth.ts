import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import type { SqliteFacade } from './db-core';
import { getFamilyClient } from './db-namespaces';

// Route handlers read the authenticated user via c.get('userId'), the routed
// family via c.get('familyId'), and that family's namespace client via
// c.get('db'). Route groups that handle protected endpoints must be typed as
// Hono<AuthEnv> so c.get resolves to the right types.
export type AuthEnv = { Variables: { userId: string; familyId: string; db: SqliteFacade } };

// Endpoints reachable without a token. Everything else under /api/v1 requires
// a valid Bearer JWT (verified in requireAuth).
export const PUBLIC_AUTH_PATHS = new Set([
	'/api/v1/auth/register',
	'/api/v1/auth/login',
	'/api/v1/auth/verify-email',
	'/api/v1/auth/forgot-password',
	'/api/v1/auth/reset-password',
]);

// Single source of truth for the signing/verification secret. Must match the
// fallback used by authRoutes (jsonwebtoken): JWT_SECRET env beats the
// development-only fallback.
export function jwtSecret(): string {
	return process.env.JWT_SECRET || 'fallback-secret-key';
}

// Global auth guard for protected API routes. Verifies the Bearer token and
// puts the verified identity on the request context: userId, familyId, and the
// routed family namespace client. getFamilyClient throws when the family is
// not provisioned or the id is malformed, so it must stay inside the try/catch
// that maps failures to 401. Never trusts client-supplied identity headers
// (the previous X-User-ID approach allowed account takeover).
export async function requireAuth(c: Context<AuthEnv>, next: Next): Promise<Response | void> {
	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	const token = authHeader.substring(7);
	try {
		const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
		if (payload.userId === undefined || payload.userId === null) {
			return c.json({ error: 'Unauthorized' }, 401);
		}
		if (payload.familyId === undefined || payload.familyId === null) {
			return c.json({ error: 'Unauthorized' }, 401);
		}
		c.set('userId', String(payload.userId));
		c.set('familyId', String(payload.familyId));
		c.set('db', getFamilyClient(String(payload.familyId)));
		await next();
	} catch {
		return c.json({ error: 'Unauthorized' }, 401);
	}
}