// reports.ts (routes)
//
// One endpoint: the daily series behind the Reports page. It reads feedings and
// the inventory ledger — both already recorded — and hands them to the pure
// aggregator in ../reports.ts. Nothing new is stored; this is a read view.
import { Hono } from 'hono';
import { type AuthEnv } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { resolveTrackableMember } from '../member-scope';
import { timezoneForHousehold } from '../medications';
import { addDays, dayDiff, isoDate, parseDate } from '../dates';
import { zonedDate } from '../timezone';
import { buildDailyReport, type ItemMeta } from '../reports';

const reportRoutes = new Hono<AuthEnv>();

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

/** A real YYYY-MM-DD, rejecting a well-shaped date that rolls over (2026-13-45). */
function isValidDay(value: string | undefined): value is string {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = parseDate(value);
	return parsed !== null && isoDate(parsed) === value;
}

/**
 * GET /daily?days=30&memberId=12
 *
 * Family-wide by default; `memberId` narrows the feeding series to one child
 * (the pump series included, since a parent logs a pump against the child they
 * are feeding). Inventory is a household ledger, so with a member filter it is
 * limited to items tied to that member or to the household at large — never to
 * another member's stock.
 */
reportRoutes.get('/daily', async (c) => {
	try {
		const db = c.get('db');
		const userId = c.get('userId');

		const memberIdRaw = c.req.query('memberId');
		const memberId = memberIdRaw ? Number(memberIdRaw) : null;

		let subjectId: number | null = null;
		if (memberId) {
			const scope = await resolveTrackableMember(db, userId, memberId);
			if (!scope) return c.json({ error: 'Member not found or access denied' }, 404);
			subjectId = scope.subjectId;
		}

		// A caller either names a window in days or an explicit `from`/`to` range.
		// Both are accepted so the presets stay one number while a custom range
		// can reach a slice of history the presets cannot.
		const fromQ = c.req.query('from');
		const toQ = c.req.query('to');
		const custom = isValidDay(fromQ) && isValidDay(toQ);

		const nowMs = Date.now();
		const timeZone = await timezoneForHousehold(db, NAMESPACE_HOUSEHOLD_ID);

		let dates: string[];
		let days: number;
		if (custom) {
			if (fromQ > toQ) return c.json({ error: 'The start date must be on or before the end date.' }, 400);
			const span = dayDiff(fromQ, toQ) + 1;
			if (span > MAX_DAYS) {
				return c.json({ error: `That range is ${span} days; the most this can show is ${MAX_DAYS}.` }, 400);
			}
			dates = [];
			for (let day = fromQ; day <= toQ; day = addDays(day, 1)) dates.push(day);
			days = dates.length;
		} else {
			days = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(c.req.query('days')) || DEFAULT_DAYS)));
			const today = zonedDate(nowMs, timeZone);
			dates = [];
			for (let i = days - 1; i >= 0; i--) dates.push(addDays(today, -i));
		}

		// The UTC midnight of the first day, one day back, covers any zone offset
		// so the earliest local bucket is never starved of the instant that
		// opened it. Anything after the window is dropped by the aggregator.
		const since = new Date(new Date(`${dates[0]}T00:00:00.000Z`).getTime() - DAY_MS).toISOString();

		const feedArgs: unknown[] = [since];
		let feedSql = 'SELECT type, amount, amount_unit, start_time, formula_item_id FROM feedings WHERE start_time >= ?';
		if (subjectId !== null) {
			feedSql += ' AND subject_id = ?';
			feedArgs.push(subjectId);
		}
		const feedingRows = (await db.execute({ sql: feedSql, args: feedArgs })).rows;

		// Only the rows that can move a series: consumption ('used') and manual
		// recounts ('correction'). Purchases are stock in, not out.
		const adjArgs: unknown[] = [since];
		let adjSql = `SELECT item_id, change, reason, created_at FROM inventory_adjustments
		              WHERE created_at >= ? AND change < 0 AND reason IN ('used', 'correction')`;
		if (subjectId !== null) {
			adjSql += ' AND (item_id IN (SELECT id FROM inventory_items WHERE subject_id IS NULL OR subject_id = ?))';
			adjArgs.push(subjectId);
		}
		const adjustmentRows = (await db.execute({ sql: adjSql, args: adjArgs })).rows;

		const itemRows = (await db.execute({
			sql: 'SELECT id, name, variant, category, unit FROM inventory_items',
		})).rows as Array<Record<string, unknown>>;
		const items = new Map<number, ItemMeta>();
		for (const r of itemRows) {
			items.set(Number(r.id), {
				name: r.variant ? `${r.name} (${r.variant})` : String(r.name),
				category: String(r.category ?? 'other'),
				unit: String(r.unit ?? 'count'),
			});
		}

		const report = buildDailyReport({
			dates,
			timeZone,
			feedings: feedingRows as Array<Record<string, unknown>>,
			adjustments: adjustmentRows as Array<Record<string, unknown>>,
			items,
		});

		return c.json({
			report: {
				...report,
				timezone: timeZone,
				windowDays: days,
				from: dates[0],
				to: dates[dates.length - 1],
				memberId: memberId ?? null,
			},
		});
	} catch (error) {
		c.get('log').error('get daily report failed', { err: error });
		return c.json({ error: 'Failed to build report' }, 500);
	}
});

export { reportRoutes };
