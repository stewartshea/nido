// api/src/inventory-consume.ts
//
// One place where a logged event becomes stock consumed.
//
// The diaper log used to inline the ledger-and-update dance, and a second copy
// lived behind POST /inventory/consume. Two copies is why no other activity
// could consume stock: wiring a new one meant copying the block again. Then
// the rule lived on the item, which capped every item at one rule and matched
// on a single scalar option — enough for "1 wipe per change", not for "a
// routine bath" or "any member's bottle feeds".
//
// So a rule is now a row of its own (inventory_consumption_rules) with a
// condition document against the activity registry, and every route emits
// through emitActivity instead of calling a helper shaped for one table. The
// arithmetic — carry, floor(carry / N), ledger-on-whole-use — is unchanged;
// only what it matches against generalized. A conformance test posts a record
// through every consumable registry entry's route, so "this activity bills
// stock" cannot silently stop being true.

import { consumableSources, type ConsumptionCondition } from './reminder-conditions';

export type { ConsumptionCondition };

export type RuleMatch = 'all' | 'any';

export interface ActivityEmit {
	/** The registry table the record landed in, e.g. 'feedings'. */
	source: string;
	/** The record's id — the idempotency key together with the table. */
	refId: number;
	subjectId: number;
	/** Units this event represents. One logged record is one unit by default. */
	units?: number;
	/** Attribute values read off the record, keyed by the registry's attribute keys. */
	attrs?: Record<string, string | null>;
	createdBy?: string | null;
}

export function parseRuleMatch(raw: unknown): RuleMatch {
	return raw === 'any' ? 'any' : 'all';
}

/** A stored rule's condition document, or [] for "any event of the activity". */
export function parseConsumptionConditions(raw: unknown): ConsumptionCondition[] {
	if (typeof raw !== 'string' || !raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((c: any) => c && typeof c.attr === 'string' && c.attr)
			.map((c: any) => ({
				attr: String(c.attr),
				values: Array.isArray(c.values) && c.values.length ? c.values.map(String) : undefined,
			}));
	} catch {
		return [];
	}
}

/**
 * Whether one logged event satisfies a rule's conditions.
 *
 * A filter on a single record, not an inactivity test across time (that stays
 * reminders' job). With 'all' every condition must hold — "a routine bath",
 * kind and category on the same milestone. A condition with no values means
 * "this attribute is set at all"; an attribute the record does not carry
 * never matches, so a growth measurement cannot satisfy a location rule.
 */
export function matchesConditions(
	match: RuleMatch,
	conditions: ConsumptionCondition[],
	attrs: Record<string, string | null>,
): boolean {
	if (conditions.length === 0) return true;
	const holds = (condition: ConsumptionCondition) => {
		const value = attrs[condition.attr];
		if (value === null || value === undefined || value === '') return false;
		return !condition.values?.length || condition.values.includes(String(value));
	};
	return match === 'all' ? conditions.every(holds) : conditions.some(holds);
}

/**
 * Bill every rule this event satisfies, and return the item names applied.
 *
 * A rule matches when it is active, its source_table is the event's table,
 * its subject is either the event's member or NULL (household stock follows
 * any member's events), and its conditions hold against the record's
 * attributes.
 *
 * The rule's own fields decide what the event costs: `amount_per_use` (X, 1
 * when unset) is subtracted for every `units_per_use` (N, 1 when unset)
 * units. Fractional progress accrues in the rule's `consume_carry`, so a
 * 1-per-4 rule bills one whole unit on the fourth event and writes nothing
 * for the first three — the ledger records whole uses only, while the events
 * gate keeps a retried event from adding its partial progress twice.
 *
 * A ledger row for this exact (rule, event) — or one with no rule, written
 * before rules existed — is also read as "already applied", so rows the
 * migration grandfathered are never counted again.
 */
export async function emitActivity(db: any, emit: ActivityEmit): Promise<string[]> {
	const units = Number(emit.units ?? 1);
	if (!Number.isFinite(units) || units <= 0) return [];
	// An undeclared table bills nothing, by design: consumableSources is the
	// same list the picker offers, and a conformance test keeps it true.
	const activity = consumableSources().find((a) => a.table === emit.source);
	if (!activity) return [];

	const rules = (await db.execute({
		sql: `SELECT * FROM inventory_consumption_rules
		      WHERE active = 1 AND source_table = ? AND (subject_id IS NULL OR subject_id = ?)`,
		args: [emit.source, emit.subjectId],
	})).rows as any[];

	const applied: string[] = [];
	for (const rule of rules) {
		const item = (await db.execute({
			sql: 'SELECT name FROM inventory_items WHERE id = ? AND active = 1',
			args: [rule.item_id],
		})).rows[0];
		if (!item) continue;

		if (!matchesConditions(parseRuleMatch(rule.match), parseConsumptionConditions(rule.conditions), emit.attrs ?? {})) {
			continue;
		}

		const legacy = await db.execute({
			sql: `SELECT 1 FROM inventory_adjustments
			      WHERE item_id = ? AND ref_table = ? AND ref_id = ? AND (rule_id IS NULL OR rule_id = ?)`,
			args: [rule.item_id, emit.source, emit.refId, rule.id],
		});
		if (legacy.rows.length) continue;

		try {
			await db.execute({
				sql: 'INSERT INTO inventory_consumption_events (rule_id, ref_table, ref_id, units, created_at) VALUES (?, ?, ?, ?, ?)',
				args: [rule.id, emit.source, emit.refId, units, new Date().toISOString()],
			});
		} catch {
			// The unique gate: this event was already applied to this rule.
			// Counting it twice would understate stock.
			continue;
		}

		const nRaw = Number(rule.units_per_use ?? 1);
		const n = Number.isFinite(nRaw) && nRaw >= 1 ? nRaw : 1;
		const per = Number(rule.amount_per_use ?? 1);
		const carry = Number(rule.consume_carry ?? 0) + units;
		const whole = Math.floor(carry / n);
		const nextCarry = carry - whole * n;
		const now = new Date().toISOString();

		if (whole > 0) {
			const change = -(whole * per);
			await db.execute({
				sql: `INSERT INTO inventory_adjustments (item_id, rule_id, change, reason, ref_table, ref_id, created_by, created_at, source)
				      VALUES (?, ?, ?, 'used', ?, ?, ?, ?, 'event')`,
				args: [rule.item_id, rule.id, change, emit.source, emit.refId, emit.createdBy ?? null, now],
			});
			await db.execute({
				sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?',
				args: [whole * per, now, rule.item_id],
			});
		}
		await db.execute({
			sql: 'UPDATE inventory_consumption_rules SET consume_carry = ?, updated_at = ? WHERE id = ?',
			args: [nextCarry, now, rule.id],
		});
		applied.push(String(item.name));
	}
	return [...new Set(applied)];
}
