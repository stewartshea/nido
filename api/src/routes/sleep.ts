// sleep.ts — one sheet, not five handlers. The factory
// (category-routes.ts) holds the behavior; this declares the category.
import { z } from 'zod';
import { type CategorySheet, categoryRoutes } from './category-routes';

const selectColumns = ['id', 'subject_id', 'start_time', 'end_time', 'duration', 'location', 'notes', 'created_at', 'created_by'];

// Zod schemas for validation
const createSleepSchema = z.object({
  memberId: z.number(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const updateSleepSchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

// duration = max(0, end - start) in ms, computed on read when the stored
// value is missing (the rows written before duration was tracked) or stale.
const deriveSleepRow = (row: Record<string, unknown>) => {
  if (!row.duration && row.start_time && row.end_time) {
    const start = new Date(row.start_time as string).getTime();
    const end = new Date(row.end_time as string).getTime();
    row.duration = Math.max(0, end - start);
  }
};

const sleepSheet: CategorySheet = {
  table: 'sleep',
  orderExpr: 'start_time',
  selectColumns,
  handlers: ['list', 'get', 'create', 'update', 'delete'],
  createSchema: createSleepSchema,
  updateSchema: updateSleepSchema,
  columns: {
    startTime: 'start_time',
    endTime: 'end_time',
    location: 'location',
    notes: 'notes',
  },
  insert: {
    columns: [...selectColumns.slice(1)],
    values: (d, subjectId, now, userId) => {
      // duration in ms, stored whenever both ends of the range are known
      let duration: number | null = null;
      if (d.startTime && d.endTime) {
        const start = new Date(d.startTime as string).getTime();
        const end = new Date(d.endTime as string).getTime();
        duration = Math.max(0, end - start);
      }
      return [subjectId, d.startTime, d.endTime || null, duration, d.location || null, d.notes || null, now, userId];
    },
  },
  responseMode: 'raw',
  deriveRow: deriveSleepRow,
  recomputeDuration: { startKey: 'startTime', endKey: 'endTime', startCol: 'start_time', durationCol: 'duration' },
  listKey: 'sleep',
  itemKey: 'sleep',
  nouns: { singular: 'sleep record', article: 'a' },
  messages: {
    memberRequired: 'Member ID is required',
    memberDenied: 'Member not found or access denied',
    notFound: 'Sleep record not found or access denied',
    accessDenied: 'Access denied',
    listFailed: 'Failed to fetch sleep records',
    getFailed: 'Failed to fetch sleep record',
    createFailed: 'Failed to create sleep record',
    updateFailed: 'Failed to update sleep record',
    deleteFailed: 'Failed to delete sleep record',
    created: 'Sleep record created successfully',
    updated: 'Sleep record updated successfully',
    deleted: 'Sleep record deleted successfully',
    createdStatus: 200,
  },
  // A logged sleep bills stock for anything linked to it, with the location
  // among the event's attributes so a rule can narrow to crib naps.
  emit: { category: 'sleep', attrs: (d) => ({ location: (d.location as string | undefined) || null }) },
};

export const sleepRoutes = categoryRoutes(sleepSheet);