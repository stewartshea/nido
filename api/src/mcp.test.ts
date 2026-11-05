// src/mcp.test.ts
// Agent access tokens and the /mcp tool server (issue #83).
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import app from './server';
import { ensureRegistry, getFamilyClient } from './namespaces';
import { resetRateLimits } from './mcp/rate-limit';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';
const PROTOCOL_VERSION = '2025-06-18';

interface Registered {
  token: string;
  familyId: string;
  userId: string;
}

async function registerFamily(email: string): Promise<Registered> {
  const res = await app.fetch(
    new Request('http://localhost/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'StrongP4ss!', firstName: 'Mcp', lastName: 'Tester' }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
  return { token: body.token, familyId: String(decoded.familyId), userId: String(decoded.userId) };
}

async function addChild(jwtToken: string, name: string): Promise<number> {
  const res = await app.fetch(
    new Request('http://localhost/api/v1/families/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ type: 'child', name, birthDate: '2025-01-01T00:00:00.000Z' }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { member: { id: number } };
  return body.member.id;
}

async function mintToken(jwtToken: string, label?: string): Promise<{ plaintext: string; id: string }> {
  const res = await app.fetch(
    new Request('http://localhost/api/v1/mcp/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ label }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; mcpToken: { id: string } };
  return { plaintext: body.token, id: body.mcpToken.id };
}

async function mcp(token: string | null, message: unknown) {
  const res = await app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
      },
      body: JSON.stringify(message),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function initialize(token: string) {
  return mcp(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
  });
}

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  return mcp(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
}

describe('mcp token management', () => {
  it('mints a prefixed token, stores only its hash, and lists it', async () => {
    const fam = await registerFamily('mcp-mint@example.com');
    const { plaintext, id } = await mintToken(fam.token, 'my agent');

    expect(plaintext.startsWith('nido_mcp_')).toBe(true);

    const registry = await ensureRegistry();
    const row = (
      await registry.execute({ sql: 'SELECT token_hash, family_id, label FROM mcp_tokens WHERE id = ?', args: [id] })
    ).rows[0] as { token_hash: string; family_id: string; label: string };
    expect(row.family_id).toBe(fam.familyId);
    expect(row.label).toBe('my agent');
    // Stored as a 64-hex SHA-256 digest, never the plaintext.
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(plaintext);

    const listRes = await app.fetch(
      new Request('http://localhost/api/v1/mcp/tokens', { headers: { Authorization: `Bearer ${fam.token}` } }),
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { tokens: Array<Record<string, unknown>> };
    expect(list.tokens).toHaveLength(1);
    // The hash and the plaintext never appear in a listing.
    expect(JSON.stringify(list)).not.toContain('token_hash');
    expect(JSON.stringify(list)).not.toContain(plaintext);
  });

  it('refuses minting to a non-owner member', async () => {
    const fam = await registerFamily('mcp-role@example.com');
    const db = getFamilyClient(fam.familyId);
    const memberId = randomUUID();
    await db.execute({
      sql: `INSERT INTO users (id, email, password_hash, first_name, last_name, email_verified, created_at, updated_at)
            VALUES (?, ?, 'x', 'Mem', 'Ber', 1, ?, ?)`,
      args: [memberId, 'plain-member@example.com', new Date().toISOString(), new Date().toISOString()],
    });
    await db.execute({
      sql: 'INSERT INTO user_households (user_id, household_id, role) VALUES (?, 1, ?)',
      args: [memberId, 'member'],
    });
    const memberJwt = jwt.sign({ userId: memberId, familyId: fam.familyId, role: 'member' }, JWT_SECRET, { expiresIn: '1h' });

    const res = await app.fetch(
      new Request('http://localhost/api/v1/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
        body: JSON.stringify({ label: 'nope' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('revoking a token ends access', async () => {
    const fam = await registerFamily('mcp-revoke@example.com');
    const { plaintext, id } = await mintToken(fam.token);
    expect((await initialize(plaintext)).status).toBe(200);

    const del = await app.fetch(
      new Request(`http://localhost/api/v1/mcp/tokens/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${fam.token}` },
      }),
    );
    expect(del.status).toBe(200);

    expect((await initialize(plaintext)).status).toBe(401);
  });
});

describe('mcp endpoint', () => {
  it('rejects missing, unknown and malformed tokens with 401', async () => {
    expect((await mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    const bad = await mcp('nido_mcp_not-a-real-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(bad.status).toBe(401);
    expect((await mcp('some.jwt.token', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it('rejects non-POST methods with 405', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('initializes, lists tools, and exposes the export resource', async () => {
    const fam = await registerFamily('mcp-proto@example.com');
    const { plaintext } = await mintToken(fam.token);

    const init = await initialize(plaintext);
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('nido');
    expect(init.body.result.capabilities.tools).toBeDefined();

    const list = await mcp(plaintext, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (list.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_children', 'get_feedings', 'get_diapers', 'get_sleep', 'get_family_summary', 'log_feed']),
    );

    const resources = await mcp(plaintext, { jsonrpc: '2.0', id: 3, method: 'resources/list' });
    const uris = (resources.body.result.resources as Array<{ uri: string }>).map((r) => r.uri);
    expect(uris).toContain('nido://family/export');

    const read = await mcp(plaintext, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'nido://family/export' } });
    const exported = JSON.parse((read.body.result.contents as Array<{ text: string }>)[0].text);
    expect(exported.app).toBe('Nido');
    expect(exported.family.familyId).toBe(fam.familyId);
  });

  it('lists children and logs then reads a feed through the real routes', async () => {
    const fam = await registerFamily('mcp-feed@example.com');
    const childId = await addChild(fam.token, 'Nest');
    const { plaintext } = await mintToken(fam.token);

    const childrenRes = await callTool(plaintext, 'list_children', {});
    const children = (childrenRes.body.result.structuredContent as { children: Array<{ id: number }> }).children;
    expect(children.map((c) => c.id)).toContain(childId);

    const logRes = await callTool(plaintext, 'log_feed', { memberId: childId, type: 'bottle', amount: 40, amountUnit: 'ml' });
    expect(logRes.body.result.isError).toBeFalsy();
    const created = logRes.body.result.structuredContent as { feeding: { amount: number; amount_unit: string } };
    expect(created.feeding.amount).toBe(40);
    expect(created.feeding.amount_unit).toBe('ml');

    const readRes = await callTool(plaintext, 'get_feedings', { memberId: childId });
    const feedings = (readRes.body.result.structuredContent as { feedings: Array<{ amount: number }> }).feedings;
    expect(feedings).toHaveLength(1);
    expect(feedings[0]!.amount).toBe(40);

    // The write is a real record: it is in the family database.
    const db = getFamilyClient(fam.familyId);
    const dbRows = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM feedings' });
    expect(Number((dbRows.rows[0] as { n: number }).n)).toBe(1);
  });

  it('summarizes a window of feed, diaper and sleep counts', async () => {
    const fam = await registerFamily('mcp-summary@example.com');
    const childId = await addChild(fam.token, 'Wren');
    const { plaintext } = await mintToken(fam.token);

    await callTool(plaintext, 'log_feed', { memberId: childId, type: 'bottle', amount: 100, amountUnit: 'ml' });
    await callTool(plaintext, 'log_feed', { memberId: childId, type: 'breast', side: 'left' });
    const summaryRes = await callTool(plaintext, 'get_family_summary', { days: 7 });
    const summary = summaryRes.body.result.structuredContent as {
      children: Array<{ memberId: number; feedings: number }>;
      totals: { feedings: number; feedAmountOz: number };
    };
    expect(summary.totals.feedings).toBe(2);
    // 100 mL + no amount for the breast feed = ~3.38 oz
    expect(summary.totals.feedAmountOz).toBeCloseTo(3.38, 1);
    expect(summary.children.find((c) => c.memberId === childId)?.feedings).toBe(2);
  });

  it('keeps families isolated: a token can only reach its own family', async () => {
    const a = await registerFamily('mcp-iso-a@example.com');
    const b = await registerFamily('mcp-iso-b@example.com');
    const childA = await addChild(a.token, 'Alpha');
    const childB = await addChild(b.token, 'Beta');
    const tokenA = (await mintToken(a.token)).plaintext;
    const tokenB = (await mintToken(b.token)).plaintext;

    await callTool(tokenA, 'log_feed', { memberId: childA, type: 'bottle', amount: 50 });
    // A recognisable amount in the other family, to prove it never crosses over.
    await callTool(tokenB, 'log_feed', { memberId: childB, type: 'bottle', amount: 99 });

    const readA = await callTool(tokenA, 'get_feedings', { memberId: childA });
    const feedingsA = (readA.body.result.structuredContent as { feedings: Array<{ amount: number }> }).feedings;
    expect(feedingsA.map((f) => f.amount)).toEqual([50]);

    // The token's family is the only one it can list.
    const childrenA = (await callTool(tokenA, 'list_children', {})).body.result.structuredContent as {
      children: Array<{ name: string }>;
    };
    expect(childrenA.children.map((c) => c.name)).toEqual(['Alpha']);

    // Family B's record is unreachable with A's token — same member id or not,
    // the query only ever opens family A's database.
    const crossRead = await callTool(tokenA, 'get_feedings', { memberId: childB });
    const cross = crossRead.body.result.isError
      ? []
      : ((crossRead.body.result.structuredContent as { feedings: Array<{ amount: number }> }).feedings ?? []);
    expect(cross.some((f) => f.amount === 99)).toBe(false);

    const dbB = getFamilyClient(b.familyId);
    const bRows = await dbB.execute({ sql: 'SELECT COUNT(*) AS n FROM feedings' });
    expect(Number((bRows.rows[0] as { n: number }).n)).toBe(1);
  });

  it('accepts an initialized notification and serves stateless calls without a session', async () => {
    const fam = await registerFamily('mcp-notify@example.com');
    const { plaintext } = await mintToken(fam.token);

    const notif = await mcp(plaintext, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notif.status).toBe(202);

    // No session id is issued, and a fresh request still lists tools.
    const list = await mcp(plaintext, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.result.tools)).toBe(true);
  });

  it('rate limits a token that floods the endpoint', async () => {
    resetRateLimits();
    const fam = await registerFamily('mcp-rate@example.com');
    const { plaintext } = await mintToken(fam.token);

    let sawLimit = false;
    for (let i = 0; i < 130; i++) {
      const res = await mcp(plaintext, { jsonrpc: '2.0', id: i, method: 'tools/list' });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
