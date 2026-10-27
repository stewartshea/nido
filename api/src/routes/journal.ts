// journal.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';

const createSchema = z.object({
  memberId: z.number(),
  title: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
  entryDate: z.string().datetime().optional(),
});

const updateSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  body: z.string().max(20000).nullable().optional(),
  entryDate: z.string().datetime().nullable().optional(),
});

const journalSheet: CategorySheet = {
  table: 'journal_entries',
  // A future-dated entry sorts by when it happened, not when it was typed.
  orderExpr: 'COALESCE(entry_date, created_at)',
  selectColumns: ['id', 'subject_id', 'title', 'body', 'entry_date', 'created_at', 'created_by'],
  handlers: ['list', 'create', 'update', 'delete'],
  createSchema,
  updateSchema,
  columns: {
    title: 'title',
    body: 'body',
    entryDate: 'entry_date',
  },
  insert: {
    columns: ['subject_id', 'title', 'body', 'entry_date', 'created_at', 'created_by'],
    values: (d, subjectId, now, userId) => [subjectId, d.title || null, d.body || null, d.entryDate || now, now, userId],
  },
  responseMode: 'camel',
  rowToResponse: (r) => ({
    id: Number(r?.id),
    memberId: Number(r?.subject_id),
    title: r?.title,
    body: r?.body,
    entryDate: r?.entry_date,
    createdAt: r?.created_at,
    createdBy: r?.created_by ?? null,
    createdByName: (r as Record<string, unknown>)?.created_by_name ?? null,
  }),
  createResponse: (id, subjectId, d, now) => ({
    id,
    memberId: subjectId,
    title: d.title ?? null,
    body: d.body ?? null,
    entryDate: d.entryDate || now,
  }),
  listKey: 'entries',
  itemKey: 'entry',
  nouns: { singular: 'journal entry', article: 'a' },
  messages: {
    memberRequired: 'memberId is required',
    memberDenied: 'Access denied',
    notFound: 'Journal entry not found',
    accessDenied: 'Access denied',
    listFailed: 'Failed to fetch entries',
    getFailed: 'Failed to fetch entry',
    createFailed: 'Failed to save entry',
    updateFailed: 'Failed to update entry',
    deleteFailed: 'Failed to delete entry',
    created: 'Journal entry saved',
    updated: 'Journal entry updated',
    deleted: 'Journal entry deleted',
    createdStatus: 201,
  },
  // A journal entry carries no option dimension, so only an unconditional
  // consumption rule matches.
  emit: { category: 'journal', attrs: () => ({}) },
};

export const journalRoutes = categoryRoutes(journalSheet);