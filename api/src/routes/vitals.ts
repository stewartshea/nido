// routes/vitals.ts
//
// Blood pressure and the other adult measurements that are numbers, not a
// titled moment. A reading is `kind` plus its values; the table keeps the
// columns a trend needs rather than burying them in a text note.
//
// The category is declared in the registry like every other one, so a family
// can turn it on for a profile and a reminder can watch it ("no blood pressure
// in a week") with no second vocabulary.
//
// One sheet, not four handlers: the factory (category-routes.ts) holds the
// behavior. Raw mode keeps this category's 404-on-row handlers and the
// re-selecting create/update, with two departures declared per sheet — the
// 403 a stranger gets on list/create (memberDeniedStatus) and the camelCase
// rows (rowToResponse) — plus the cross-field rules a reading must pass
// (validateCreate) and the full-overwrite PUT (updateOverwrite).
import { z } from 'zod';
import { CATEGORIES } from '../category-registry';
import { type CategorySheet, categoryRoutes } from './category-routes';

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

const selectColumns = [
	'id', 'subject_id', 'kind', 'systolic', 'diastolic', 'value', 'unit', 'recorded_at', 'notes', 'created_at', 'created_by',
];

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

/**
 * The PUT is a merge of body over stored row: the kind (sent or stored)
 * decides which numbers the reading carries, and the unit is re-derived
 * from it — so a blood pressure that becomes a pulse takes its value from
 * the body and drops the cuff numbers.
 */
function mergeVital(
	data: Record<string, unknown>,
	existing: Record<string, unknown>,
): { kind: string; systolic: number | null; diastolic: number | null; value: number | null } {
	const kind = (data.kind as string | undefined) ?? String(existing.kind);
	const isBp = kind === 'blood pressure';
	const systolic = isBp ? (data.systolic !== undefined ? (data.systolic as number) : (existing.systolic as number | null)) : null;
	const diastolic = isBp ? (data.diastolic !== undefined ? (data.diastolic as number) : (existing.diastolic as number | null)) : null;
	const value = isBp ? null : data.value !== undefined ? (data.value as number) : (existing.value as number | null);
	return { kind, systolic, diastolic, value };
}

const vitalSheet: CategorySheet = {
	table: 'vitals',
	// newest reading first
	orderExpr: 'recorded_at',
	selectColumns,
	// no GET /:id — the surface was list/create/update/delete
	handlers: ['list', 'create', 'update', 'delete'],
	createSchema: createVitalSchema,
	updateSchema: updateVitalSchema,
	validateCreate: (data) =>
		measurementError(
			data.kind as string,
			(data.systolic as number | undefined) ?? null,
			(data.diastolic as number | undefined) ?? null,
			(data.value as number | undefined) ?? null,
		),
	columns: {
		kind: 'kind',
		systolic: 'systolic',
		diastolic: 'diastolic',
		value: 'value',
		unit: 'unit',
		recordedAt: 'recorded_at',
		notes: 'notes',
	},
	insert: {
		columns: ['subject_id', 'recorded_at', 'kind', 'systolic', 'diastolic', 'value', 'unit', 'notes', 'created_by', 'created_at'],
		values: (data, subjectId, now, userId) => {
			const kind = data.kind as string;
			const isBp = kind === 'blood pressure';
			return [
				subjectId,
				(data.recordedAt as string | undefined) || now,
				kind,
				isBp ? data.systolic : null,
				isBp ? data.diastolic : null,
				isBp ? null : data.value,
				VITAL_UNITS[kind] ?? null,
				(data.notes as string | undefined) ?? null,
				userId,
				now,
			];
		},
	},
	responseMode: 'raw',
	rowToResponse: shapeVital,
	updateOverwrite: {
		validate: (data, existing) => {
			const merged = mergeVital(data, existing);
			return measurementError(merged.kind, merged.systolic ?? null, merged.diastolic ?? null, merged.value ?? null);
		},
		set: (data, existing) => {
			const merged = mergeVital(data, existing);
			return {
				kind: merged.kind,
				systolic: merged.systolic ?? null,
				diastolic: merged.diastolic ?? null,
				value: merged.value ?? null,
				unit: VITAL_UNITS[merged.kind] ?? null,
				recordedAt: (data.recordedAt as string | undefined) ?? (existing.recorded_at as string),
				notes: data.notes !== undefined ? data.notes : existing.notes,
			};
		},
	},
	// a stranger asking for someone else's member is denied (403), not
	// told the member is missing (raw mode's default 404)
	memberDeniedStatus: 403,
	listKey: 'vitals',
	itemKey: 'vital',
	nouns: { singular: 'vital sign', article: 'a' },
	messages: {
		memberRequired: 'memberId is required',
		memberDenied: 'Access denied',
		notFound: 'Vital sign not found',
		accessDenied: 'Access denied',
		listFailed: 'Failed to fetch vitals',
		getFailed: 'Failed to fetch vital sign',
		createFailed: 'Failed to record vital sign',
		updateFailed: 'Failed to update vital sign',
		deleteFailed: 'Failed to delete vital sign',
		created: 'Vital sign recorded',
		updated: 'Vital sign updated',
		deleted: 'Vital sign deleted',
		createdStatus: 201,
	},
	// a measurement bills nothing
	emit: null,
};

export const vitalRoutes = categoryRoutes(vitalSheet);