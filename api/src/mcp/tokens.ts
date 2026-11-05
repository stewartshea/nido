// mcp/tokens.ts
// Agent access tokens (issue #83): mint, resolve, list, revoke.
//
// A token is an opaque bearer credential — `nido_mcp_` + 32 random bytes,
// base64url. Only its SHA-256 hash is stored, in the registry `mcp_tokens`
// table, because the table is auth routing (token -> familyId), not per-family
// application data. The plaintext is returned to the caller exactly once, at
// creation, and is never persisted or logged.
//
// SHA-256, not bcrypt: the token is 256 bits of uniform randomness, so there is
// no dictionary to slow down, and verification must be fast on every request.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureRegistry } from '../namespaces';

/** Fixed prefix so a leaked token is greppable and non-MCP credentials are rejected before any DB read. */
export const MCP_TOKEN_PREFIX = 'nido_mcp_';

export interface McpTokenRecord {
  id: string;
  familyId: string;
  tokenHash: string;
  label: string | null;
  createdByUserId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The shape returned to the owner when listing — never includes the hash. */
export interface McpTokenSummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ResolvedMcpToken {
  id: string;
  familyId: string;
  createdByUserId: string | null;
}

export function hashMcpToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** A fresh plaintext token. The caller must return `plaintext` to the user and store only `hash`. */
export function generateMcpToken(): { plaintext: string; hash: string } {
  const plaintext = MCP_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { plaintext, hash: hashMcpToken(plaintext) };
}

/** Create and store a token. The plaintext is returned once and not recoverable. */
export async function createMcpToken(
  familyId: string,
  label: string | null,
  createdByUserId: string,
): Promise<{ id: string; plaintext: string; summary: McpTokenSummary }> {
  const registry = await ensureRegistry();
  const id = randomUUID();
  const { plaintext, hash } = generateMcpToken();
  const createdAt = new Date().toISOString();
  await registry.execute({
    sql: `INSERT INTO mcp_tokens (id, family_id, token_hash, label, created_by_user_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, familyId, hash, label, createdByUserId, createdAt],
  });
  return {
    id,
    plaintext,
    summary: { id, label, createdAt, lastUsedAt: null },
  };
}

/** Tokens for one family, newest first. Scoped by family_id so it can never list another family's. */
export async function listMcpTokens(familyId: string): Promise<McpTokenSummary[]> {
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: `SELECT id, label, created_at, last_used_at FROM mcp_tokens
          WHERE family_id = ? ORDER BY created_at DESC`,
    args: [familyId],
  });
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      label: r.label == null ? null : String(r.label),
      createdAt: String(r.created_at),
      lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
    };
  });
}

/** Delete a token. Scoped by family_id; returns whether a row was removed. */
export async function revokeMcpToken(familyId: string, id: string): Promise<boolean> {
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: 'DELETE FROM mcp_tokens WHERE id = ? AND family_id = ?',
    args: [id, familyId],
  });
  return Number(res.rowsAffected ?? 0) > 0;
}

/**
 * Resolve a presented token to its family. Returns null for anything unknown or
 * malformed — the same null for a revoked token and a made-up one, so there is
 * nothing to probe. The `nido_mcp_` prefix is checked before hashing so a stray
 * JWT never reaches the token table.
 */
export async function resolveMcpToken(plaintext: string | null | undefined): Promise<ResolvedMcpToken | null> {
  if (!plaintext || !plaintext.startsWith(MCP_TOKEN_PREFIX)) return null;
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: 'SELECT id, family_id, created_by_user_id FROM mcp_tokens WHERE token_hash = ? LIMIT 1',
    args: [hashMcpToken(plaintext)],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    familyId: String(row.family_id),
    createdByUserId: row.created_by_user_id == null ? null : String(row.created_by_user_id),
  };
}

/** Record a successful use. Best-effort: a failure here must not fail the call. */
export async function touchMcpToken(id: string): Promise<void> {
  try {
    const registry = await ensureRegistry();
    await registry.execute({
      sql: 'UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?',
      args: [new Date().toISOString(), id],
    });
  } catch {
    // last_used_at is observability, not correctness.
  }
}
