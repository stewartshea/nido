// routes/vitals.ts
//
// Blood pressure and the other adult measurements that are numbers, not a
// titled moment. A reading is `kind` plus its values; the table keeps the
// columns a trend needs rather than burying them in a text note.
//
// The category is declared in the registry like every other one, so a family
// can turn it on for a profile and a reminder can watch it ("no blood pressure
// in a week") with no second vocabulary.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';
import { CATEGORIES } from '../category-registry';

const vitalRoutes = new Hono<AuthEnv>();

const VITAL_KINDS = CATEGORIES.vitals.options.kind as [string, ...string[]];
const vitalKindSchema = z.enum(VITAL_KINDS);

/**
 * The unit is derived, not chosen: a blood pressure is always mmHg and a pulse
 * is always bpm. Letting a client send it invites "120/80 kg" in the record.
 */
const VITAL_UNITS: Record<string, string> = {
	'blood pressure': 'mmHg',
	pulse: 'bpm',
	temperature: '°C',
	'oxygen saturation': '%',
};

const createVitalSchema = z.object({
	memberId: z.number().int().positive(),
	kind: vitalKindSchema,
	systolic: z.number().int().min(40).max(300).optional(),
	diastolic: z.number().int().min(20).max(200).optional(),
	value: z.number().min(1).max(1000).optional(),
	recordedAt: z.string().datetime().optional(),
	notes: z.string().max(5000).optional(),
});

const updateVitalSchema = z.object({
	kind: vitalKindSchema.optional(),
	systolic: z.number().int().min(40).max(300).nullable().optional(),
	diastolic: z.number().int().min(20).max(200).nullable().optional(),
	value: z.number().min(1).max(1000).nullable().optional(),
	recordedAt: z.string().datetime().optional(),
	notes: z.string().max(5000).nullable().optional(),
});

/**
 * A reading is only a reading with the numbers its kind needs.
 *
 * The ranges are deliberately wide — a fever of 41°C and an athlete's pulse of
 * 40 are both real. The check is here to catch a swapped pair or a blank
 * field, not to second-guess a measurement.
 */
function measurementError(
	kind: string,
	systolic: number | null | undefined,
	diastolic: number | null | undefined,
	value: number | null | undefined,
): string | null {
	if (kind === 'blood pressure') {
		if (systolic == null || diastolic == null) return 'Blood pressure needs both numbers.';
		if (systolic <= diastolic) return 'The systolic value should be higher than the diastolic one.';
		return null;
	}
	if (value == null) return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} needs a value.`;
	if (kind === 'pulse' && (value < 20 || value > 250)) return 'A pulse is between 20 and 250 bpm.';
	if (kind === 'temperature' && (value < 25 || value > 45)) return 'A temperature is between 25 and 45 °C.';
	if (kind === 'oxygen saturation' && (value < 50 || value > 100)) return 'Oxygen saturation is between 50 and 100%.';
	return null;
}

function shapeVital(row: any) {
	return {
		id: Number(row.id),
		memberId: Number(row.subject_id),
		kind: row.kind,
		systolic: row.systolic == null ? null : Number(row.systolic),
		diastolic: row.diastolic == null ? null : Number(row.diastolic),
		value: row.value == null ? null : Number(row.value),
		unit: row.unit,
		recordedAt: row.recorded_at,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		createdBy: row.created_by ?? null,
		createdByName: row.created_by_name ?? null,
	};
}

/** A stored vital's profile, and whether this user can touch it. */
async function vitalAccess(db: any, id: number, userId: string): Promise<any | null> {
	const row = (await db.execute({
		sql: `
			SELECT v.*
			FROM vitals v
			JOIN subjects s ON s.id = v.subject_id
			JOIN user_households uh ON uh.household_id = s.household_id
			WHERE v.id = ? AND uh.user_id = ?
			LIMIT 1
		`,
		args: [id, userId],
	})).rows[0];
	return row ?? null;
}

vitalRoutes.get('/', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const memberId = Number.parseInt(c.req.query('memberId') || '0', 10);
	if (!memberId) return c.json({ error: 'memberId is required' }, 400);
	const scope = await resolveTrackableMember(db, userId, memberId);
	if (!scope) return c.json({ error: 'Access denied' }, 403);

	const { limit, offset } = parsePaging((k) => c.req.query(k));
	const res = await db.execute({
		sql: `
			SELECT id, subject_id, kind, systolic, diastolic, value, unit, recorded_at, notes, created_at, created_by
			FROM vitals
			WHERE subject_id = ?
			ORDER BY recorded_at DESC, id DESC
			LIMIT ? OFFSET ?
		`,
		args: [scope.subjectId, limit, offset],
	});
	await attachCreatedBy(db, res.rows as any[]);
	const total = await countMatching(db, 'vitals', [scope.subjectId]);
	return c.json({ vitals: res.rows.map(shapeVital), total });
});

vitalRoutes.post('/', zValidator('json', createVitalSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const { memberId, kind, systolic, diastolic, value, recordedAt, notes } = c.req.valid('json');
	const scope = await resolveTrackableMember(db, userId, memberId);
	if (!scope) return c.json({ error: 'Access denied' }, 403);

	const problem = measurementError(kind, systolic ?? null, diastolic ?? null, value ?? null);
	if (problem) return c.json({ error: problem }, 400);

	const isBp = kind === 'blood pressure';
	const now = new Date().toISOString();
	const ins = await db.execute({
		sql: `
			INSERT INTO vitals (subject_id, recorded_at, kind, systolic, diastolic, value, unit, notes, created_by, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		args: [
			scope.subjectId,
			recordedAt || now,
			kind,
			isBp ? systolic : null,
			isBp ? diastolic : null,
			isBp ? null : value,
			VITAL_UNITS[kind] ?? null,
			notes ?? null,
			userId,
			now,
		],
	});
	const row = (await db.execute({
		sql: 'SELECT * FROM vitals WHERE id = ?',
		args: [Number(ins.lastInsertRowid)],
	})).rows[0];
	return c.json({ message: 'Vital sign recorded', vital: shapeVital(row) }, 201);
});

vitalRoutes.put('/:id{[0-9]+}', zValidator('json', updateVitalSchema), async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number.parseInt(c.req.param('id'), 10);
	const existing = await vitalAccess(db, id, userId);
	if (!existing) return c.json({ error: 'Vital sign not found' }, 404);

	const body = c.req.valid('json');
	const kind = body.kind ?? String(existing.kind);
	const isBp = kind === 'blood pressure';
	const systolic = isBp ? (body.systolic !== undefined ? body.systolic : existing.systolic) : null;
	const diastolic = isBp ? (body.diastolic !== undefined ? body.diastolic : existing.diastolic) : null;
	const value = isBp ? null : (body.value !== undefined ? body.value : existing.value);
	const problem = measurementError(kind, systolic, diastolic, value);
	if (problem) return c.json({ error: problem }, 400);

	await db.execute({
		sql: `
			UPDATE vitals
			SET kind = ?, systolic = ?, diastolic = ?, value = ?, unit = ?,
			    recorded_at = ?, notes = ?
			WHERE id = ?
		`,
		args: [
			kind,
			systolic,
			diastolic,
			value,
			VITAL_UNITS[kind] ?? null,
			body.recordedAt ?? existing.recorded_at,
			body.notes !== undefined ? body.notes : existing.notes,
			id,
		],
	});
	const row = (await db.execute({ sql: 'SELECT * FROM vitals WHERE id = ?', args: [id] })).rows[0];
	return c.json({ message: 'Vital sign updated', vital: shapeVital(row) });
});

vitalRoutes.delete('/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const id = Number.parseInt(c.req.param('id'), 10);
	const existing = await vitalAccess(db, id, userId);
	if (!existing) return c.json({ error: 'Vital sign not found' }, 404);
	await db.execute({ sql: 'DELETE FROM vitals WHERE id = ?', args: [id] });
	return c.json({ message: 'Vital sign deleted' });
});

export { vitalRoutes };
