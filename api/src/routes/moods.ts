// moods.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';

const createSchema = z.object({
  memberId: z.number(),
  mood: z.string().min(1).max(60),
  recordedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  mood: z.string().min(1).max(60).optional(),
  recordedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const moodSheet: CategorySheet = {
  table: 'moods',
  orderExpr: 'recorded_at',
  selectColumns: ['id', 'subject_id', 'mood', 'recorded_at', 'notes', 'created_at', 'created_by'],
  handlers: ['list', 'create', 'update', 'delete'],
  createSchema,
  updateSchema,
  columns: {
    mood: 'mood',
    recordedAt: 'recorded_at',
    notes: 'notes',
  },
  insert: {
    columns: ['subject_id', 'mood', 'recorded_at', 'notes', 'created_at', 'created_by'],
    values: (d, subjectId, now, userId) => [subjectId, d.mood, d.recordedAt || now, d.notes || null, now, userId],
  },
  responseMode: 'camel',
  rowToResponse: (r) => ({
    id: Number(r?.id),
    memberId: Number(r?.subject_id),
    mood: r?.mood,
    recordedAt: r?.recorded_at,
    notes: r?.notes,
    createdAt: r?.created_at,
    createdBy: r?.created_by ?? null,
    createdByName: (r as Record<string, unknown>)?.created_by_name ?? null,
  }),
  createResponse: (id, subjectId, d, now) => ({
    id,
    memberId: subjectId,
    mood: d.mood,
    recordedAt: d.recordedAt || now,
    notes: d.notes ?? null,
  }),
  listKey: 'moods',
  itemKey: 'mood',
  nouns: { singular: 'mood', article: 'a' },
  messages: {
    memberRequired: 'memberId is required',
    memberDenied: 'Access denied',
    notFound: 'Mood not found',
    accessDenied: 'Access denied',
    listFailed: 'Failed to fetch moods',
    getFailed: 'Failed to fetch mood',
    createFailed: 'Failed to record mood',
    updateFailed: 'Failed to update mood',
    deleteFailed: 'Failed to delete mood',
    created: 'Mood recorded',
    updated: 'Mood updated',
    deleted: 'Mood deleted',
    createdStatus: 201,
  },
  // A mood bills stock through the same funnel as every other activity, with
  // the mood as an attribute so a rule can narrow to one.
  emit: { category: 'moods', attrs: (d) => ({ mood: d.mood as string }) },
};

export const moodRoutes = categoryRoutes(moodSheet);