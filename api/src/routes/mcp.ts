// routes/mcp.ts
// Agent access token management (issue #83), mounted under /api/v1/mcp so the
// existing JWT guard protects it. Minting and revoking are owner/admin actions:
// a token is a standing credential to the whole family.
//
// The plaintext token is returned exactly once, from POST /tokens. It is never
// stored (only its SHA-256 hash is) and never logged.
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '../mcp/tokens';

const mcpRoutes = new Hono<AuthEnv>();

/** The caller's role in the routed family, or null when they are not a member. */
async function familyRole(c: Context<AuthEnv>): Promise<string | null> {
  const db = c.get('db');
  const userId = c.get('userId');
  const res = await db.execute({
    sql: 'SELECT role FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
    args: [userId, NAMESPACE_HOUSEHOLD_ID],
  });
  const row = res.rows[0] as { role?: string } | undefined;
  return row?.role == null ? null : String(row.role);
}

const createTokenSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
});

// GET /tokens — list this family's tokens (hashes never leave the registry).
mcpRoutes.get('/tokens', async (c) => {
  if (!(await familyRole(c))) return c.json({ error: 'No family access' }, 403);
  const tokens = await listMcpTokens(c.get('familyId'));
  return c.json({ tokens });
});

// POST /tokens — mint one. Owner/admin only; the plaintext is in this response and nowhere else.
mcpRoutes.post('/tokens', zValidator('json', createTokenSchema), async (c) => {
  const role = await familyRole(c);
  if (role !== 'owner' && role !== 'admin') {
    return c.json({ error: 'Owner or admin required' }, 403);
  }
  const { label } = (c.req as any).valid('json');
  const { id, plaintext, summary } = await createMcpToken(c.get('familyId'), label ?? null, c.get('userId'));
  c.get('log').info('mcp token created', { event: 'mcp_token_created', tokenId: id, familyId: c.get('familyId') });
  // `token` is the one-time plaintext; `mcpToken` is the stored metadata.
  return c.json({ token: plaintext, mcpToken: summary }, 201);
});

// DELETE /tokens/:id — revoke. Owner/admin only; access ends at the next request.
mcpRoutes.delete('/tokens/:id', async (c) => {
  const role = await familyRole(c);
  if (role !== 'owner' && role !== 'admin') {
    return c.json({ error: 'Owner or admin required' }, 403);
  }
  const id = c.req.param('id');
  const removed = await revokeMcpToken(c.get('familyId'), id);
  if (!removed) return c.json({ error: 'Token not found' }, 404);
  c.get('log').info('mcp token revoked', { event: 'mcp_token_revoked', tokenId: id, familyId: c.get('familyId') });
  return c.json({ message: 'Token revoked' });
});

export default mcpRoutes;
export { mcpRoutes };
