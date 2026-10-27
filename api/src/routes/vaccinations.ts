// routes/vaccinations.ts
//
// One sheet, not six handlers: the factory (category-routes.ts) holds the
// behavior. Raw mode matches this category exactly — snake_case rows, the
// 404 of the per-row access check, the re-selecting create/update — with two
// departures declared per sheet: the three-key sort of the list
// (listOrder) and the static /schedule sub-endpoint (extraRoutes).
import { z } from 'zod';
import { type Hono } from 'hono';
import { type AuthEnv } from '../auth';
import { type CategorySheet, categoryRoutes } from './category-routes';

const selectColumns = [
  'id', 'subject_id', 'name', 'date_given', 'next_due_date', 'administered_by', 'notes', 'created_at', 'created_by',
];

// Zod schemas for validation
const createVaccinationSchema = z.object({
  memberId: z.number(),
  name: z.string().min(1),
  dateGiven: z.string().datetime().optional(),
  nextDueDate: z.string().datetime().optional(),
  administeredBy: z.string().optional(),
  notes: z.string().optional(),
});

const updateVaccinationSchema = z.object({
  name: z.string().min(1).optional(),
  dateGiven: z.string().datetime().optional(),
  nextDueDate: z.string().datetime().optional(),
  administeredBy: z.string().optional(),
  notes: z.string().optional(),
});

// Recommended vaccination schedule (standardized, simplified) — static, so
// it lives on the sheet and never touches the DB.
const VACCINATION_SCHEDULE = [
  {
    name: 'Hepatitis B',
    ages: ['birth', '1-2 months', '6-18 months'],
    description: 'Protects against hepatitis B virus infection',
    notes: 'Given in 3 doses',
  },
  {
    name: 'DTaP',
    ages: ['2 months', '4 months', '6 months', '15-18 months', '4-6 years'],
    description: 'Protects against diphtheria, tetanus, and pertussis',
    notes: 'Given in 5 doses',
  },
  {
    name: 'Hib',
    ages: ['2 months', '4 months', '6 months', '12-15 months'],
    description: 'Protects against Haemophilus influenzae type b',
    notes: 'Number of doses depends on product used',
  },
  {
    name: 'Polio (IPV)',
    ages: ['2 months', '4 months', '6-18 months', '4-6 years'],
    description: 'Protects against polio',
    notes: 'Given in 4 doses',
  },
  {
    name: 'PCV13',
    ages: ['2 months', '4 months', '6 months', '12-15 months'],
    description: 'Protects against pneumococcal disease',
    notes: 'Given in 4 doses',
  },
  {
    name: 'Rotavirus',
    ages: ['2 months', '4 months', '6 months'],
    description: 'Protects against rotavirus infection',
    notes: '2 or 3 doses depending on product',
  },
  {
    name: 'MMR',
    ages: ['12-15 months', '4-6 years'],
    description: 'Protects against measles, mumps, and rubella',
    notes: 'Given in 2 doses',
  },
  {
    name: 'Varicella',
    ages: ['12-15 months', '4-6 years'],
    description: 'Protects against chickenpox',
    notes: 'Given in 2 doses',
  },
];

const vaccinationSheet: CategorySheet = {
  table: 'vaccinations',
  orderExpr: 'date_given',
  // three keys, mixed directions: date_given DESC, next_due_date ASC, id DESC
  listOrder: 'date_given DESC, next_due_date ASC, id DESC',
  selectColumns,
  handlers: ['list', 'get', 'create', 'update', 'delete'],
  createSchema: createVaccinationSchema,
  updateSchema: updateVaccinationSchema,
  columns: {
    name: 'name',
    dateGiven: 'date_given',
    nextDueDate: 'next_due_date',
    administeredBy: 'administered_by',
    notes: 'notes',
  },
  insert: {
    columns: [...selectColumns.slice(1)],
    values: (data, subjectId, now, userId) => [
      subjectId,
      data.name,
      data.dateGiven || null,
      data.nextDueDate || null,
      data.administeredBy || null,
      data.notes || null,
      now,
      userId,
    ],
  },
  responseMode: 'raw',
  listKey: 'vaccinations',
  itemKey: 'vaccination',
  nouns: { singular: 'vaccination', article: 'a' },
  messages: {
    memberRequired: 'Member ID is required',
    memberDenied: 'Member not found or access denied',
    notFound: 'Vaccination not found or access denied',
    accessDenied: 'Access denied',
    listFailed: 'Failed to fetch vaccinations',
    getFailed: 'Failed to fetch vaccination',
    createFailed: 'Failed to record vaccination',
    updateFailed: 'Failed to update vaccination',
    deleteFailed: 'Failed to delete vaccination',
    created: 'Vaccination recorded successfully',
    updated: 'Vaccination updated successfully',
    deleted: 'Vaccination deleted successfully',
    createdStatus: 200,
  },
  // A vaccination bills stock for anything linked to it — vaccinations carry
  // no option dimension, so only an unconditional rule matches.
  emit: { category: 'vaccines', attrs: () => ({}) },
  // the recommended schedule is static — no DB, its own handler
  extraRoutes: (routes: Hono<AuthEnv>) => {
    routes.get('/schedule', async (c) => {
      try {
        return c.json({ schedule: VACCINATION_SCHEDULE });
      } catch (error) {
        c.get('log').error('get vaccination schedule failed', { err: error });
        return c.json({ error: 'Failed to fetch vaccination schedule' }, 500);
      }
    });
  },
};

export const vaccinationRoutes = categoryRoutes(vaccinationSheet);