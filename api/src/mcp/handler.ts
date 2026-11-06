// mcp/handler.ts
// The POST /mcp endpoint: authenticate a token, bind a per-request MCP server to
// its family, and speak Streamable HTTP through the official SDK.
//
// Stateless by design. Each request gets a fresh McpServer + transport (the SDK
// requires this when no session id is generated), so nothing family-scoped
// outlives the request and the endpoint can run behind a plain load balancer.
import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { assertFamilyId } from '../db-core';
import { getFamilyClient } from '../namespaces';
import { log } from '../logger';
import { resolveMcpToken, touchMcpToken } from './tokens';
import { checkRateLimit } from './rate-limit';
import { registerTools } from './tools';

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: null, error: { code, message } };
}

/**
 * Build the /mcp Hono handler. Mounted outside /api/v1, so the JWT guard does
 * not apply; this authenticates itself with the opaque bearer token.
 */
export function createMcpEndpoint() {
  return async (c: Context): Promise<Response> => {
    // Streamable HTTP is the only transport offered: no legacy SSE fallback.
    if (c.req.method !== 'POST') {
      return c.json(jsonRpcError(-32600, 'Method not allowed — use POST'), 405, { Allow: 'POST' });
    }

    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : (c.req.header('X-Nido-Token')?.trim() ?? null);

    const resolved = await resolveMcpToken(presented);
    // Unknown, revoked and malformed all get the same answer, so there is nothing to probe.
    if (!resolved) {
      return c.json(jsonRpcError(-32001, 'Unauthorized'), 401);
    }

    if (!checkRateLimit(resolved.id)) {
      return c.json(jsonRpcError(-32029, 'Rate limit exceeded — retry shortly'), 429);
    }

    // Fail before the transport is built when the family is unprovisioned or the
    // id is malformed — never touch a path or SQL with an unvalidated id.
    try {
      assertFamilyId(resolved.familyId);
      getFamilyClient(resolved.familyId);
    } catch (error) {
      log.warn('mcp token pointed at an unavailable family', {
        event: 'mcp_family_unavailable',
        tokenId: resolved.id,
        err: error,
      });
      return c.json(jsonRpcError(-32001, 'Unauthorized'), 401);
    }

    // Observability only; must not fail the call.
    void touchMcpToken(resolved.id);

    const server = new McpServer({ name: 'nido', version: '1.0.0' });
    registerTools(server, { familyId: resolved.familyId, actorUserId: resolved.createdByUserId });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // buffered JSON responses, not SSE
    });

    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } catch (error) {
      log.error('mcp request failed', { event: 'mcp_request_failed', tokenId: resolved.id, err: error });
      return c.json(jsonRpcError(-32603, 'Internal error'), 500);
    } finally {
      // A fresh server/transport per request; releasing them keeps nothing
      // family-scoped alive between calls.
      await server.close().catch(() => {});
    }
  };
}
