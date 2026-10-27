// medications.ts
//
// A medication is a standing thing, not a moment: "Atenolol 50 mg, once a day,
// started 1 October" is true every day until it is stopped. That is why it gets
// a row of its own instead of another free-text dose event — a dose event says
// what happened, while the frequency is what makes a reminder possible.
//
// Doses still land in `events` (category 'medication', data.medicationId), so
// the activity feed, attachments and stock billing see them like any other
// record. The table only holds the plan; the events hold the history.
//
// The due calculation is deliberately small and shared: the medications route
// uses it to answer "what is due for this person", and the notifications
// summary uses it to answer "how many things need attention" — the badge and
// the list must never disagree.

import { effectiveTimezone, zonedDate } from './timezone';

/**
 * How often a medication is taken.
 *
 * A fixed list rather than free text, because the frequency is read as an
 * interval: "twice a day" is 12 hours, and a family's own words are not. The
 * set covers the common schedules; "as needed" is the explicit no-reminder
 * answer.
 */
export const MEDICATION_FREQUENCIES = [
	{ id: 'once_daily', label: 'Once a day', hours: 24 },
	{ id: 'twice_daily', label: 'Twice a day', hours: 12 },
	{ id: 'three_times_daily', label: 'Three times a day', hours: 8 },
	{ id: 'four_times_daily', label: 'Four times a day', hours: 6 },
	{ id: 'weekly', label: 'Weekly', hours: 168 },
	{ id: 'as_needed', label: 'As needed', hours: null },
] as const;

export type MedicationFrequency = (typeof MEDICATION_FREQUENCIES)[number]['id'];

export const MEDICATION_FREQUENCY_IDS = MEDICATION_FREQUENCIES.map((f) => f.id) as [
	MedicationFrequency,
	...MedicationFrequency[],
];

export function medicationFrequencyLabel(id: string): string {
	return MEDICATION_FREQUENCIES.find((f) => f.id === id)?.label ?? id;
}

export function medicationFrequencyHours(id: string): number | null {
	return MEDICATION_FREQUENCIES.find((f) => f.id === id)?.hours ?? null;
}

/** The columns the due calculation needs; both routes and tests build these. */
export interface MedicationLike {
	id: number;
	name: string;
	dose?: string | null;
	frequency: string;
	start_date: string;
	end_date?: string | null;
	active: number | boolean;
}

export interface MedicationDueState {
	/** When the last dose was recorded, or null when none ever has been. */
	lastDoseAt: string | null;
	/** When the next dose is due, or null when the schedule has no next. */
	nextDueAt: string | null;
	due: boolean;
}

/**
 * Whether a medication needs a dose now.
 *
 * "Never taken" is due from the start date, on the family's clock — a
 * prescription that starts tomorrow is not due tonight. A logged dose starts
 * the interval, so the next one is due exactly `hours` later; that is what
 * makes the reminder read from the plan instead of from a person tapping
 * "taken" on a schedule they have to remember.
 */
export function medicationDueState(
	med: MedicationLike,
	lastDoseAt: string | null,
	nowMs: number,
	localDate: string,
): MedicationDueState {
	const hours = medicationFrequencyHours(med.frequency);
	const active = Number(med.active) === 1 || med.active === true;
	if (!active || hours === null) return { lastDoseAt, nextDueAt: null, due: false };
	// A finished course is history, not a thing to nudge about. The end date is
	// inclusive: taking the last dose on the final day is still on schedule.
	if (med.end_date && localDate > med.end_date) {
		return { lastDoseAt, nextDueAt: null, due: false };
	}

	if (lastDoseAt) {
		const lastMs = new Date(lastDoseAt).getTime();
		if (!Number.isFinite(lastMs)) return { lastDoseAt, nextDueAt: null, due: false };
		const nextMs = lastMs + hours * 60 * 60 * 1000;
		return {
			lastDoseAt,
			nextDueAt: new Date(nextMs).toISOString(),
			due: nowMs >= nextMs,
		};
	}

	// The exact hour of the first dose is not known; the start of the day the
	// family chose is the honest instant to name.
	return {
		lastDoseAt: null,
		nextDueAt: `${med.start_date}T00:00:00.000Z`,
		due: localDate >= med.start_date,
	};
}

/**
 * The last dose per medication for one subject, keyed by medication id.
 *
 * Only events that name a medication count. Free-text medication records from
 * before the list existed keep showing in history, but they cannot tell us
 * which prescription they belong to, so they must not stop a reminder.
 */
export async function lastDosesByMedication(
	db: { execute: (q: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }> },
	subjectIds: number[],
): Promise<Map<number, string>> {
	const out = new Map<number, string>();
	if (subjectIds.length === 0) return out;
	const placeholders = subjectIds.map(() => '?').join(', ');
	const res = await db.execute({
		sql: `
			SELECT subject_id,
			       json_extract(data, '$.medicationId') AS medication_id,
			       MAX(occurred_at) AS last_dose_at
			FROM events
			WHERE category = 'medication'
			  AND subject_id IN (${placeholders})
			  AND json_extract(data, '$.medicationId') IS NOT NULL
			GROUP BY subject_id, medication_id
		`,
		args: subjectIds,
	});
	for (const row of res.rows as any[]) {
		const id = Number(row.medication_id);
		if (Number.isFinite(id)) out.set(id, String(row.last_dose_at));
	}
	return out;
}

/** A medication with its schedule state, as both the panel and the badge read it. */
export interface MedicationState extends MedicationDueState {
	id: number;
	subjectId: number;
	memberName: string;
	name: string;
	dose: string | null;
	frequency: string;
	frequencyLabel: string;
	startDate: string;
	endDate: string | null;
	notes: string | null;
	active: boolean;
}

/** Shape a stored row plus its last dose for the API and the web. */
export function shapeMedication(
	row: any,
	lastDoseAt: string | null,
	nowMs: number,
	localDate: string,
): MedicationState {
	return {
		id: Number(row.id),
		subjectId: Number(row.subject_id),
		memberName: String(row.subject_name ?? row.name ?? ''),
		name: String(row.name),
		dose: row.dose ?? null,
		frequency: String(row.frequency),
		frequencyLabel: medicationFrequencyLabel(String(row.frequency)),
		startDate: String(row.start_date),
		endDate: row.end_date ?? null,
		notes: row.notes ?? null,
		active: Number(row.active) === 1,
		...medicationDueState(row, lastDoseAt, nowMs, localDate),
	};
}

/**
 * Everything due right now, across the whole family.
 *
 * The notifications page has no "selected member", so it cannot ask the
 * per-member route; and the badge must answer the same question. Both go
 * through this one walk of the family's active medications.
 */
export async function dueMedicationsForFamily(
	db: { execute: (q: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }> },
	familyId: number,
	nowMs = Date.now(),
): Promise<MedicationState[]> {
	const timezone = await timezoneForHousehold(db, familyId);
	const localDate = zonedDate(nowMs, timezone);
	const rows = (await db.execute({
		sql: `
			SELECT m.*, s.name AS subject_name
			FROM medications m
			JOIN subjects s ON s.id = m.subject_id
			WHERE s.household_id = ? AND m.active = 1
			ORDER BY m.name COLLATE NOCASE
		`,
		args: [familyId],
	})).rows as any[];
	if (rows.length === 0) return [];
	const lastDoses = await lastDosesByMedication(db, [...new Set(rows.map((r) => Number(r.subject_id)))]);
	return rows
		.map((row) => shapeMedication(row, lastDoses.get(Number(row.id)) ?? null, nowMs, localDate))
		.filter((med) => med.due)
		.sort((a, b) => (a.nextDueAt ?? '').localeCompare(b.nextDueAt ?? ''));
}

/** The family's own clock, or UTC for a family that has not chosen one. */
export async function timezoneForHousehold(
	db: { execute: (q: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }> },
	householdId: number,
): Promise<string> {
	const row = (await db.execute({
		sql: 'SELECT timezone FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [householdId],
	})).rows[0] as { timezone?: string | null } | undefined;
	return effectiveTimezone(row?.timezone);
}
