import { dueCycles, MS_PER_DAY, type AdjustmentRow } from './inventory';
import { SIGNALS, evaluateRules, type Evaluation, type InventoryRule, type SignalContext } from './inventory-signals';

/**
 * Family-scoped inventory evaluation, and who gets told about it.
 *
 * This used to live inside routes/inventory.ts, where every helper needed the
 * caller's userId to find its family. That works for a request and breaks for a
 * scheduler, which has a family but no user. Scope is therefore read from the
 * database itself, so the same code serves a logged-in click and a background
 * sweep. See notifications.ts for the digest built on top.
 *
 * Evaluation and notification bookkeeping are kept apart on purpose. Which rules
 * match is a property of the current values; who has been emailed is not. If the
 * read path wrote notification state, opening the page would consume the
 * notification and the digest would never send it.
 */

/** The one household row in a family database, which is the tenant boundary. */
export async function householdScopeId(db: any): Promise<number | null> {
	const res = await db.execute({ sql: 'SELECT id FROM households ORDER BY id LIMIT 1' });
	return res.rows[0] ? Number((res.rows[0] as any).id) : null;
}

/** 'users' with an empty list means the caregiver explicitly chose nobody. */
export function parseAudienceIds(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
	} catch {
		return [];
	}
}

export async function loadRulesForFamily(db: any): Promise<InventoryRule[]> {
	const scope = await householdScopeId(db);
	if (scope === null) return [];
	const rows = (await db.execute({
		sql: `SELECT r.*, u.first_name AS creator_first_name FROM inventory_rules r
		      LEFT JOIN users u ON u.id = r.created_by
		      WHERE r.family_id = ? ORDER BY r.created_at`,
		args: [scope],
	})).rows as any[];
	return rows.map((r) => ({
		id: Number(r.id),
		itemId: r.item_id === null || r.item_id === undefined ? null : Number(r.item_id),
		category: r.category ?? null,
		signal: String(r.signal),
		comparator: r.comparator as InventoryRule['comparator'],
		threshold: Number(r.threshold),
		repeatDays: r.repeat_days === null || r.repeat_days === undefined ? null : Number(r.repeat_days),
		enabled: Number(r.enabled ?? 1) === 1,
		createdBy: r.created_by ?? null,
		createdByName: r.creator_first_name ?? null,
		audienceKind: String(r.audience_kind ?? 'family') === 'users' ? 'users' : 'family',
		audienceIds: parseAudienceIds(r.audience_ids),
	}));
}

export async function applyScheduledConsumption(
	db: any, row: any, actorId: string | null, nowMs: number,
): Promise<number> {
	if (!row) return 0;
	const { due, total } = dueCycles(row, nowMs);
	if (due <= 0) return 0;

	const per = row.decrement_per_event === null || row.decrement_per_event === undefined ? 1 : Number(row.decrement_per_event);
	const applied = Number(row.consume_cycles_applied ?? 0);
	const startedMs = new Date(String(row.consume_started_at)).getTime();
	const interval = Number(row.consume_interval_days);
	const next = (from: number) => new Date(startedMs + from * interval * MS_PER_DAY).toISOString();

	for (let cycle = applied; cycle < total; cycle++) {
		await db.execute({
			sql: `INSERT INTO inventory_adjustments (item_id, change, reason, note, created_by, created_at, source)
			      VALUES (?, ?, 'used', ?, ?, ?, 'scheduled')`,
			args: [row.id, -per, `Every ${interval} days`, actorId, next(cycle + 1)],
		});
	}
	await db.execute({ sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?', args: [per * due, new Date(nowMs).toISOString(), row.id] });
	await db.execute({ sql: 'UPDATE inventory_items SET consume_cycles_applied = ? WHERE id = ?', args: [total, row.id] });
	return due;
}

export async function signalContext(db: any, row: any, nowMs: number): Promise<SignalContext> {
	const adjustments = (await db.execute({
		sql: 'SELECT change, reason, created_at, source FROM inventory_adjustments WHERE item_id = ? ORDER BY created_at DESC LIMIT 500',
		args: [row.id],
	})).rows as AdjustmentRow[];

	// Size and growth inputs describe diaper stock specifically. Attaching them to
	// every item a member owns would fire "outgrowing this size" at nappy liners
	// and wipes, because they share the same child. Scoped to diaper stock so the
	// signal is null, and reported as unknown, for anything else.
	let diaperSizes: any[] | undefined;
	let growth: any[] | undefined;
	if (row.baby_id !== null && row.baby_id !== undefined && String(row.category) === 'diapers') {
		diaperSizes = (await db.execute({
			sql: 'SELECT size, item_id, active, weight_band_kg, weight_band_max_kg FROM diaper_sizes WHERE baby_id = ?',
			args: [row.baby_id],
		})).rows.map((s: any) => ({
			size: String(s.size),
			itemId: s.item_id === null || s.item_id === undefined ? null : Number(s.item_id),
			active: Number(s.active ?? 1) === 1,
			weightBandMinKg: s.weight_band_kg === null || s.weight_band_kg === undefined ? null : Number(s.weight_band_kg),
			weightBandMaxKg: s.weight_band_max_kg === null || s.weight_band_max_kg === undefined ? null : Number(s.weight_band_max_kg),
		}));
		growth = (await db.execute({
			sql: 'SELECT measurement_date, weight FROM growth WHERE baby_id = ? AND weight IS NOT NULL ORDER BY measurement_date',
			args: [row.baby_id],
		})).rows.map((g: any) => ({ date: String(g.measurement_date), weight: Number(g.weight) }));
	}
	return { item: row, adjustments, nowMs, diaperSizes, growth };
}

export interface RuleEvaluation extends Evaluation {
	/** The rules that were considered, so a caller can clear state for the rest. */
	rules: InventoryRule[];
}

/** Pure: reports what matches now, and writes nothing. */
export async function evaluateAlerts(
	db: any, nowMs: number,
	valuesByItem: Map<number, Map<string, number | null>>,
	namesByItem: Map<number, string>,
): Promise<RuleEvaluation> {
	const all = await loadRulesForFamily(db);
	// A rule scoped to one item, or to a category, only applies to what exists.
	const applicable = all.filter((r) => {
		if (r.itemId !== null) return valuesByItem.has(r.itemId);
		return true;
	});
	const result = evaluateRules({ rules: applicable, valuesByItem, namesByItem, nowMs });
	return { ...result, rules: applicable };
}

export async function collectSignals(
	db: any, rows: any[], nowMs: number, actorId: string | null,
): Promise<{ valuesByItem: Map<number, Map<string, number | null>>; namesByItem: Map<number, string> }> {
	const valuesByItem = new Map<number, Map<string, number | null>>();
	const namesByItem = new Map<number, string>();
	for (const row of rows) {
		await applyScheduledConsumption(db, row, actorId, nowMs);
		const fresh = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [row.id] })).rows[0];
		if (!fresh) continue;
		const values = new Map<string, number | null>();
		for (const def of SIGNALS) values.set(def.name, def.compute(await signalContext(db, fresh as any, nowMs)));
		valuesByItem.set(Number((fresh as any).id), values);
		const item = fresh as any;
		namesByItem.set(Number(item.id), item.variant ? `${item.name} (${item.variant})` : String(item.name));
	}
	return { valuesByItem, namesByItem };
}

// ---------------------------------------------------------------------------
// Who gets told
// ---------------------------------------------------------------------------

export interface Recipient {
	userId: string;
	email: string;
	firstName: string | null;
}

/**
 * Who a rule is addressed to. Only accounts that have confirmed their address are
 * eligible: an unconfirmed address is either a typo or someone else's, and a
 * family alert is not the place to find out which.
 */
export async function resolveRecipients(db: any, rule: InventoryRule): Promise<Recipient[]> {
	const scope = await householdScopeId(db);
	if (scope === null) return [];
	const eligible = (await db.execute({
		sql: `SELECT u.id AS userId, u.email AS email, u.first_name AS firstName
		      FROM users u JOIN user_households uh ON uh.user_id = u.id
		      WHERE uh.household_id = ?
		        AND u.email_verified = 1
		        AND u.email IS NOT NULL AND u.email <> ''
		      ORDER BY u.first_name`,
		args: [scope],
	})).rows as any[];

	const toRecipient = (r: any): Recipient => ({
		userId: String(r.userId), email: String(r.email), firstName: r.firstName ?? null,
	});
	if (rule.audienceKind !== 'users') return eligible.map(toRecipient);
	const wanted = new Set(rule.audienceIds);
	return eligible.filter((r) => wanted.has(String(r.userId))).map(toRecipient);
}

/** The subset of `recipients` who have not been told about this crossing yet. */
export async function dueRecipients(
	db: any, rule: InventoryRule, itemId: number, recipients: Recipient[], nowMs: number,
): Promise<Recipient[]> {
	if (recipients.length === 0) return [];
	const rows = (await db.execute({
		sql: 'SELECT user_id, last_notified_at FROM inventory_rule_recipients WHERE rule_id = ? AND item_id = ?',
		args: [rule.id, itemId],
	})).rows as any[];
	const lastNotified = new Map(rows.map((r: any) => [String(r.user_id), (r.last_notified_at ?? null) as string | null]));

	const repeatMs = rule.repeatDays === null || rule.repeatDays === undefined ? null : rule.repeatDays * MS_PER_DAY;
	return recipients.filter((r) => {
		const at = lastNotified.get(r.userId) ?? null;
		if (at === null) return true;
		// No repeat window means once, until the rule clears.
		if (repeatMs === null) return false;
		return nowMs - new Date(at).getTime() >= repeatMs;
	});
}

export async function recordNotified(
	db: any, ruleId: number, itemId: number, userIds: string[], nowMs: number,
): Promise<void> {
	const at = new Date(nowMs).toISOString();
	for (const userId of userIds) {
		await db.execute({
			sql: `INSERT INTO inventory_rule_recipients (rule_id, item_id, user_id, last_notified_at)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(rule_id, item_id, user_id) DO UPDATE SET last_notified_at = excluded.last_notified_at`,
			args: [ruleId, itemId, userId, at],
		});
	}
}

/**
 * Forget notification state for rules and items that are no longer firing, so the
 * next crossing is a first crossing again.
 */
export async function clearStaleNotifications(
	db: any, ruleIds: number[], firing: Set<string>,
): Promise<number> {
	let cleared = 0;
	for (const ruleId of ruleIds) {
		const rows = (await db.execute({
			sql: 'SELECT item_id FROM inventory_rule_recipients WHERE rule_id = ?',
			args: [ruleId],
		})).rows as any[];
		for (const r of rows) {
			const itemId = Number(r.item_id);
			if (firing.has(`${ruleId}:${itemId}`)) continue;
			await db.execute({ sql: 'DELETE FROM inventory_rule_recipients WHERE rule_id = ? AND item_id = ?', args: [ruleId, itemId] });
			cleared += 1;
		}
	}
	return cleared;
}
