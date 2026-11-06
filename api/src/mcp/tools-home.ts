// mcp/tools-home.ts
// The home tool catalog: residences, assets, meters, schedules ("what's due"),
// the maintenance log, and inventory. Each tool wraps the same routes the /home
// screens use; where a route is per-asset, the tool fans out over the family's
// active assets and tags each row with the asset it belongs to.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type RouteAsset, type ToolContext, fetchActiveAssets, fetchList, fetchObject, jsonResult, toolError } from './tool-kit';

export function registerHomeTools(server: McpServer, ctx: ToolContext): void {
  // ── Residences ────────────────────────────────────────────────────────────
  server.registerTool(
    'list_homes',
    {
      title: 'List homes',
      description: 'The residences this family cares for (id, name, address, timezone).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const homes = await fetchList<Record<string, unknown>>(ctx, '/api/v1/families/homes', 'homes', 'list_homes');
        return jsonResult({ homes });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  const getAssets = async (homeId?: number, includeArchived?: boolean): Promise<RouteAsset[]> => {
    const qs = new URLSearchParams();
    if (homeId) qs.set('homeId', String(homeId));
    if (includeArchived) qs.set('includeArchived', 'true');
    const suffix = qs.size ? `?${qs}` : '';
    return fetchList<RouteAsset>(ctx, `/api/v1/home-assets${suffix}`, 'assets', 'list_assets');
  };

  // ── Assets ────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_assets',
    {
      title: 'List assets',
      description: 'The durable things the family owns and cares for — the car, the furnace — optionally scoped to one home.',
      inputSchema: {
        homeId: z.number().int().positive().optional().describe('Limit to one home id from list_homes'),
        includeArchived: z.boolean().optional().describe('Include archived (sold or retired) assets'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ homeId, includeArchived }) => {
      try {
        const assets = await getAssets(homeId, includeArchived);
        return jsonResult({ assets });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Meters ────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_meters',
    {
      title: 'List meters',
      description:
        'Meters (odometer, usage counters) and their schedule status, for one asset or every active asset. Readings are interpolated into a next-due estimate.',
      inputSchema: {
        assetId: z.number().int().positive().optional().describe('Limit to one asset id from list_assets'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ assetId }) => {
      try {
        const assets = assetId
          ? [{ id: assetId, name: String(assetId) } as RouteAsset]
          : await fetchActiveAssets(ctx);
        const tagged = await Promise.all(
          assets.map(async (asset) => {
            const { meters } = await fetchObject<{ meters: Record<string, unknown>[] }>(
              ctx,
              `/api/v1/home-assets/${asset.id}/meters`,
              'list_meters',
            );
            return (meters ?? []).map((m) => ({ assetId: asset.id, assetName: asset.name, ...m }));
          }),
        );
        return jsonResult({ meters: tagged.flat() });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── What's due ────────────────────────────────────────────────────────────
  server.registerTool(
    'whats_due',
    {
      title: "What's due",
      description:
        'Everything due across the family\'s assets — interval, meter and seasonal schedules — overdue first. The same view as the What\'s due screen.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const due = await fetchObject<{ today: string; items: unknown[] }>(ctx, '/api/v1/home-assets/due', 'whats_due');
        return jsonResult({ today: due.today, items: due.items ?? [] });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Maintenance log ───────────────────────────────────────────────────────
  server.registerTool(
    'get_maintenance_log',
    {
      title: 'Get maintenance log',
      description:
        'What was done, when, what it cost and who did it — for one asset or every active asset, with a cost rollup per asset.',
      inputSchema: {
        assetId: z.number().int().positive().optional().describe('Limit to one asset id from list_assets'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ assetId }) => {
      try {
        const assets = assetId
          ? [{ id: assetId, name: String(assetId) } as RouteAsset]
          : await fetchActiveAssets(ctx);
        const perAsset = await Promise.all(
          assets.map(async (asset) => {
            const { entries, rollup } = await fetchObject<{ entries: Record<string, unknown>[]; rollup: unknown }>(
              ctx,
              `/api/v1/home-assets/${asset.id}/maintenance`,
              'get_maintenance_log',
            );
            return {
              assetId: asset.id,
              assetName: asset.name,
              rollup,
              entries: (entries ?? []).map((e) => ({ assetId: asset.id, assetName: asset.name, ...e })),
            };
          }),
        );
        return jsonResult({
          assets: perAsset,
          entries: perAsset.flatMap((a) => a.entries),
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Inventory ─────────────────────────────────────────────────────────────
  server.registerTool(
    'list_inventory',
    {
      title: 'List inventory',
      description: 'Consumable stock the family tracks (nappies, formula, filters) with current quantities and any low-stock alerts.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const inv = await fetchObject<{ items: unknown[]; alerts: unknown[]; unknown?: unknown[] }>(
          ctx,
          '/api/v1/inventory',
          'list_inventory',
        );
        return jsonResult({ items: inv.items ?? [], alerts: inv.alerts ?? [] });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
