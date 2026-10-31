// api/src/meters.ts
//
// HOME module milestone 2 (issue #66): meters — the odometer and the run-hour
// counter.
//
// A meter is a monotonic counter on one home asset. Readings are sparse on
// purpose: nobody logs an odometer daily, so the whole design is interpolation
// between the two most recent confirmed readings. A trigger ("every 8,000 km")
// is evaluated against an estimate *today*, and the reminder still shows the
// last confirmed reading, so "you're ~due, last read 82,100 on Oct 1" is
// honest rather than invented.
//
// A confirmed reading always wins: the estimate is a convenience for the space
// between readings, never a replacement for one.

import { dayDiff } from './dates';
import { zonedDate } from './timezone';

export const METER_KINDS = ['distance', 'time', 'count'] as const;
export type MeterKind = (typeof METER_KINDS)[number];

/**
 * Units a kind may carry.
 *
 * Distance is metric-first like the rest of the growth work, but a family that
 * thinks in miles can say so; the unit is stored, not inferred at display
 * time. Time is hours. Count is the one free-form case — cycles, loads,
 * starts — because the right noun is whatever the thing does.
 */
export const METER_UNITS: Readonly<Record<MeterKind, readonly string[]>> = {
	distance: ['km', 'mi'],
	time: ['h'],
	count: [],
};

export function isMeterKind(value: unknown): value is MeterKind {
	return typeof value === 'string' && (METER_KINDS as readonly string[]).includes(value);
}

/** Validate a unit for a kind; returns an error message, or null when valid. */
export function validateMeterUnit(kind: MeterKind, unit: unknown): string | null {
	const value = typeof unit === 'string' ? unit.trim() : '';
	if (!value || value.length > 20) return 'Choose a unit for the meter.';
	const allowed = METER_UNITS[kind];
	if (allowed.length && !allowed.includes(value)) {
		return `"${value}" is not a ${kind} unit. Use ${allowed.join(' or ')}.`;
	}
	// count: any short noun is the point of the kind, but it still has to be
	// a noun and not a paragraph.
	if (!allowed.length && !/^[a-zA-Z][a-zA-Z0-9 _-]*$/.test(value)) {
		return 'Use a short word for the unit (cycles, loads, starts).';
	}
	return null;
}

export interface MeterRow {
	id: number;
	household_id: number;
	asset_id: number;
	kind: string;
	unit: string;
	label: string | null;
	created_at: string | null;
	updated_at: string | null;
}

export interface MeterReadingRow {
	id: number;
	household_id: number;
	meter_id: number;
	value: number;
	recorded_at: string;
	source: string;
	maintenance_entry_id: number | null;
	created_at: string | null;
}

/** A reading as the API shows it. */
export interface MeterReading {
	id: number;
	value: number;
	recordedAt: string;
	source: string;
	maintenanceEntryId: number | null;
}

/** The estimate for a moment, and the confirmed reading it is based on. */
export interface MeterEstimate {
	/** Estimated (or last confirmed) value today. */
	value: number;
	/** True only when the value was extrapolated from a rate, not read. */
	estimated: boolean;
	/** The date the estimate is for. */
	asOf: string;
	/** Units per day, 0 when there is nothing to extrapolate from. */
	ratePerDay: number;
}

/** A meter, its recent readings, and where it is today. */
export interface Meter {
	id: number;
	assetId: number;
	kind: MeterKind;
	unit: string;
	label: string | null;
	/** Newest first. */
	readings: MeterReading[];
	lastReading: MeterReading | null;
	estimate: MeterEstimate | null;
	createdAt: string | null;
	updatedAt: string | null;
}

/**
 * How far ahead the estimate is allowed to run.
 *
 * A single old reading plus a wild rate would otherwise project a parked car
 * to the moon; capping the extrapolation keeps "estimated" an honest word and
 * makes the reminder say "no reading since May" instead of a fiction.
 */
const MAX_EXTRAPOLATION_DAYS = 365;

function round(value: number, places = 1): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/**
 * The value a meter had on a date, from the readings we hold.
 *
 * The latest reading at or before the date wins. When every reading is newer
 * than the date (an entry logged before anyone started reading the meter), the
 * earliest reading is used — it under-counts the interval, which is the safe
 * direction: a reminder fires late rather than claiming work that was not done.
 */
export function readingInEffect(readings: MeterReading[], date: string): MeterReading | null {
	if (!readings.length) return null;
	const ascending = [...readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
	let found: MeterReading | null = null;
	for (const reading of ascending) {
		if (reading.recordedAt <= date) found = reading;
	}
	return found ?? ascending[0] ?? null;
}

/**
 * Interpolate a meter to `today`.
 *
 * Two readings a season apart give a rate; the estimate is that rate applied
 * to the days since the last confirmed reading. With fewer than two readings
 * the last reading is the answer and `estimated` is false — no invented rate.
 */
export function estimateMeter(readings: MeterReading[], today: string): MeterEstimate | null {
	if (!readings.length) return null;
	const ascending = [...readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
	const last = ascending[ascending.length - 1]!;
	let ratePerDay = 0;
	if (ascending.length >= 2) {
		const previous = ascending[ascending.length - 2]!;
		const days = dayDiff(previous.recordedAt, last.recordedAt);
		// A meter only runs forward. A lower reading is a correction, not a
		// negative rate, so the estimate holds at the confirmed value.
		if (days > 0 && last.value > previous.value) {
			ratePerDay = (last.value - previous.value) / days;
		}
	}
	const sinceDays = Math.min(Math.max(dayDiff(last.recordedAt, today), 0), MAX_EXTRAPOLATION_DAYS);
	const value = last.value + ratePerDay * sinceDays;
	return {
		value: round(value),
		estimated: ratePerDay > 0 && sinceDays > 0,
		asOf: last.recordedAt,
		ratePerDay: round(ratePerDay, 3),
	};
}

export function shapeReading(row: MeterReadingRow): MeterReading {
	return {
		id: Number(row.id),
		value: Number(row.value),
		recordedAt: String(row.recorded_at),
		source: String(row.source ?? 'manual'),
		maintenanceEntryId:
			row.maintenance_entry_id === null || row.maintenance_entry_id === undefined
				? null
				: Number(row.maintenance_entry_id),
	};
}

export function shapeMeter(row: MeterRow, readings: MeterReading[], today: string): Meter {
	const newestFirst = [...readings].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
	return {
		id: Number(row.id),
		assetId: Number(row.asset_id),
		kind: isMeterKind(row.kind) ? row.kind : 'count',
		unit: String(row.unit),
		label: row.label ?? null,
		readings: newestFirst,
		lastReading: newestFirst[0] ?? null,
		estimate: estimateMeter(newestFirst, today),
		createdAt: row.created_at ?? null,
		updatedAt: row.updated_at ?? null,
	};
}

/** Today's date in the family's clock, from the caller's instant. */
export function todayIn(timeZone: string, nowMs = Date.now()): string {
	return zonedDate(nowMs, timeZone);
}
