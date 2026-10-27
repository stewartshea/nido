// routes/medications.ts
//
// The medication list and the doses recorded against it.
//
// A medication row is the plan — name, dose, frequency, start date — and a
// dose is an ordinary `events` row linked back by data.medicationId. Splitting
// them this way keeps the activity feed and stock billing untouched while
// giving the reminder half of adult tracking a frequency to read.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import { resolveTrackableMember } from '../member-scope';
import { zonedDate } from '../timezone';
import {
	MEDICATION_FREQUENCIES,
	MEDICATION_FREQUENCY_IDS,
	dueMedicationsForFamily,
	lastDosesByMedication,
	shapeMedication,
	timezoneForHousehold,
} from '../medications';
import { createEvent } from './events';

const medicationRoutes = new Hono<AuthEnv>();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_ONLY, 'Use a calendar date (YYYY-MM-DD)');

const createMedicationSchema = z.object({
	memberId: z.number().int().positive(),
	name: z.string().trim().min(1).max(200),
	dose: z.string().trim().max(120).optional(),
	frequency: z.enum(MEDICATION_FREQUENCY_IDS).default('once_daily'),
	startDate: dateSchema.optional(),
	endDate: dateSchema.optional(),
	notes: z.string().max(2000).optional(),
});

const updateMedicationSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	dose: z.string().trim().max(120).nullable().optional(),
	frequency: z.enum(MEDICATION_FREQUENCY_IDS).optional(),
	startDate: dateSchema.optional(),
	endDate: dateSchema.nullable().optional(),
	notes: z.string().max(2000).nullable().optional(),
	active: z.boolean().optional(),
});

const doseSchema = z.object({
	occurredAt: z.string().datetime().optional(),
	notes: z.string().max(2000).optional(),
});

function dateRangeError(startDate: string, endDate: string | null | undefined): string | null {
	if (!endDate) return null;
	if (endDate < startDate) return 'The end date cannot be before the start date.';
	return null;
}

/**
 * A medication row, the profile it belongs to, and the member it is logged
 * against. The join is the same COALESCE the rest of tracking uses: older
 * members have a legacy profile id, newer ones are aligned by their own id.
 */
async function medicationAccess(db: any, id: number, userId: string): Promise<any | null> {
	const row = (await db.execute({
		sql: `
			SELECT m.*, s.name AS subject_name, s.household_id, fm.id AS member_id
			FROM medications m
			JOIN subjects s ON s.id = m.subject_id
			JOIN user_households uh ON uh.household_id = s.household_id
			JOIN family_members fm
			  ON fm.household_id = s.household_id
			 AND COALESCE(fm.legacy_subject_id, fm.id) = m.subject_id
			WHERE m.id = ? AND uh.user_id = ?
			ORDER BY fm.legacy_subject_id IS NULL
			LIMIT 1
		`,
		args: [id, userId],
	})).rows[0];
	return row ?? null;
}

/** The family's clock for a member's household. */
async function memberTimezone(db: any, subjectId: number): Promise<string> {
	const row = (await db.execute({
		sql: 'SELECT household_id FROM subjects WHERE id = ? LIMIT 1',
		args: [subjectId],
	})).rows[0] as { household_id?: number } | undefined;
	return timezoneForHousehold(db, Number(row?.household_id ?? 0));
}

async function withState(db: any, row: any, nowMs = Date.now()): Promise<any> {
	const lastDoses = await lastDosesByMedication(db, [Number(row.subject_id)]);
	const timezone = await memberTimezone(db, Number(row.subject_id));
	const localDate = zonedDate(nowMs, timezone);
	return shapeMedication(row, lastDoses.get(Number(row.id)) ?? null, nowMs, localDate);
}

/**
 * Everything due for the whole family.
 *
 * Registered before the `/:id` routes; the notifications page has no selected
 * member, so this is the only way it can answer "what needs a dose now".
 */
medicationRoutes.get('/due', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const fam = (await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? LIMIT 1',
		args: [userId],
	})).rows[0] as { household_id?: number } | undefined;
	if (!fam?.household_id) return c.json({ medications: [] });
	const medications = await dueMedicationsForFamily(db, Number(fam.household_id));
	return c.json({ medications });
});

medicationRoutes.get('/', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const memberId = Number.parseInt(c.req.query('memberId') || '0', 10);
	if (!memberId) return c.json({ error: 'memberId is required' }, 400);
	const scope = await resolveTrackableMember(db, userId, memberId);
	if (!scope) return c.json({ error: 'Access denied' }, 403);

	const rows = (await db.execute({
		sql: `
			SELECT m.*, s.name AS subject_name
			FROM medications m
			JOIN subjects s ON s.id = m.subject_id
			WHERE m.subject_id = ?
			ORDER BY m.active DESC, m.name COLLATE NOCASE, m.id
		`,
		args: [scope.subjectId],
	})).rows as any[];
	const lastDoses = await lastDosesByMedication(db, [scope.subjectId]);
	const timezone = await memberTimezone(db, scope.subjectId);
	const nowMs = Date.now();
	const localDate = zonedDate(nowMs, timezone);
	return c.json({
		medications: rows.map((row) =>
			shapeMedication(row, lastDoses.get(Number(row.id)) ?? null, nowMs, localDate),
		),
		// The picker and the API agree on the schedule vocabulary because it is
		// sent with the list rather than copied into the web build.
		frequencies: MEDICATION_FREQUENCIES,
	});
});

medicationRoutes.post('/', zValidator('json', createMedicationSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const body = c.req.valid('json');
	const scope = await resolveTrackableMember(db, userId, body.memberId);
	if (!scope) return c.json({ error: 'Access denied' }, 403);

	const today = zonedDate(Date.now(), await memberTimezone(db, scope.subjectId));
	const startDate = body.startDate ?? today;
	const endDate = body.endDate ?? null;
	const rangeError = dateRangeError(startDate, endDate);
	if (rangeError) return c.json({ error: rangeError }, 400);

	const now = new Date().toISOString();
	const ins = await db.execute({
		sql: `
			INSERT INTO medications
				(subject_id, name, dose, frequency, start_date, end_date, notes, active, created_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
		`,
		args: [
			scope.subjectId,
			body.name,
			body.dose || null,
			body.frequency,
			startDate,
			endDate,
			body.notes ?? null,
			userId,
			now,
			now,
		],
	});
	const row = (await db.execute({
		sql: 'SELECT m.*, s.name AS subject_name FROM medications m JOIN subjects s ON s.id = m.subject_id WHERE m.id = ?',
		args: [Number(ins.lastInsertRowid)],
	})).rows[0];
	return c.json({ message: `${body.name} added`, medication: await withState(db, row) }, 201);
});

medicationRoutes.put('/:id{[0-9]+}', zValidator('json', updateMedicationSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number.parseInt(c.req.param('id'), 10);
	const existing = await medicationAccess(db, id, userId);
	if (!existing) return c.json({ error: 'Medication not found' }, 404);

	const body = c.req.valid('json');
	const startDate = body.startDate ?? String(existing.start_date);
	const endDate = body.endDate !== undefined ? body.endDate : existing.end_date;
	const rangeError = dateRangeError(startDate, endDate);
	if (rangeError) return c.json({ error: rangeError }, 400);

	await db.execute({
		sql: `
			UPDATE medications
			SET name = ?, dose = ?, frequency = ?, start_date = ?, end_date = ?,
			    notes = ?, active = ?, updated_at = ?
			WHERE id = ?
		`,
		args: [
			body.name ?? existing.name,
			body.dose !== undefined ? body.dose : existing.dose,
			body.frequency ?? existing.frequency,
			startDate,
			endDate,
			body.notes !== undefined ? body.notes : existing.notes,
			body.active === undefined ? Number(existing.active) : body.active ? 1 : 0,
			new Date().toISOString(),
			id,
		],
	});
	const row = (await db.execute({
		sql: 'SELECT m.*, s.name AS subject_name FROM medications m JOIN subjects s ON s.id = m.subject_id WHERE m.id = ?',
		args: [id],
	})).rows[0];
	return c.json({ message: 'Medication updated', medication: await withState(db, row) });
});

medicationRoutes.delete('/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number.parseInt(c.req.param('id'), 10);
	const existing = await medicationAccess(db, id, userId);
	if (!existing) return c.json({ error: 'Medication not found' }, 404);
	// Doses already recorded are history and stay in the activity feed; only
	// the plan goes away.
	await db.execute({ sql: 'DELETE FROM medications WHERE id = ?', args: [id] });
	return c.json({ message: 'Medication deleted' });
});

/**
 * Record one dose.
 *
 * This is the one place a dose is written from the list, and it goes through
 * the ordinary event path: the same zod, the same "past at write time" rule,
 * and the same stock billing as any other record. The medication's own name
 * and dose travel with it so history reads correctly even after the plan is
 * deleted.
 */
medicationRoutes.post('/:id{[0-9]+}/doses', zValidator('json', doseSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number.parseInt(c.req.param('id'), 10);
	const existing = await medicationAccess(db, id, userId);
	if (!existing) return c.json({ error: 'Medication not found' }, 404);

	const body = c.req.valid('json');
	const result = await createEvent(db, userId, {
		memberId: Number(existing.member_id),
		category: 'medication',
		occurredAt: body.occurredAt ?? new Date().toISOString(),
		title: String(existing.name),
		notes: body.notes,
		data: {
			type: 'dose',
			medicationId: Number(existing.id),
			...(existing.dose ? { dose: String(existing.dose) } : {}),
		},
	});
	if (result.error) return c.json({ error: result.error }, result.status);

	const row = (await db.execute({
		sql: 'SELECT m.*, s.name AS subject_name FROM medications m JOIN subjects s ON s.id = m.subject_id WHERE m.id = ?',
		args: [id],
	})).rows[0];
	return c.json(
		{ message: `${existing.name} taken`, medication: await withState(db, row), event: result.row },
		201,
	);
});

export { medicationRoutes };
