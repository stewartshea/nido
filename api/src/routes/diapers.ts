// diapers.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';

const selectColumns = ['id', 'subject_id', 'change_time', 'type', 'color', 'consistency', 'notes', 'created_at', 'created_by'];

const createSchema = z.object({
  memberId: z.number(),
  changeTime: z.string().datetime(),
  type: z.enum(['wet', 'dirty', 'both', 'dry']),
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
      subjectId, d.changeTime, d.type, d.color || null, d.consistency || null, d.notes || null, now, userId,
    ],
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
  emit: { category: 'diapers', attrs: (d) => ({ type: d.type as string }) },
};

export const diaperRoutes = categoryRoutes(diaperSheet);