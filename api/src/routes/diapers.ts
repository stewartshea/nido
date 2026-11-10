// diapers.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';
import { diaperBilledItemId, lastDiaperItemId } from '../diaper-size';
import { resolveTrackableMember } from '../member-scope';

const selectColumns = [
  'id', 'subject_id', 'change_time', 'type', 'color', 'consistency', 'notes', 'item_id', 'created_at', 'created_by',
];

const createSchema = z.object({
  memberId: z.number(),
  changeTime: z.string().datetime(),
  type: z.enum(['wet', 'dirty', 'both', 'dry']),
  // The pack the family chose on the log form. Optional for older clients;
  // when absent the route falls back to the size inference below.
  itemId: z.number().int().positive().nullish(),
  color: z.string().optional(), // For solid waste
  consistency: z.string().optional(), // Loose, formed, etc.
  notes: z.string().optional(),
});

const updateSchema = z.object({
  changeTime: z.string().datetime().optional(),
  type: z.enum(['wet', 'dirty', 'both', 'dry']).optional(),
  color: z.string().optional(),
  consistency: z.string().optional(),
  notes: z.string().optional(),
});

const diaperSheet: CategorySheet = {
  table: 'diapers',
  orderExpr: 'change_time',
  selectColumns,
  handlers: ['list', 'get', 'create', 'update', 'delete'],
  createSchema,
  updateSchema,
  columns: {
    changeTime: 'change_time',
    type: 'type',
    color: 'color',
    consistency: 'consistency',
    notes: 'notes',
  },
  insert: {
    columns: [...selectColumns.slice(1)],
    values: (d, subjectId, now, userId) => [
      subjectId, d.changeTime, d.type, d.color || null, d.consistency || null, d.notes || null,
      d.itemId ?? null, now, userId,
    ],
  },
  // A pack named on the form must be a diaper pack this member can bill.
  // Rejecting it here keeps the change from being stored with a stale pack
  // that would pin billing to nothing.
  beforeCreate: async ({ db, subjectId, data }) => {
    const chosen = data.itemId;
    if (chosen === undefined || chosen === null) return null;
    const itemId = Number(chosen);
    if (!Number.isInteger(itemId) || itemId <= 0) return 'Choose a diaper pack linked to this child.';
    const pack = (await db.execute({
      sql: `SELECT 1
            FROM inventory_items i
            WHERE i.id = ? AND i.active = 1 AND i.category = 'diapers'
              AND (i.subject_id = ? OR i.subject_id IS NULL)
              AND EXISTS (
                SELECT 1 FROM inventory_consumption_rules r
                WHERE r.item_id = i.id AND r.active = 1 AND r.source_category = 'diapers'
              )
            LIMIT 1`,
      args: [itemId, subjectId],
    })).rows[0];
    return pack ? null : 'Choose a diaper pack linked to this child.';
  },
  responseMode: 'raw',
  listKey: 'diapers',
  itemKey: 'diaper',
  nouns: { singular: 'diaper', article: 'a' },
  messages: {
    memberRequired: 'Member ID is required',
    memberDenied: 'Member not found or access denied',
    notFound: 'Diaper not found or access denied',
    accessDenied: 'Access denied',
    listFailed: 'Failed to fetch diapers',
    getFailed: 'Failed to fetch diaper',
    createFailed: 'Failed to record diaper',
    updateFailed: 'Failed to update diaper',
    deleteFailed: 'Failed to delete diaper',
    created: 'Diaper recorded successfully',
    updated: 'Diaper updated successfully',
    deleted: 'Diaper deleted successfully',
    createdStatus: 200,
  },
  emit: {
    category: 'diapers',
    attrs: (d) => ({ type: d.type as string }),
    // A change bills the pack the family chose. The form always sends one
    // when a member has linked diaper stock, so the pin follows observed use.
    // An older client that sends nothing falls back to the size inference:
    // the ladder's current band, or standard-size pack variants.
    pin: async ({ db, subjectId, data }) => {
      const chosen = Number(data.itemId);
      if (Number.isInteger(chosen) && chosen > 0) {
        return { itemId: chosen, pinCategory: 'diapers' };
      }
      const itemId = await diaperBilledItemId(db, subjectId);
      return itemId === undefined ? null : { itemId, pinCategory: 'diapers' };
    },
  },
  // The log form's pack picker: every diaper pack this member can bill, plus
  // the pack a change should default to. The default is the last pack a
  // change used, so switching packs is a choice that sticks; before the first
  // change it falls back to the weight ladder and its inferred variants.
  extraRoutes: (routes) => {
    routes.get('/packs', async (c) => {
      try {
        const db = c.get('db');
        const memberId = Number(c.req.query('memberId'));
        if (!memberId) return c.json({ error: 'Member ID is required' }, 400);
        const scope = await resolveTrackableMember(db, c.get('userId'), memberId);
        if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);

        const packs = ((await db.execute({
          sql: `SELECT i.id, i.name, i.variant, i.quantity
                FROM inventory_items i
                WHERE i.active = 1 AND i.category = 'diapers'
                  AND (i.subject_id = ? OR i.subject_id IS NULL)
                  AND EXISTS (
                    SELECT 1 FROM inventory_consumption_rules r
                    WHERE r.item_id = i.id AND r.active = 1 AND r.source_category = 'diapers'
                  )
                ORDER BY (i.subject_id IS NULL), i.id`,
          args: [scope.subjectId],
        })).rows as any[]).map((i) => ({
          id: Number(i.id),
          name: String(i.name),
          variant: i.variant === null || i.variant === undefined ? null : String(i.variant),
          quantity: i.quantity === null || i.quantity === undefined ? null : Number(i.quantity),
        }));

        const ids = new Set(packs.map((p) => p.id));
        const last = await lastDiaperItemId(db, scope.subjectId);
        const inferred = await diaperBilledItemId(db, scope.subjectId);
        const current =
          (last !== null && ids.has(last) ? last : null) ??
          (inferred !== null && inferred !== undefined && ids.has(inferred) ? inferred : null) ??
          packs[0]?.id ??
          null;

        return c.json({ packs, currentItemId: current });
      } catch (error) {
        c.get('log').error('get diaper packs failed', { err: error });
        return c.json({ error: 'Failed to fetch diaper packs' }, 500);
      }
    });
  },
};

export const diaperRoutes = categoryRoutes(diaperSheet);