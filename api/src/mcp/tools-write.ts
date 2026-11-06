// mcp/tools-write.ts
// The write catalog: creating records, and correcting ones that were created.
//
// Record categories (feedings, diapers, sleep, growth, milestones,
// vaccinations, journal) share one registration helper — they are the same
// create-then-update shape over `category-routes.ts`. The rest (appointments,
// assets, inventory, meters, maintenance) get bespoke tools because their
// routes are bespoke.
//
// There is no delete tool. A delete is destructive and irreversible, and it
// deserves its own design (provenance, confirmation) rather than riding in on
// the logging surface.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ToolContext, jsonResult, toolError } from './tool-kit';
import { callFamilyRoute } from './caller';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = (what: string) => z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)').describe(what);
const idField = z.number().int().positive();

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

type Shape = z.ZodRawShape;

interface RecordWriteSpec {
  /** The /api/v1 route segment. */
  category: string;
  /** The key the route returns the row under (message aside). */
  itemKey: string;
  label: string;
  create: { name: string; title: string; description: string; shape: Shape; describeId?: string };
  update: { name: string; title: string; description: string; shape: Shape };
  /** Values filled in when the agent omits them (e.g. a default timestamp). */
  defaults?: Record<string, () => unknown>;
}

/** Return the created/updated row under a uniform `record` key, or just the message when the route returns no row. */
function recordResult(data: Record<string, unknown>, itemKey: string) {
  const record = data[itemKey];
  return jsonResult(record === undefined ? { message: data.message } : { message: data.message, record });
}

/** Register a create + update pair for one category-style record. */
function registerRecordWrites(server: McpServer, ctx: ToolContext, spec: RecordWriteSpec): void {
  server.registerTool(
    spec.create.name,
    {
      title: spec.create.title,
      description: spec.create.description,
      inputSchema: spec.create.shape,
      annotations: WRITE,
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = { ...args };
        for (const [key, make] of Object.entries(spec.defaults ?? {})) {
          if (body[key] === undefined || body[key] === null) body[key] = make();
        }
        const data = await callFamilyRoute<Record<string, unknown>>({
          ...ctx,
          path: `/api/v1/${spec.category}`,
          method: 'POST',
          body,
          tool: spec.create.name,
        });
        return recordResult(data, spec.itemKey);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    spec.update.name,
    {
      title: spec.update.title,
      description: spec.update.description,
      inputSchema: { id: idField.describe(spec.create.describeId ?? `The ${spec.label} id`), ...spec.update.shape },
      annotations: UPDATE,
    },
    async (args) => {
      try {
        const { id, ...body } = args as { id: number } & Record<string, unknown>;
        const data = await callFamilyRoute<Record<string, unknown>>({
          ...ctx,
          path: `/api/v1/${spec.category}/${id}`,
          method: 'PUT',
          body,
          tool: spec.update.name,
        });
        return recordResult(data, spec.itemKey);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

const RECORD_SPECS: RecordWriteSpec[] = [
  {
    category: 'feedings',
    itemKey: 'feeding',
    label: 'feeding',
    create: {
      name: 'log_feed',
      title: 'Log a feeding',
      description:
        'Record a feeding (breast, bottle, formula, pump or solid) for one child. Appears in the log like any other entry.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        type: z.enum(['breast', 'bottle', 'formula', 'pump', 'solid']).describe('Feeding type'),
        startTime: z.string().optional().describe('ISO 8601 start (default: now)'),
        endTime: z.string().optional().describe('ISO 8601 end'),
        amount: z.number().positive().optional().describe('Amount, for bottle/formula/pump'),
        amountUnit: z.enum(['ml', 'oz']).optional().describe('Unit for `amount` (default oz)'),
        side: z.enum(['left', 'right', 'both']).optional().describe('Breast side, for a breast feed'),
        notes: z.string().optional(),
      },
    },
    update: {
      name: 'update_feed',
      title: 'Update a feeding',
      description: 'Correct an existing feeding (wrong time, amount, type or notes). Only the fields you pass change.',
      shape: {
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        amount: z.number().positive().optional(),
        amountUnit: z.enum(['ml', 'oz']).optional(),
        type: z.enum(['breast', 'bottle', 'formula', 'pump', 'solid']).optional(),
        side: z.enum(['left', 'right', 'both']).optional(),
        notes: z.string().optional(),
      },
    },
    defaults: { startTime: () => new Date().toISOString() },
  },
  {
    category: 'diapers',
    itemKey: 'diaper',
    label: 'diaper',
    create: {
      name: 'log_diaper',
      title: 'Log a diaper',
      description: 'Record a diaper change for one child.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        changeTime: z.string().optional().describe('ISO 8601 (default: now)'),
        type: z.enum(['wet', 'dirty', 'both', 'dry']),
        color: z.string().optional().describe('For solid waste'),
        consistency: z.string().optional().describe('Loose, formed, etc.'),
        notes: z.string().optional(),
      },
    },
    update: {
      name: 'update_diaper',
      title: 'Update a diaper',
      description: 'Correct an existing diaper change.',
      shape: {
        changeTime: z.string().optional(),
        type: z.enum(['wet', 'dirty', 'both', 'dry']).optional(),
        color: z.string().optional(),
        consistency: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    defaults: { changeTime: () => new Date().toISOString() },
  },
  {
    category: 'sleep',
    itemKey: 'sleep',
    label: 'sleep session',
    create: {
      name: 'log_sleep',
      title: 'Log sleep',
      description: 'Record a sleep session for one child (start, and end when they wake).',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        startTime: z.string().optional().describe('ISO 8601 start (default: now)'),
        endTime: z.string().optional().describe('ISO 8601 end, if the session has finished'),
        location: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    update: {
      name: 'update_sleep',
      title: 'Update sleep',
      description: 'Correct an existing sleep session (e.g. set its end when the child wakes).',
      shape: {
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        location: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    defaults: { startTime: () => new Date().toISOString() },
  },
  {
    category: 'growth',
    itemKey: 'growth',
    label: 'growth record',
    create: {
      name: 'log_growth',
      title: 'Log a growth measurement',
      description:
        'Record a growth measurement (weight, height, head circumference) for one child. The route returns WHO/CDC age percentiles.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        measurementDate: z.string().optional().describe('ISO 8601 (default: now)'),
        weight: z.number().positive().optional().describe('In `unitSystem` units'),
        height: z.number().positive().optional(),
        headCircumference: z.number().positive().optional(),
        bmi: z.number().positive().optional(),
        unitSystem: z.enum(['imperial', 'metric']).optional().describe('Default imperial'),
        notes: z.string().optional(),
      },
    },
    update: {
      name: 'update_growth',
      title: 'Update a growth measurement',
      description: 'Correct an existing growth record.',
      shape: {
        measurementDate: z.string().optional(),
        weight: z.number().positive().optional(),
        height: z.number().positive().optional(),
        headCircumference: z.number().positive().optional(),
        bmi: z.number().positive().optional(),
        unitSystem: z.enum(['imperial', 'metric']).optional(),
        notes: z.string().optional(),
      },
    },
    defaults: { measurementDate: () => new Date().toISOString() },
  },
  {
    category: 'milestones',
    itemKey: 'milestone',
    label: 'milestone',
    create: {
      name: 'log_milestone',
      title: 'Log a milestone',
      description:
        'Record a milestone for one child (first smile, first steps). A future date is refused — book it as an appointment instead.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        title: z.string().min(1),
        description: z.string().optional(),
        achievedDate: z.string().optional().describe('ISO 8601 (default: now)'),
        kind: z.string().optional().describe('Milestone kind, e.g. milestones'),
        category: z.string().max(80).optional().describe('Option value, e.g. physical, social, language'),
        tags: z.array(z.string().max(40)).max(10).optional(),
      },
    },
    update: {
      name: 'update_milestone',
      title: 'Update a milestone',
      description: 'Correct an existing milestone.',
      shape: {
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        achievedDate: z.string().optional(),
        kind: z.string().optional(),
        category: z.string().max(80).optional(),
        tags: z.array(z.string().max(40)).max(10).optional(),
      },
    },
    defaults: { achievedDate: () => new Date().toISOString() },
  },
  {
    category: 'vaccinations',
    itemKey: 'vaccination',
    label: 'vaccination',
    create: {
      name: 'log_vaccination',
      title: 'Log a vaccination',
      description: 'Record a vaccination given to one child.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        name: z.string().min(1).describe('Vaccine name, e.g. DTaP'),
        dateGiven: z.string().optional().describe('ISO 8601 (default: now)'),
        nextDueDate: z.string().optional().describe('ISO 8601'),
        administeredBy: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    update: {
      name: 'update_vaccination',
      title: 'Update a vaccination',
      description: 'Correct an existing vaccination record.',
      shape: {
        name: z.string().min(1).optional(),
        dateGiven: z.string().optional(),
        nextDueDate: z.string().optional(),
        administeredBy: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    defaults: { dateGiven: () => new Date().toISOString() },
  },
  {
    category: 'journal',
    itemKey: 'entry',
    label: 'journal entry',
    create: {
      name: 'add_journal_entry',
      title: 'Add a journal entry',
      description: 'Add a free-form journal entry for one child.',
      shape: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        title: z.string().max(200).optional(),
        body: z.string().max(20000).optional(),
        entryDate: z.string().optional().describe('ISO 8601 (default: now)'),
      },
    },
    update: {
      name: 'update_journal_entry',
      title: 'Update a journal entry',
      description: 'Correct an existing journal entry.',
      shape: {
        title: z.string().max(200).optional(),
        body: z.string().max(20000).optional(),
        entryDate: z.string().optional(),
      },
    },
    defaults: { entryDate: () => new Date().toISOString() },
  },
];

export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  for (const spec of RECORD_SPECS) registerRecordWrites(server, ctx, spec);

  // ── Appointments (plans) ──────────────────────────────────────────────────
  server.registerTool(
    'create_appointment',
    {
      title: 'Book an appointment',
      description:
        'Book an appointment for one child. `category` is a bookable category (e.g. appointments, medical, vaccines); `data` carries that category\'s option, e.g. {"type":"checkup"}.',
      inputSchema: {
        memberId: z.number().int().positive().describe('The child id from list_children'),
        category: z.string().min(1).max(40),
        scheduledAt: z.string().describe('ISO 8601 when it is booked for'),
        title: z.string().max(200).optional(),
        notes: z.string().max(5000).optional(),
        data: z.record(z.unknown()).optional().describe("The category's option, e.g. {type:'checkup'}"),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const data = await callFamilyRoute<{ message: string; plan: unknown }>({
          ...ctx,
          path: '/api/v1/plans',
          method: 'POST',
          body: args,
          tool: 'create_appointment',
        });
        return jsonResult({ message: data.message, appointment: data.plan });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'reschedule_appointment',
    {
      title: 'Reschedule an appointment',
      description: 'Move an open appointment to a new time.',
      inputSchema: {
        id: idField.describe('The appointment (plan) id, from get_appointments'),
        scheduledAt: z.string().describe('New ISO 8601 time'),
      },
      annotations: UPDATE,
    },
    async ({ id, scheduledAt }) => {
      try {
        const data = await callFamilyRoute<{ message: string; plan: unknown }>({
          ...ctx,
          path: `/api/v1/plans/${id}/reschedule`,
          method: 'POST',
          body: { scheduledAt },
          tool: 'reschedule_appointment',
        });
        return jsonResult({ message: data.message, appointment: data.plan });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Assets ────────────────────────────────────────────────────────────────
  const assetShape: Shape = {
    name: z.string().min(1).max(200),
    category: z.enum(['vehicle', 'appliance', 'hvac', 'structure', 'outdoor', 'other']),
    homeId: z.number().int().positive().nullable().optional().describe('The home it lives at; omit for family-wide'),
    identity: z
      .object({
        manufacturer: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        modelYear: z.number().int().nullable().optional(),
        serial: z.string().nullable().optional(),
      })
      .optional(),
    acquiredAt: dateOnly('When it was acquired (YYYY-MM-DD)').nullable().optional(),
    purchasePrice: z.number().int().min(0).nullable().optional().describe('In cents'),
    notes: z.string().max(2000).nullable().optional(),
  };

  server.registerTool(
    'add_asset',
    {
      title: 'Add an asset',
      description: 'Register a durable thing the family owns and cares for — the car, the furnace.',
      inputSchema: assetShape,
      annotations: WRITE,
    },
    async (args) => {
      try {
        const data = await callFamilyRoute<{ asset: unknown }>({
          ...ctx,
          path: '/api/v1/home-assets',
          method: 'POST',
          body: args,
          tool: 'add_asset',
        });
        return jsonResult({ asset: data.asset });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  const assetUpdateShape: Shape = {
    name: z.string().min(1).max(200).optional(),
    category: z.enum(['vehicle', 'appliance', 'hvac', 'structure', 'outdoor', 'other']).optional(),
    homeId: z.number().int().positive().nullable().optional(),
    identity: z
      .object({
        manufacturer: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        modelYear: z.number().int().nullable().optional(),
        serial: z.string().nullable().optional(),
      })
      .optional(),
    acquiredAt: dateOnly('When it was acquired (YYYY-MM-DD)').nullable().optional(),
    purchasePrice: z.number().int().min(0).nullable().optional().describe('In cents'),
    notes: z.string().max(2000).nullable().optional(),
  };

  server.registerTool(
    'update_asset',
    {
      title: 'Update an asset',
      description: 'Correct an existing asset (name, category, home, identity, notes).',
      inputSchema: { id: idField.describe('The asset id, from list_assets'), ...assetUpdateShape },
      annotations: UPDATE,
    },
    async (args) => {
      try {
        const { id, ...body } = args as { id: number } & Record<string, unknown>;
        const data = await callFamilyRoute<{ asset: unknown }>({
          ...ctx,
          path: `/api/v1/home-assets/${id}`,
          method: 'PUT',
          body,
          tool: 'update_asset',
        });
        return jsonResult({ asset: data.asset });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Meters ────────────────────────────────────────────────────────────────
  server.registerTool(
    'add_meter_reading',
    {
      title: 'Add a meter reading',
      description: 'Record a new reading on a meter (odometer, usage counter). Dated readings drive the schedule estimates.',
      inputSchema: {
        meterId: idField.describe('The meter id, from list_meters'),
        value: z.number().min(0).describe('The reading, in the meter\'s unit'),
        recordedAt: dateOnly('The date of the reading (YYYY-MM-DD; default: today)').optional(),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const data = await callFamilyRoute<{ meter: unknown }>({
          ...ctx,
          path: `/api/v1/home-assets/meters/${args.meterId}/readings`,
          method: 'POST',
          body: args.recordedAt === undefined ? { value: args.value } : { value: args.value, recordedAt: args.recordedAt },
          tool: 'add_meter_reading',
        });
        return jsonResult({ meter: data.meter });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Maintenance ───────────────────────────────────────────────────────────
  server.registerTool(
    'log_maintenance',
    {
      title: 'Log maintenance',
      description:
        'Record maintenance against an asset: what was done, when, what it cost. Can attach meter readings and consume inventory stock.',
      inputSchema: {
        assetId: idField.describe('The asset id, from list_assets'),
        task: z.string().min(1).max(200).describe('What was done, e.g. "Filter change"'),
        performedAt: dateOnly('When it was done (YYYY-MM-DD)'),
        scheduleId: z.number().int().positive().optional().describe('The schedule this satisfies, if any'),
        cost: z.number().int().min(0).optional().describe('In cents'),
        notes: z.string().max(4000).optional(),
        meterReadings: z
          .array(z.object({ meterId: z.number().int().positive(), value: z.number().min(0) }))
          .max(10)
          .optional(),
        consumedItems: z
          .array(z.object({ itemId: z.number().int().positive(), quantity: z.number().positive() }))
          .max(20)
          .optional(),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const { assetId, ...body } = args;
        const data = await callFamilyRoute<{ entry: unknown }>({
          ...ctx,
          path: `/api/v1/home-assets/${assetId}/maintenance`,
          method: 'POST',
          body,
          tool: 'log_maintenance',
        });
        return jsonResult({ entry: data.entry });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'update_maintenance',
    {
      title: 'Update a maintenance entry',
      description: 'Correct an existing maintenance entry.',
      inputSchema: {
        entryId: idField.describe('The entry id, from get_maintenance_log'),
        scheduleId: z.number().int().positive().nullable().optional(),
        task: z.string().min(1).max(200).optional(),
        performedAt: dateOnly('When it was done (YYYY-MM-DD)').optional(),
        cost: z.number().int().min(0).nullable().optional().describe('In cents'),
        notes: z.string().max(4000).nullable().optional(),
      },
      annotations: UPDATE,
    },
    async (args) => {
      try {
        const { entryId, ...body } = args;
        const data = await callFamilyRoute<{ entry: unknown }>({
          ...ctx,
          path: `/api/v1/home-assets/maintenance/${entryId}`,
          method: 'PUT',
          body,
          tool: 'update_maintenance',
        });
        return jsonResult({ entry: data.entry });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // ── Inventory ─────────────────────────────────────────────────────────────
  server.registerTool(
    'adjust_inventory',
    {
      title: 'Adjust inventory',
      description:
        'Adjust a stock item by a delta — a purchase adds, a use subtracts — with a reason, so the change is honest about why.',
      inputSchema: {
        itemId: idField.describe('The item id, from list_inventory'),
        change: z.number().describe('Signed amount, e.g. -4 for four used, 6 for a pack added. Cannot be zero.'),
        reason: z.enum(['purchase', 'used', 'manual', 'correction']).optional().describe('Default manual'),
        note: z.string().max(300).optional(),
      },
      annotations: WRITE,
    },
    async ({ itemId, change, reason, note }) => {
      try {
        const data = await callFamilyRoute<{ message: string; item: unknown }>({
          ...ctx,
          path: `/api/v1/inventory/${itemId}/adjust`,
          method: 'POST',
          body: { change, ...(reason ? { reason } : {}), ...(note === undefined ? {} : { note }) },
          tool: 'adjust_inventory',
        });
        return jsonResult({ message: data.message, item: data.item });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'recount_inventory',
    {
      title: 'Recount inventory',
      description: 'Set a stock item to an absolute counted quantity, replacing whatever the ledger said.',
      inputSchema: {
        itemId: idField.describe('The item id, from list_inventory'),
        quantity: z.number().min(0).describe('The counted quantity on hand'),
        note: z.string().max(200).optional(),
      },
      annotations: UPDATE,
    },
    async ({ itemId, quantity, note }) => {
      try {
        const data = await callFamilyRoute<{ message: string; item: unknown }>({
          ...ctx,
          path: `/api/v1/inventory/${itemId}/recount`,
          method: 'POST',
          body: { quantity, ...(note === undefined ? {} : { note }) },
          tool: 'recount_inventory',
        });
        return jsonResult({ message: data.message, item: data.item });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
