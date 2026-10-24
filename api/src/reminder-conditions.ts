// reminder-conditions.ts
//
// The evaluator for tracking rules. The categories and their shapes live in
// registry.ts now — this module reads them and decides whether a rule is
// overdue.
//
// A rule used to name exactly one hard-coded category, and `latestFor` was a
// switch over five of them. Anything else — a routine like a bath, a category
// added later, a family's own option — fell through to `return null`, which the
// evaluator read as "never happened", so the rule fired forever or, in the UI,
// could not be chosen at all. The two requests that exposed this were "no bath
// in 7 days" (a routine, not one of the five) and "no pump or feed in 3 hours"
// (two conditions OR'd, which one category could not express).
//
// So a rule carries a list of conditions, any one of which having happened
// recently clears it, and what a condition may name comes from the registry —
// adding a category, or a family's custom option, makes it selectable and
// evaluable with no change here.

import { SOURCES, reminderCatalog, type Source } from './registry';
import { NAMESPACE_HOUSEHOLD_ID } from './db-core';

export interface ReminderCondition {
	category: string;
	/** Option values to narrow the category to (a routine's "bath", a feed's "breast"). Empty means any. */
	values?: string[];
}

/**
 * How a rule's conditions combine.
 *
 * `any` (OR) is the everyday case: "no pump or feed in 3h" clears as soon as
 * either has happened. `all` (AND) is the stricter one: "a feed and a change
 * in 3h" clears only once both have happened, so a feed alone still leaves the
 * rule overdue. One combinator for the whole rule, not a tree — the requests
 * so far are "either" and "both", and a nested group would be a second thing to
 * explain for no journey that needs it yet.
 */
export type ReminderMatch = 'any' | 'all';

export function parseMatch(raw: unknown): ReminderMatch {
	return raw === 'all' ? 'all' : 'any';
}

/**
 * A family's own option values, so a reminder or a stock rule can name a
 * routine the household invented. Read from the same settings row the
 * reminders catalog merges over.
 */
export async function familyOptionValues(
	db: any,
): Promise<Record<string, Record<string, string[]>>> {
	const res = await db.execute({
		sql: 'SELECT category_options FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const raw = (res.rows[0] as { category_options?: unknown } | undefined)?.category_options;
	if (typeof raw !== 'string' || !raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, Record<string, string[]>>) : {};
	} catch {
		return {};
	}
}

/**
 * Normalise a stored rule's conditions. A rule written before this existed has
 * no `conditions` and only a `category`, so it is read as a single condition —
 * that is the whole backward-compatibility story, and it needs no data rewrite.
 */
export function parseConditions(raw: unknown, legacyCategory?: string | null): ReminderCondition[] {
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		if (!raw.trim()) parsed = undefined;
		else {
			try {
				parsed = JSON.parse(raw);
			} catch {
				parsed = undefined;
			}
		}
	}
	if (Array.isArray(parsed)) {
		const out: ReminderCondition[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== 'object') continue;
			const category = (entry as { category?: unknown }).category;
			if (typeof category !== 'string' || !category.trim()) continue;
			const rawValues = (entry as { values?: unknown }).values;
			const values = Array.isArray(rawValues)
				? rawValues.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
				: [];
			out.push(values.length ? { category, values } : { category });
		}
		if (out.length) return out;
	}
	if (legacyCategory && legacyCategory.trim()) return [{ category: legacyCategory }];
	return [];
}

/** Validate a rule's conditions; returns an error message, or null when valid. */
export function validateConditions(
	conditions: ReminderCondition[],
	custom: Record<string, Record<string, string[]>> = {},
): string | null {
	if (conditions.length === 0) return 'Choose at least one thing to watch.';
	const catalog = new Map(reminderCatalog(custom).map((c) => [c.id, c]));
	for (const condition of conditions) {
		const entry = catalog.get(condition.category);
		if (!entry) return `"${condition.category}" is not something Nido can watch.`;
		if (condition.values?.length) {
			const allowed = new Set(entry.options);
			for (const value of condition.values) {
				if (!allowed.has(value)) return `"${value}" is not a valid ${entry.label.toLowerCase()} option.`;
			}
		}
	}
	return null;
}

/**
 * When the target last did each condition, as epoch millis in the same order as
 * the conditions, or null for one that has never happened.
 */
export async function latestTimesForConditions(
	db: any,
	familyId: number,
	conditions: ReminderCondition[],
	targetId: number | null,
): Promise<Array<number | null>> {
	const times: Array<number | null> = [];
	for (const condition of conditions) {
		times.push(await latestForCondition(db, familyId, condition, targetId));
	}
	return times;
}

/**
 * Evaluate an inactivity rule from its per-condition timestamps.
 *
 * `any`: the rule is waiting on the most recent of the conditions, and clears
 * the moment one happens. Overdue when even that is older than the window.
 *
 * `all`: the rule clears only once every condition has happened inside the
 * window, so the binding constraint is the OLDEST of them, and a condition that
 * has never happened leaves it overdue with nothing to report as "since".
 */
export function evaluateInactivity(
	match: ReminderMatch,
	times: Array<number | null>,
	hours: number,
	nowMs: number,
): { overdue: boolean; since: number | null } {
	const window = hours * 3600 * 1000;
	const known = times.filter((t): t is number => t !== null);

	if (match === 'all') {
		if (known.length < times.length || known.length === 0) {
			return { overdue: true, since: null };
		}
		const oldest = Math.min(...known);
		return { overdue: nowMs - oldest > window, since: oldest };
	}

	if (known.length === 0) return { overdue: true, since: null };
	const newest = Math.max(...known);
	return { overdue: nowMs - newest > window, since: newest };
}

/**
 * Whether a stored reminder is firing right now. Shared by the list route and
 * the navigation badge so the badge cannot disagree with the page.
 *
 * Resolved through `family_members`, not by comparing ids directly. A reminder
 * targets a member (that is what the picker offers), while every log row carries
 * a `subject_id`. Those are different numbers that coincide only for a member
 * with no adult sharing the household.
 */
export async function evaluateReminder(
	db: any,
	r: any,
): Promise<{ overdue: boolean; since: number | null }> {
	const now = Date.now();
	// An interval rule written before it could name a category stores the
	// placeholder 'custom', so the legacy category is only read for inactivity.
	const conditions = parseConditions(r.conditions, r.kind === 'inactivity' ? r.category : null);

	if (conditions.length) {
		const hours = r.kind === 'inactivity' ? Number(r.hours ?? 0) : Number(r.interval_days ?? 0) * 24;
		const times = await latestTimesForConditions(
			db,
			Number(r.family_id),
			conditions,
			r.target_id ? Number(r.target_id) : null,
		);
		return evaluateInactivity(parseMatch(r.match_mode), times, hours, now);
	}

	// A manual rule with nothing to watch is completed by hand ("mark done").
	const days = Number(r.interval_days ?? 0);
	const lastTs = r.last_at ? new Date(String(r.last_at)).getTime() : null;
	if (!lastTs) return { overdue: true, since: null };
	return { overdue: now - lastTs > days * 24 * 3600 * 1000, since: lastTs };
}

async function latestForCondition(
	db: any,
	familyId: number,
	condition: ReminderCondition,
	targetId: number | null,
): Promise<number | null> {
	const src: Source | undefined = SOURCES[condition.category];
	if (!src) return null;

	const params: Array<number | string> = [familyId];
	let where = 'fm.household_id = ?';
	if (targetId) {
		where += ' AND fm.id = ?';
		params.push(targetId);
	}
	if (src.eventsCategory) {
		// The kind the milestones table used to encode is the events
		// category now — a plain equality, not a second dimension.
		where += ' AND x.category = ?';
		params.push(src.eventsCategory);
	}
	if (src.baseWhere) where += ` AND ${src.baseWhere}`;
	// A plain column narrows as x.<column>; an events-backed option value is
	// a whole expression (see the registry), used as-is. Either way the
	// values are parameters — no input is ever interpolated.
	const optionTarget = src.optionExpr ?? (src.optionColumn ? `x.${src.optionColumn}` : null);
	if (optionTarget && condition.values?.length) {
		where += ` AND ${optionTarget} IN (${condition.values.map(() => '?').join(', ')})`;
		params.push(...condition.values);
	}

	// Table and column names come from the registry above, never from input.
	// The join mirrors resolveTrackableMember's write path, which records against
	// COALESCE(legacy_subject_id, the member's aligned subject id). Joining only
	// on legacy_subject_id left older aligned members unable to ever clear a rule.
	const sql = `SELECT MAX(x.${src.time}) AS t FROM ${src.table} x
	             JOIN family_members fm ON COALESCE(fm.legacy_subject_id, fm.id) = x.subject_id
	             WHERE ${where}`;
	const res = await db.execute({ sql, args: params });
	const row = res.rows[0] as { t?: unknown } | undefined;
	const t = row?.t;
	return t ? new Date(String(t)).getTime() : null;
}
