// src/formula-inventory.test.ts
//
// Issue #81: the bottle feed's formula comes from inventory, not the retail
// catalog. A formula can is an inventory item (remaining oz on `quantity`),
// the feed names the container (`formula_item_id`), and the container's
// direct-amount rule bills the oz the bottle actually held — one ledger row
// per feed, fractional amounts intact, one can per rule.
//
// `amountOz` rules are the funnel's newest arrival alongside whole-use
// ratios: `units_per_use`/`amount_per_use` keep meaning "X per N", while
// `amount_attr` means "subtract what the event says it used".
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './namespaces';
import { emitActivity } from './inventory-consume';
import { migrateToFormulaInventoryItems } from './migrations';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const now = () => new Date().toISOString();

describe('formula from inventory (issue #81)', () => {
	let token = '';
	let familyId = '';
	let memberId = 0;
	let db: any;

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'formula-inventory@example.com', password: 'StrongP4ss!', firstName: 'Formula', lastName: 'Inventory',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
		db = getFamilyClient(familyId);
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Formula Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
	});

	/** One formula item with the rule the picker's "add" flow would create. */
	async function createFormulaItem(name = 'Enfamil NeuroPro', quantity = 40.6, packSize = 40.6) {
		const res = await call('POST', token, '/api/v1/inventory', {
			name,
			category: 'formula',
			unit: 'oz',
			quantity,
			packSize,
			consumptionRule: {
				sourceCategory: 'feeds',
				match: 'all',
				conditions: [{ attr: 'type', values: ['bottle', 'formula'] }],
				amountAttr: 'amountOz',
			},
		});
		expect(res.status).toBe(201);
		return res.body.item as Record<string, any>;
	}

	it('creates a formula item whose direct-amount rule reads back through the API', async () => {
		const item = await createFormulaItem();
		expect(item.category).toBe('formula');
		expect(item.unit).toBe('oz');
		expect(item.consumptionRule?.amountAttr).toBe('amountOz');
		expect(item.consumptionRule?.sourceCategory).toBe('feeds');
	});

	it('bill the bottle the oz it held: fractional, one ledger row, one decrement', async () => {
		const item = await createFormulaItem('Similac 360 Total Care');
		const started = item.quantity;
		const res = await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: now(), type: 'formula', formulaItemId: item.id, amount: 4.5,
		});
		expect(res.status).toBe(200);
		const after = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === item.id);
		expect(after.quantity).toBeCloseTo(started - 4.5, 5);
		// The ledger speaks in the item's unit, one row per feed.
		const ledger = await db.execute({
			sql: 'SELECT change, reason, source FROM inventory_adjustments WHERE item_id = ? AND ref_table = ? AND ref_id = ?',
			args: [item.id, 'feedings', res.body.feeding.id],
		});
		expect(ledger.rows).toHaveLength(1);
		expect(Number(ledger.rows[0].change)).toBe(-4.5);
		expect(ledger.rows[0].reason).toBe('used');

		// The gate is the idempotency: replaying the same event bills nothing,
		// however many times the record lands.
		await emitActivity(db, {
			category: 'feeds', refTable: 'feedings', refId: res.body.feeding.id, subjectId: 101,
			billedItem: item.id,
			attrs: { type: 'formula', amountOz: '4.5' },
		});
		const twice = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === item.id);
		expect(twice.quantity).toBeCloseTo(started - 4.5, 5);
	});

	it('does not bill a feed that drew from a different container, or names none', async () => {
		const canA = await createFormulaItem('Can A');
		await createFormulaItem('Can B');
		const before = (await call('GET', token, '/api/v1/inventory')).body.items as any[];
		const aBefore = before.find((i: any) => i.id === canA.id).quantity;

		// Can B's feed: Can A must not move.
		await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: now(), type: 'formula', amount: 3, amountUnit: 'oz',
			formulaItemId: before.find((i: any) => i.name === 'Can B').id,
		});
		// And a breastmilk bottle carries no container at all.
		await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: now(), type: 'bottle', amount: 4, amountUnit: 'oz',
		});
		const after = (await call('GET', token, '/api/v1/inventory')).body.items as any[];
		expect(after.find((i: any) => i.id === canA.id).quantity).toBeCloseTo(aBefore, 5);
	});

	it('normalizes a millilitre feed to the oz the stock is kept in', async () => {
		const item = await createFormulaItem('Can ML');
		const started = item.quantity;
		await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: now(), type: 'formula', formulaItemId: item.id, amount: 100, amountUnit: 'ml',
		});
		const after = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === item.id);
		// 100 ml is 3.38 oz (2 dp): the ledger carries what actually left the can.
		expect(started - after.quantity).toBeGreaterThan(3.35);
		expect(started - after.quantity).toBeLessThan(3.4);
	});

	it('refuses an amount attribute that is not a number on the activity', async () => {
		const res = await call('POST', token, '/api/v1/inventory', {
			name: 'Bad rule', category: 'formula', unit: 'oz',
			consumptionRule: { sourceCategory: 'feeds', amountAttr: 'side' },
		});
		expect(res.status).toBe(400);
	});

	it('leaves quantities whole be they whole-use rules or not', async () => {
		// A plain ratio rule (no amount_attr) still floors like Phase 2 always did.
		const res = await call('POST', token, '/api/v1/inventory', {
			name: 'Dishwasher tablets', category: 'cleaning', quantity: 20,
			consumptionRule: {
				sourceCategory: 'feeds', match: 'all',
				conditions: [{ attr: 'type', values: ['bottle', 'formula'] }],
				unitsPerUse: 4, amountPerUse: 1,
			},
		});
		const item = res.body.item;
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: now(), type: 'bottle', amount: 4 });
		const after = (await call('GET', token, '/api/v1/inventory')).body.items.find((i: any) => i.id === item.id);
		// 1-of-4 feeds so far: no subtraction yet, no fractional ledger row.
		expect(after.quantity).toBe(20);
	});
});

describe('migration 48: referenced formulas become inventory items', () => {
	it('backfills a referenced formula into a can, a rule, and re-points its feedings', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'formula-backfill@example.com', password: 'StrongP4ss!', firstName: 'Back', lastName: 'Fill',
		});
		const fid = (jwt.decode(reg.body.token) as any).familyId as string;
		const fdb = getFamilyClient(fid);
		const member = await call('POST', reg.body.token, `/api/v1/families/${fid}/members`, {
			name: 'Backfill Baby', birthDate: '2026-02-01T00:00:00.000Z', gender: 'female',
		});
		const subjectId = Number((await fdb.execute({ sql: 'SELECT id FROM subjects LIMIT 1' })).rows[0].id);

		// A family tracking formula before inventories linked: a catalog row
		// (even a seeded one a parent kept using) and feeds referencing it.
		const formula = await fdb.execute({
			sql: `INSERT INTO formulas (family_id, name, brand, formula_type, created_at) VALUES (1, 'Gentlease', 'Enfamil', 'gentle', ?)`,
			args: [now()],
		});
		const formulaId = Number(formula.lastInsertRowid);
		await fdb.execute({
			sql: `INSERT INTO feedings (subject_id, start_time, amount, type, formula_id, created_at)
			      VALUES (?, ?, 4, 'formula', ?, ?)`,
			args: [subjectId, now(), formulaId, now()],
		});

		migrateToFormulaInventoryItems(fdb.raw, 'subject_id');

		const item = await fdb.execute({
			sql: `SELECT i.id, i.name, i.category, i.variant, i.unit, r.conditions, r.amount_attr
			      FROM inventory_items i JOIN inventory_consumption_rules r ON r.item_id = i.id
			      WHERE i.category = 'formula'`,
		});
		expect(item.rows).toHaveLength(1);
		expect(item.rows[0].name).toBe('Enfamil Gentlease');
		expect(item.rows[0].variant).toBe('gentle');
		expect(item.rows[0].unit).toBe('oz');
		expect(item.rows[0].amount_attr).toBe('amountOz');
		const conditions = JSON.parse(String(item.rows[0].conditions));
		expect(conditions).toEqual([{ attr: 'type', values: ['bottle', 'formula'] }]);

		const alias = await fdb.execute({ sql: 'SELECT inventory_item_id FROM formulas WHERE id = ?', args: [formulaId] });
		expect(Number(alias.rows[0].inventory_item_id)).toBe(item.rows[0].id);
		const feed = await fdb.execute({ sql: 'SELECT formula_item_id FROM feedings WHERE formula_id = ?', args: [formulaId] });
		expect(Number(feed.rows[0].formula_item_id)).toBe(item.rows[0].id);

		// Idempotent: a re-run never duplicates the can or the rule.
		migrateToFormulaInventoryItems(fdb.raw, 'subject_id');
		const again = await fdb.execute({ sql: `SELECT COUNT(*) AS n FROM inventory_items WHERE category = 'formula'` });
		expect(Number(again.rows[0].n)).toBe(1);
	});
});
