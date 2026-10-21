// api/src/inventory-consume.ts
//
// One place where a logged event becomes stock consumed.
//
// The diaper log used to inline the ledger-and-update dance, and
// POST /inventory/consume carried a second copy of it. Two copies is why no
// other activity could consume stock: wiring a new one meant copying the block
// again, and the inventory form only ever offered "diapers". Everything that
// bills inventory from a logged event now calls applyEventConsumption, so
// linking an item to an activity is data — activity, option filter, and a
// ratio ("1 tablet for every 4 bottles") — rather than a new call site.

import { SOURCES } from './reminder-conditions';

/**
 * The logged activities an item can be linked to, today.
 *
 * Deliberately an honest inventory rather than a wish list: a table appears
 * here only once its route calls applyEventConsumption, so the picker in the
 * inventory form never offers an activity that would silently do nothing.
 * Landing a new one means wiring its POST route and adding the table here.
 * The labels and option values are reused from the reminders registry rather
 * than restated, so an activity is named the same way in both places.
 */
const WIRED_TABLES = ['diapers', 'feedings'];

export interface ConsumableActivity {
	/** What the catalog calls it, e.g. 'feeds'. */
	id: string;
	/** What event_category stores and what the route bills as ref_table, e.g. 'feedings'. */
	table: string;
	label: string;
	/** The column carrying the option a link may narrow to, e.g. a feed's type. */
	optionColumn: string | null;
	/** Values the option may take; empty when the activity has no option. */
	options: string[];
}

export function consumableActivities(): ConsumableActivity[] {
	const seen = new Set<string>();
	const out: ConsumableActivity[] = [];
	// SOURCES holds several views of one table ('feeds', 'pumping' and
	// 'breast_or_pump' all read feedings). Inventory links to the table, so
	// the first entry per table — the general one — is the activity.
	for (const [id, src] of Object.entries(SOURCES)) {
		if (!WIRED_TABLES.includes(src.table) || seen.has(src.table)) continue;
		seen.add(src.table);
		out.push({
			id,
			table: src.table,
			label: src.label,
			optionColumn: src.optionColumn ?? null,
			options: [...(src.options ?? [])],
		});
	}
	return out;
}

export interface ConsumeEventInput {
	subjectId: number;
	/** The table the event lives in — what event_category stores, e.g. 'feedings'. */
	refTable: string;
	/** The event's id, the idempotency key together with refTable and the item. */
	refId: number;
	/** The option the event carried (a feed's type), when a link is narrowed to one. */
	option?: string | null;
	/** Units this event represents. One logged event is one unit by default. */
	units?: number;
	createdBy?: string | null;
}

/**
 * Bill every linked item for one logged event, and return the names applied.
 *
 * An item is linked when it is active, its event_category matches the event's
 * table, and its event_option is either unset (any option counts) or equal to
 * the option the event carried.
 *
 * The item's rule decides what the event costs: `decrement_per_event` (X, 1
 * when unset) is subtracted for every `units_per_decrement` (N, 1 when unset)
 * units of activity. Fractional progress accrues in `consume_carry`, so a
 * 1-per-4 rule bills one whole unit on the fourth event and writes nothing
 * for the first three — the ledger records whole uses only, while the events
 * gate keeps a retried event from adding its partial progress twice.
 *
 * A ledger row for this exact (item, event) is also read as "already applied":
 * the diaper log wrote rows that way before the events gate existed, and
 * counting those events again would understate stock.
 */
export async function applyEventConsumption(db: any, input: ConsumeEventInput): Promise<string[]> {
	const units = Number(input.units ?? 1);
	if (!Number.isFinite(units) || units <= 0) return [];
	const option = input.option ?? null;

	const linked = (await db.execute({
		sql: `SELECT * FROM inventory_items
		      WHERE active = 1 AND event_category = ? AND subject_id = ?
		        AND (event_option IS NULL OR event_option = ?)`,
		args: [input.refTable, input.subjectId, option],
	})).rows as any[];

	const applied: string[] = [];
	for (const item of linked) {
		const legacy = await db.execute({
			sql: 'SELECT 1 FROM inventory_adjustments WHERE item_id = ? AND ref_table = ? AND ref_id = ?',
			args: [item.id, input.refTable, input.refId],
		});
		if (legacy.rows.length) continue;

		try {
			await db.execute({
				sql: 'INSERT INTO inventory_consumption_events (item_id, ref_table, ref_id, units, created_at) VALUES (?, ?, ?, ?, ?)',
				args: [item.id, input.refTable, input.refId, units, new Date().toISOString()],
			});
		} catch {
			// The unique gate: this event was already applied. Counting it
			// twice would understate stock.
			continue;
		}

		const per = item.decrement_per_event === null || item.decrement_per_event === undefined ? 1 : Number(item.decrement_per_event);
		const n = item.units_per_decrement === null || item.units_per_decrement === undefined || Number(item.units_per_decrement) < 1
			? 1
			: Number(item.units_per_decrement);
		const carry = (item.consume_carry === null || item.consume_carry === undefined ? 0 : Number(item.consume_carry)) + units;
		const whole = Math.floor(carry / n);
		const nextCarry = carry - whole * n;
		const now = new Date().toISOString();

		if (whole > 0) {
			const change = -(whole * per);
			await db.execute({
				sql: `INSERT INTO inventory_adjustments (item_id, change, reason, ref_table, ref_id, created_by, created_at, source)
				      VALUES (?, ?, 'used', ?, ?, ?, ?, 'event')`,
				args: [item.id, change, input.refTable, input.refId, input.createdBy ?? null, now],
			});
			await db.execute({
				sql: 'UPDATE inventory_items SET quantity = MAX(0, quantity - ?), consume_carry = ?, updated_at = ? WHERE id = ?',
				args: [whole * per, nextCarry, now, item.id],
			});
		} else {
			await db.execute({
				sql: 'UPDATE inventory_items SET consume_carry = ?, updated_at = ? WHERE id = ?',
				args: [nextCarry, now, item.id],
			});
		}
		applied.push(String(item.name));
	}
	return applied;
}
