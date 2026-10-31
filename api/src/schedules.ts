// api/src/schedules.ts
//
// HOME module milestone 3 (issue #67): recurring care obligations and the
// answer to "what's due".
//
// A schedule item is one obligation on one asset — "oil change", "swap to
// winter tires" — with a *list* of trigger conditions and one combinator.
// `match: any` is the everyday case and the reason the grammar is a list:
// "every 8,000 km *or* 6 months, whichever comes first" is ONE schedule with
// two conditions, not two schedules that both nag.
//
// The condition kinds reuse the shapes the reminder work already established:
//
//   interval  — every N days or months since the last time it was done
//   meter     — every N km / N hours on a named meter
//   seasonal  — a month-day window that recurs every year (Nov 15 – Dec 15)
//
// Seasonal is a first-class condition rather than a year-anchored interval,
// because a window has an *end*: "past the close and still not done" is a
// different, more useful state than "61 days since the last one".
//
// Checklists are derived, not stored. A seasonal schedule instantiates at read
// time from its window plus the maintenance log, so a checked-off item is
// always backed by a record with history, cost, and a receipt.

import { addDays, addMonths, datePart, dayDiff, formatDate, formatMonthDay } from './dates';
import { estimateMeter, readingInEffect, type MeterReading } from './meters';

export type ScheduleMatch = 'any' | 'all';

export function parseScheduleMatch(raw: unknown): ScheduleMatch {
	return raw === 'all' ? 'all' : 'any';
}

export type IntervalUnit = 'days' | 'months';

export type ScheduleCondition =
	| { kind: 'interval'; every: number; unit: IntervalUnit }
	| { kind: 'meter'; meterId: number; every: number }
	| { kind: 'seasonal'; start: string; end: string };

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

export function isMonthDay(value: unknown): value is string {
	return typeof value === 'string' && MONTH_DAY.test(value);
}

/**
 * Read a stored condition document.
 *
 * Unknown or malformed entries are dropped rather than crashing the page: a
 * condition written by a newer build than the one reading it is not a reason
 * to lose the whole schedule. Validation happens on write, so what survives
 * here is what this build understands.
 */
export function parseScheduleConditions(raw: unknown): ScheduleCondition[] {
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	const out: ScheduleCondition[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const candidate = entry as Record<string, unknown>;
		if (candidate.kind === 'interval') {
			const every = Number(candidate.every);
			const unit = candidate.unit === 'months' ? 'months' : candidate.unit === 'days' ? 'days' : null;
			if (Number.isFinite(every) && every > 0 && unit) out.push({ kind: 'interval', every, unit });
		} else if (candidate.kind === 'meter') {
			const meterId = Number(candidate.meterId);
			const every = Number(candidate.every);
			if (Number.isInteger(meterId) && meterId > 0 && Number.isFinite(every) && every > 0) {
				out.push({ kind: 'meter', meterId, every });
			}
		} else if (candidate.kind === 'seasonal') {
			if (isMonthDay(candidate.start) && isMonthDay(candidate.end)) {
				out.push({ kind: 'seasonal', start: candidate.start, end: candidate.end });
			}
		}
	}
	return out;
}

/** Validate a schedule's conditions; returns an error message, or null. */
export function validateScheduleConditions(
	conditions: ScheduleCondition[],
	meterIds: ReadonlySet<number>,
): string | null {
	if (!conditions.length) return 'Add at least one trigger — an interval, a meter, or a season.';
	if (conditions.length > 10) return 'Ten triggers is plenty for one task.';
	for (const condition of conditions) {
		if (condition.kind === 'interval') {
			if (!Number.isFinite(condition.every) || condition.every <= 0) return 'An interval needs a positive number.';
			if (condition.unit === 'days' && condition.every > 3650) return 'That interval is longer than ten years.';
			if (condition.unit === 'months' && condition.every > 120) return 'That interval is longer than ten years.';
		} else if (condition.kind === 'meter') {
			if (!meterIds.has(condition.meterId)) return 'That meter is not on this asset.';
			if (!Number.isFinite(condition.every) || condition.every <= 0) return 'A meter trigger needs a positive amount.';
		} else if (condition.kind === 'seasonal') {
			if (!isMonthDay(condition.start) || !isMonthDay(condition.end)) {
				return 'A season needs a start and an end date (MM-DD).';
			}
			if (condition.start === condition.end) return 'A season needs two different dates.';
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export interface SeasonalWindow {
	/** ISO dates. A window that wraps the new year has end > start's year. */
	start: string;
	end: string;
}

/** The window that starts in `year`, wrapping into the next when end < start. */
export function seasonalWindow(startMonthDay: string, endMonthDay: string, year: number): SeasonalWindow {
	const start = `${year}-${startMonthDay}`;
	const endYear = endMonthDay < startMonthDay ? year + 1 : year;
	return { start, end: `${endYear}-${endMonthDay}` };
}

export interface SeasonalStatus {
	/** The window this status is about: the active one, or the nearest. */
	window: SeasonalWindow;
	/** open = today is inside; upcoming = not open yet; closed = it ended. */
	state: 'upcoming' | 'open' | 'closed';
	satisfied: boolean;
	skipped: boolean;
	/** The entry that satisfied this window, when there is one. */
	entryAt: string | null;
	/** The skip reason, when the family said "not this season". */
	skipReason: string | null;
	/** Days until the window opens (upcoming) or closes (open); negative once closed. */
	remainingDays: number;
}

/**
 * Where a seasonal condition stands today.
 *
 * Satisfaction is an entry whose performed date lands inside the window, or an
 * explicit skip for that same window. Both are records; neither is a checkbox
 * that could drift away from the log.
 */
export function seasonalStatus(
	condition: Extract<ScheduleCondition, { kind: 'seasonal' }>,
	entries: readonly string[],
	skips: ReadonlyMap<string, string | null>,
	today: string,
	leadDays: number,
): SeasonalStatus {
	const year = Number(today.slice(0, 4));
	const windows = [year - 1, year, year + 1].map((y) => seasonalWindow(condition.start, condition.end, y));

	const inWindow = (window: SeasonalWindow) => entries.filter((date) => date >= window.start && date <= window.end);
	const skipReason = (window: SeasonalWindow) => (skips.has(window.start) ? skips.get(window.start) ?? null : undefined);

	const active = windows.find((window) => today >= window.start && today <= window.end);
	if (active) {
		const satisfiedAt = inWindow(active).sort()[0] ?? null;
		const reason = skipReason(active);
		return {
			window: active,
			state: 'open',
			satisfied: satisfiedAt !== null || reason !== undefined,
			skipped: reason !== undefined,
			entryAt: satisfiedAt,
			skipReason: reason ?? null,
			remainingDays: dayDiff(today, active.end),
		};
	}

	// The most recent window that has already closed. "Past the close and
	// unsatisfied" is the overdue state the PRD calls for.
	const closed = [...windows].filter((window) => window.end < today).pop();
	if (closed) {
		const satisfiedAt = inWindow(closed).sort()[0] ?? null;
		const reason = skipReason(closed);
		if (satisfiedAt === null && reason === undefined) {
			return {
				window: closed,
				state: 'closed',
				satisfied: false,
				skipped: false,
				entryAt: null,
				skipReason: null,
				remainingDays: dayDiff(today, closed.end),
			};
		}
	}

	const upcoming = windows.find((window) => window.start > today)!;
	const reason = skipReason(upcoming);
	return {
		window: upcoming,
		state: 'upcoming',
		satisfied: reason !== undefined,
		skipped: reason !== undefined,
		entryAt: null,
		skipReason: reason ?? null,
		remainingDays: dayDiff(today, upcoming.start),
	};
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface MeterLookup {
	kind: string;
	unit: string;
	label: string | null;
	readings: MeterReading[];
}

export interface ScheduleEvalInput {
	conditions: ScheduleCondition[];
	match: ScheduleMatch;
	leadDays: number;
	/** Today in the family's clock (YYYY-MM-DD). */
	today: string;
	/** When the obligation started: the schedule's creation date. */
	since: string;
	/** performed_at dates of entries linked to this schedule, ascending. */
	entries: string[];
	/** window_start dates explicitly skipped → reason. */
	skips: ReadonlyMap<string, string | null>;
	meters: ReadonlyMap<number, MeterLookup>;
}

export type ConditionState = 'ok' | 'due' | 'overdue';

export interface ConditionStatus {
	kind: ScheduleCondition['kind'];
	label: string;
	state: ConditionState;
	/** The date the condition comes due, when one can be named. */
	dueAt: string | null;
	/** Days left (interval/seasonal) or units left (meter); negative = past. */
	remaining: number | null;
	remainingUnit: 'days' | string;
	/** A sentence for the card: "2,100 km to go · last read 82,100 on Oct 1". */
	detail: string;
}

export interface ScheduleStatus {
	state: ConditionState;
	dueAt: string | null;
	/** Days until the nearest day-based condition is due; null when none. */
	remainingDays: number | null;
	conditions: ConditionStatus[];
	/** The seasonal checklist instance, when this schedule has a season. */
	season: SeasonalStatus | null;
}

const STATE_ORDER: Record<ConditionState, number> = { ok: 0, due: 1, overdue: 2 };

function worst(a: ConditionState, b: ConditionState): ConditionState {
	return STATE_ORDER[b] > STATE_ORDER[a] ? b : a;
}

function numberFmt(value: number): string {
	return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 }).format(value);
}

function intervalLabel(every: number, unit: IntervalUnit): string {
	if (unit === 'months') return every % 12 === 0 && every >= 12 ? `Every ${every / 12} year${every === 12 ? '' : 's'}` : `Every ${every} month${every === 1 ? '' : 's'}`;
	return `Every ${every} day${every === 1 ? '' : 's'}`;
}

/**
 * Evaluate one condition.
 *
 * The baseline is the last time the obligation was satisfied — a maintenance
 * entry — or the schedule's own start when it never has been. That is what
 * makes "every 6 months" mean six months since the oil change rather than six
 * months since the row was created.
 */
export function evaluateCondition(
	condition: ScheduleCondition,
	input: ScheduleEvalInput,
	lastEntryAt: string | null,
): ConditionStatus {
	if (condition.kind === 'interval') {
		const baseline = datePart(lastEntryAt ?? input.since);
		const dueAt = condition.unit === 'months' ? addMonths(baseline, condition.every) : addDays(baseline, condition.every);
		const daysLeft = dayDiff(input.today, dueAt);
		const state: ConditionState = daysLeft < 0 ? 'overdue' : daysLeft <= input.leadDays ? 'due' : 'ok';
		return {
			kind: 'interval',
			label: intervalLabel(condition.every, condition.unit),
			state,
			dueAt,
			remaining: daysLeft,
			remainingUnit: 'days',
			detail:
				daysLeft < 0
					? `Overdue by ${numberFmt(-daysLeft)} day${daysLeft === -1 ? '' : 's'} · was due ${formatDate(dueAt)}`
					: daysLeft === 0
						? 'Due today'
						: `${numberFmt(daysLeft)} day${daysLeft === 1 ? '' : 's'} left · due ${formatDate(dueAt)}`,
		};
	}

	if (condition.kind === 'meter') {
		const meter = input.meters.get(condition.meterId);
		const label = meter
			? `Every ${numberFmt(condition.every)} ${meter.unit}`
			: `Every ${numberFmt(condition.every)} (missing meter)`;
		if (!meter || !meter.readings.length) {
			return {
				kind: 'meter',
				label,
				state: 'ok',
				dueAt: null,
				remaining: null,
				remainingUnit: meter?.unit ?? '',
				detail: 'No readings yet — add one to start tracking.',
			};
		}
		const ascending = [...meter.readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
		const estimate = estimateMeter(ascending, input.today)!;
		// Distance since the last time it was done. Before any entry exists,
		// the first reading is the honest zero point.
		const baselineReading = lastEntryAt ? readingInEffect(ascending, datePart(lastEntryAt)) : ascending[0];
		const baseline = baselineReading?.value ?? 0;
		const remaining = Math.round((baseline + condition.every - estimate.value) * 10) / 10;
		// "Lead days" becomes lead *units* through the meter's own rate, so a
		// car doing 60 km/day gets a two-week warning and a parked one does not.
		const leadUnits = estimate.ratePerDay > 0 ? estimate.ratePerDay * input.leadDays : 0;
		const state: ConditionState = remaining <= 0 ? 'overdue' : remaining <= leadUnits ? 'due' : 'ok';
		const dueAt =
			estimate.ratePerDay > 0
				? addDays(input.today, Math.max(0, Math.ceil(remaining / estimate.ratePerDay)))
				: remaining <= 0
					? input.today
					: null;
		const last = ascending[ascending.length - 1]!;
		const lastText = `${numberFmt(last.value)} on ${formatDate(last.recordedAt)}`;
		return {
			kind: 'meter',
			label,
			state,
			dueAt,
			remaining,
			remainingUnit: meter.unit,
			detail:
				remaining <= 0
					? `${numberFmt(-remaining)} ${meter.unit} past due · last read ${lastText}${estimate.estimated ? ` (est. ${numberFmt(estimate.value)} today)` : ''}`
					: `${numberFmt(remaining)} ${meter.unit} to go · last read ${lastText}${estimate.estimated ? ` (est. ${numberFmt(estimate.value)} today)` : ''}`,
		};
	}

	const season = seasonalStatus(condition, input.entries, input.skips, input.today, input.leadDays);
	const label = `${formatMonthDay(season.window.start)} – ${formatMonthDay(season.window.end)}`;
	let state: ConditionState = 'ok';
	let detail: string;
	if (season.state === 'open') {
		state = season.satisfied ? 'ok' : 'due';
		detail = season.satisfied
			? season.skipped
				? `Skipped this season${season.skipReason ? `: ${season.skipReason}` : ''}`
				: `Done ${formatDate(season.entryAt!)}`
			: `Open until ${formatDate(season.window.end)}`;
	} else if (season.state === 'closed' && !season.satisfied) {
		state = 'overdue';
		detail = `Missed the window that closed ${formatDate(season.window.end)}`;
	} else {
		state = season.remainingDays <= input.leadDays ? 'due' : 'ok';
		detail = `Opens ${formatDate(season.window.start)}`;
	}
	return {
		kind: 'seasonal',
		label,
		state,
		dueAt: season.window.start,
		remaining: season.remainingDays,
		remainingUnit: 'days',
		detail,
	};
}

/**
 * Evaluate a whole schedule.
 *
 * `any` (the default) fires on the first condition to come due, so the state
 * is the worst of them. `all` fires only once every condition is due — the
 * binding constraint is the latest one — which is the "and" case ("wheels
 * rotated AND the season is over").
 */
export function evaluateSchedule(input: ScheduleEvalInput): ScheduleStatus {
	const lastEntryAt = input.entries.length ? [...input.entries].sort().pop()! : null;
	const conditions = input.conditions.map((condition) => evaluateCondition(condition, input, lastEntryAt));
	const seasonCondition = input.conditions.find((c) => c.kind === 'seasonal');
	const season =
		seasonCondition && seasonCondition.kind === 'seasonal'
			? seasonalStatus(seasonCondition, input.entries, input.skips, input.today, input.leadDays)
			: null;

	if (!conditions.length) {
		return { state: 'ok', dueAt: null, remainingDays: null, conditions, season };
	}

	let state: ConditionState;
	if (input.match === 'all') {
		state = conditions.every((c) => c.state === 'overdue')
			? 'overdue'
			: conditions.every((c) => c.state !== 'ok')
				? 'due'
				: 'ok';
	} else {
		state = conditions.reduce<ConditionState>((acc, c) => worst(acc, c.state), 'ok');
	}

	const dated = conditions.filter((c) => c.remainingUnit === 'days' && c.remaining !== null);
	const remainingDays = dated.length
		? (input.match === 'all' ? Math.max(...dated.map((c) => c.remaining!)) : Math.min(...dated.map((c) => c.remaining!)))
		: null;
	const dueDates = conditions.map((c) => c.dueAt).filter((d): d is string => !!d).sort();
	const dueAt = input.match === 'all' ? (dueDates.length ? dueDates[dueDates.length - 1]! : null) : (dueDates[0] ?? null);

	return { state, dueAt, remainingDays, conditions, season };
}

/** The one-line status a card shows. */
export function statusLine(status: ScheduleStatus): string {
	if (status.state === 'overdue') {
		const first = status.conditions.find((c) => c.state === 'overdue');
		return first ? first.detail : 'Overdue';
	}
	if (status.state === 'due') {
		const first = status.conditions.find((c) => c.state === 'due');
		return first ? first.detail : 'Due soon';
	}
	if (status.remainingDays !== null) {
		return status.remainingDays === 0 ? 'Due today' : `${numberFmt(status.remainingDays)} days out`;
	}
	const next = status.conditions.find((c) => c.state === 'ok' && c.detail);
	return next ? next.detail : 'Nothing due';
}
