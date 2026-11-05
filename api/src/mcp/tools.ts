// mcp/tools.ts
// The tool catalog's entry point: register the domain groups against one
// per-request server, then the resources.
//
// Tools are grouped so each file stays readable: baby/child tracking in
// `tools-baby.ts`, the home/inventory surface in `tools-home.ts`, shared
// plumbing in `tool-kit.ts`. Every tool is a thin shell over an existing
// /api/v1 route (see mcp/caller.ts) — validation, authorization and the tenant
// boundary are the web app's, unchanged.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './tool-kit';
import { callFamilyRoute } from './caller';
import { registerBabyTools } from './tools-baby';
import { registerHomeTools } from './tools-home';

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerBabyTools(server, ctx);
  registerHomeTools(server, ctx);

  // The whole family, as JSON, from the same route the export button uses.
  server.registerResource(
    'family-export',
    'nido://family/export',
    {
      title: 'Family export',
      description:
        'The whole family as JSON — members, formulas, records, settings — the same payload as GET /api/v1/families/export. Owner/admin only.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const data = await callFamilyRoute({ ...ctx, path: '/api/v1/families/export', tool: 'family_export' });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
