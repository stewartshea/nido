// api/src/dates.ts
//
// Calendar-date arithmetic, in one place.
//
// Nido stores a *date* ("the oil change happened on the 14th", "the odometer
// read 82,100 on Oct 1") separately from an instant. A date has no timezone
// and no clock; adding a day to it must not depend on the server's DST. These
// helpers work on UTC midnight internally and only ever expose YYYY-MM-DD, so
// a leap year and a daylight-saving Sunday behave the same way.
//
// A timestamp that slipped into a date column is tolerated by reading its
// first ten characters — the alternative is a schedule that silently never
// fires because its baseline had a time on it.

const DAY_MS = 86_400_000;

/** A date's UTC midnight, or null when the string is not a date. */
export function parseDate(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) return null;
	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return Number.isNaN(date.getTime()) ? null : date;
}

/** The YYYY-MM-DD part of a date or timestamp string. */
export function datePart(value: string): string {
	return value.slice(0, 10);
}

export function isoDate(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function dayDiff(from: string, to: string): number {
	const a = parseDate(from);
	const b = parseDate(to);
	if (!a || !b) return 0;
	return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function addDays(date: string, days: number): string {
	const parsed = parseDate(date);
	if (!parsed) return date;
	return isoDate(new Date(parsed.getTime() + days * DAY_MS));
}

/**
 * Add months, clamping to the target month's last day.
 *
 * Jan 31 + 1 month is Feb 28, not March 3. A schedule that rolls forward by
 * "every 6 months" must not drift later every time it lands on the 31st.
 */
export function addMonths(date: string, months: number): string {
	const parsed = parseDate(date);
	if (!parsed) return date;
	const year = parsed.getUTCFullYear();
	const month = parsed.getUTCMonth();
	const day = parsed.getUTCDate();
	const target = new Date(Date.UTC(year, month + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return isoDate(target);
}

/** "Nov 15" — a month-day pair for a window edge. */
export function formatMonthDay(value: string): string {
	const parsed = parseDate(value);
	if (!parsed) return value;
	return parsed.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Oct 1, 2026" — a date for a person. */
export function formatDate(value: string): string {
	const parsed = parseDate(value);
	if (!parsed) return value;
	return parsed.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
