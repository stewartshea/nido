// src/inventory-migration.test.ts
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './namespaces';

async function postJson(path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('inventory migration', () => {
	it('applies every version in order, including the milestone kind added before it', async () => {
		const reg = await postJson('/api/v1/auth/register', {
			email: 'inventory-migration@example.com',
			password: 'StrongP4ss!',
			firstName: 'Migr',
			lastName: 'Ation',
		});
		expect(reg.status).toBe(200);
		const familyId = (jwt.decode(reg.body.token) as any).familyId as string;
		const db = getFamilyClient(familyId);

		const version = (await db.execute({ sql: 'PRAGMA user_version' })).rows[0];
		expect(Number((version as any).user_version)).toBeGreaterThanOrEqual(11);

		// v10 sits between the older and newer migrations. If a later version is
		// ever listed first, the loop skips the earlier one and this column goes
		// missing on a fresh database.
		const milestoneCols = (await db.execute({ sql: 'PRAGMA table_info(milestones)' })).rows
			.map((r: any) => r.name);
		expect(milestoneCols).toContain('kind');

		for (const table of ['inventory_items', 'inventory_adjustments', 'diaper_sizes', 'inventory_consumption_rules', 'inventory_consumption_events']) {
			const found = await db.execute({ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, args: [table] });
			expect(found.rows.length, `${table} missing`).toBe(1);
		}
	});

	it('refuses to log the same event twice against one rule, but lets a second rule bill it', async () => {
		const reg = await postJson('/api/v1/auth/register', {
			email: 'inventory-ledger@example.com',
			password: 'StrongP4ss!',
			firstName: 'Ledger',
			lastName: 'Test',
		});
		const familyId = (jwt.decode(reg.body.token) as any).familyId as string;
		const db = getFamilyClient(familyId);
		const item = await db.execute({
			sql: `INSERT INTO inventory_items (name, category, quantity) VALUES ('Diapers', 'diapers', 10)`,
		});
		const itemId = Number(item.lastInsertRowid);
		// The ledger's uniqueness is rule-scoped since the rules table (v35):
		// one item may carry several rules, and each bills its own ledger row
		// for the same logged event. The idempotency gate owns "this rule has
		// already seen this event".
		const rule = await db.execute({
			sql: `INSERT INTO inventory_consumption_rules (item_id, source_table) VALUES (?, 'diapers')`,
			args: [itemId],
		});
		const ruleId = Number(rule.lastInsertRowid);
		const row = (ruleId: number) => ({
			sql: `INSERT INTO inventory_adjustments (item_id, rule_id, change, reason, ref_table, ref_id) VALUES (?, ?, -1, 'used', 'diapers', 42)`,
			args: [itemId, ruleId],
		});
		await db.execute(row(ruleId));
		await expect(db.execute(row(ruleId))).rejects.toThrow();

		const second = await db.execute({
			sql: `INSERT INTO inventory_consumption_rules (item_id, source_table) VALUES (?, 'diapers')`,
			args: [itemId],
		});
		await expect(db.execute(row(Number(second.lastInsertRowid)))).resolves.toBeDefined();
	});
});
