// src/events-migration.test.ts
//
// Migration 38 is the riskiest move in Phase 1b: it splits the milestone
// catch-all at the now boundary, preserves every id, re-points attachments,
// and folds consumption rules from "table + smuggled kind" into categories.
// A fresh database exercises none of that — its milestones table is empty —
// so this file seeds a database at version 37 the way real data looked, runs
// the migration, and asserts the shape the design doc (§6) promises.
import { describe, it, expect } from 'vitest';
import { openDb, runMigrations, type SqliteFacade } from './db-core';
import { FAMILY_MIGRATIONS } from './migrations';

/** A family database migrated only up to the pre-events version, with a subject to hang rows off. */
function dbAt37(): SqliteFacade {
	const db = openDb(':memory:');
	runMigrations(db.raw, FAMILY_MIGRATIONS.filter((m) => m.version <= 37));
	db.raw.prepare(`INSERT INTO households (name, created_at, updated_at) VALUES ('Test home', '2026-01-01', '2026-01-01')`).run();
	db.raw.prepare(`INSERT INTO subjects (household_id, name, type, created_at, updated_at) VALUES (1, 'Test child', 'child', '2026-01-01', '2026-01-01')`).run();
	return db;
}

function count(db: SqliteFacade, table: string, where = '', args: unknown[] = []): number {
	const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...(args as never[])) as { n: number };
	return Number(row.n);
}

describe('migration 38: events and plans', () => {
	it('moves past rows to events and future rows to plans, preserving every id', () => {
		const db = dbAt37();
		const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
		const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

		const insert = db.raw.prepare(
			`INSERT INTO milestones (subject_id, title, description, achieved_date, kind, category, created_by, created_at)
			 VALUES (1, ?, NULL, ?, ?, ?, 'user-1', ?)`,
		);
		insert.run('Past vitamin', past, 'vitamins', 'dose', past);
		insert.run('Past milestone', past, 'milestones', 'social', past);
		insert.run('Past medical', past, 'medical', 'wellness', past);
		insert.run('Future checkup', future, 'appointments', 'checkup', future);
		insert.run('Future routine', future, 'routines', 'bath', future);
		insert.run('Past routine', past, 'routines', 'bath', past);

		runMigrations(db.raw, FAMILY_MIGRATIONS.filter((m) => m.version <= 38));

		// Past → events, one row per kind, id preserved, option value under
		// the kind's own data key.
		expect(count(db, 'events')).toBe(4);
		const vitamin = db.raw.prepare(`SELECT * FROM events WHERE category = 'vitamins'`).get() as any;
		expect(vitamin.title).toBe('Past vitamin');
		expect(vitamin.occurred_at).toBe(past);
		expect(JSON.parse(vitamin.data)).toEqual({ type: 'dose' });
		expect(db.raw.prepare('SELECT id FROM events WHERE title = ?').get('Past vitamin')).toMatchObject({ id: 1 });
		const social = db.raw.prepare(`SELECT * FROM events WHERE category = 'milestones'`).get() as any;
		expect(JSON.parse(social.data)).toEqual({ category: 'social' });
		const wellness = db.raw.prepare(`SELECT * FROM events WHERE category = 'medical'`).get() as any;
		// medical's option key is visitType, not type — the mapping is per kind.
		expect(JSON.parse(wellness.data)).toEqual({ visitType: 'wellness' });

		// Future → plans as bookings, id preserved.
		expect(count(db, 'plans')).toBe(2);
		const routinePlan = db.raw.prepare(`SELECT * FROM plans WHERE category = 'routines'`).get() as any;
		expect(routinePlan.title).toBe('Future routine');
		const plan = db.raw.prepare(`SELECT * FROM plans WHERE category = 'appointments'`).get() as any;
		expect(plan.title).toBe('Future checkup');
		expect(plan.scheduled_at).toBe(future);
		expect(plan.status).toBe('planned');
		expect(JSON.parse(plan.data)).toEqual({ type: 'checkup' });

		// The old rows stay put, unread, until Phase 1c drops the table.
		expect(count(db, 'milestones')).toBe(6);
	});

	it('re-points attachments to the table that owns the row now', () => {
		const db = dbAt37();
		const past = new Date(Date.now() - 3600 * 1000).toISOString();
		const future = new Date(Date.now() + 3600 * 1000).toISOString();
		const insert = db.raw.prepare(
			`INSERT INTO milestones (subject_id, title, achieved_date, kind, created_at) VALUES (1, ?, ?, 'appointments', ?)`,
		);
		insert.run('Past visit', past, past);
		insert.run('Future visit', future, future);
		db.raw.prepare(
			`INSERT INTO attachments (subject_id, ref_type, ref_id, blob_id, storage_key, filename, content_type, size, created_at)
			 VALUES (1, 'milestone', ?, 'b', 'k', 'f.pdf', 'application/pdf', 4, ?)`,
		).run(1, past);
		db.raw.prepare(
			`INSERT INTO attachments (subject_id, ref_type, ref_id, blob_id, storage_key, filename, content_type, size, created_at)
			 VALUES (1, 'milestone', ?, 'b2', 'k2', 'f.pdf', 'application/pdf', 4, ?)`,
		).run(2, future);

		runMigrations(db.raw, FAMILY_MIGRATIONS.filter((m) => m.version <= 38));

		const pastRef = db.raw.prepare(`SELECT ref_type FROM attachments WHERE ref_id = 1`).get() as any;
		expect(pastRef.ref_type).toBe('event');
		const futureRef = db.raw.prepare(`SELECT ref_type FROM attachments WHERE ref_id = 2`).get() as any;
		expect(futureRef.ref_type).toBe('plan');
	});

	it('folds a smuggled kind into the category and renames its option condition', () => {
		const db = dbAt37();
		db.raw.prepare(
			`INSERT INTO inventory_items (subject_id, name, category, quantity, unit, created_at, updated_at)
			 VALUES (1, 'Vitamin D bottle', 'vitamins', 90, 'count', '2026-01-01', '2026-01-01')`,
		).run();
		// The Phase-2 shape: source_table 'milestones', kind inside conditions,
		// option under the old `category` attr.
		db.raw.prepare(
			`INSERT INTO inventory_consumption_rules
			   (item_id, source_table, subject_id, match, conditions, units_per_use, amount_per_use, consume_carry, active, created_at, updated_at)
			 VALUES (1, 'milestones', NULL, 'all', ?, 1, 1, 0, 1, '2026-01-01', '2026-01-01')`,
		).run(JSON.stringify([
			{ attr: 'kind', values: ['vitamins'] },
			{ attr: 'category', values: ['dose'] },
		]));
		// A typed-table rule maps to the category that writes the table.
		db.raw.prepare(
			`INSERT INTO inventory_consumption_rules
			   (item_id, source_table, subject_id, match, conditions, units_per_use, amount_per_use, consume_carry, active, created_at, updated_at)
			 VALUES (1, 'feedings', NULL, 'all', ?, 4, 1, 0, 1, '2026-01-01', '2026-01-01')`,
		).run(JSON.stringify([{ attr: 'type', values: ['bottle'] }]));

		runMigrations(db.raw, FAMILY_MIGRATIONS.filter((m) => m.version <= 38));

		const vitaminRule = db.raw.prepare(`SELECT * FROM inventory_consumption_rules WHERE source_category = 'vitamins'`).get() as any;
		expect(vitaminRule).toBeTruthy();
		// The kind condition is gone; the option condition names the data key.
		expect(JSON.parse(vitaminRule.conditions)).toEqual([{ attr: 'type', values: ['dose'] }]);

		const feedRule = db.raw.prepare(`SELECT * FROM inventory_consumption_rules WHERE source_category = 'feeds'`).get() as any;
		expect(feedRule).toBeTruthy();
		expect(JSON.parse(feedRule.conditions)).toEqual([{ attr: 'type', values: ['bottle'] }]);

		// Nothing is left unmigrated.
		expect(
			count(db, 'inventory_consumption_rules', 'WHERE source_category IS NULL'),
		).toBe(0);
	});

	it('is idempotent: a database already migrated opens unchanged', () => {
		const db = openDb(':memory:');
		runMigrations(db.raw, FAMILY_MIGRATIONS);
		// Re-running the whole chain (a future migration running after 41 must
		// not trip over its guards) is a no-op.
		runMigrations(db.raw, FAMILY_MIGRATIONS);
		expect(db.raw.pragma('user_version')).toMatchObject([{ user_version: 41 }]);
	});
});
