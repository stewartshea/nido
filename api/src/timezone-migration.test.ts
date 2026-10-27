// src/timezone-migration.test.ts
//
// The upgrade path, which is the part of a guarded migration that plain SQL
// would break. A family database that already carries the column at an earlier
// user_version is a real state (an interrupted upgrade, a rewound version),
// and a plain ADD COLUMN there throws and blocks the whole family from opening.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './namespaces';
import { FAMILY_MIGRATIONS } from './migrations';
import type { RawDatabase } from './db-core';

async function postJson(path: string, body: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

let familyId = '';

beforeAll(async () => {
	const reg = await postJson('/api/v1/auth/register', {
		email: 'tz-migration@example.com', password: 'StrongP4ss!', firstName: 'Tz', lastName: 'Migration',
	});
	expect(reg.status).toBe(200);
	familyId = (jwt.decode(reg.body.token) as any).familyId as string;
});

describe('the family-timezone and send-hour migrations', () => {
	it('are registered at versions no other migration already holds', () => {
		// Two migrations sharing a version means the second is silently skipped
		// on any database that already ran the first — the trap that the feed
		// grouping migration was renumbered to avoid.
		const versions = FAMILY_MIGRATIONS.map((m) => m.version);
		expect(new Set(versions).size).toBe(versions.length);
		expect(versions).toContain(34);
		expect(versions).toContain(35);
	});

	it('adds every column on a fresh database', async () => {
		const db = getFamilyClient(familyId);
		const cols = (await db.execute({ sql: 'PRAGMA table_info(family_settings)' })).rows.map((r: any) => r.name);
		for (const name of ['timezone', 'digest_send_hour', 'appointment_send_hour']) {
			expect(cols).toContain(name);
		}
	});

	it('re-runs harmlessly when the columns are already there', () => {
		// The exact state the guard exists for. Calling the migration body again
		// must be a no-op rather than a "duplicate column name" throw.
		const db = getFamilyClient(familyId);
		const raw = (db as any).raw as RawDatabase;

		for (const version of [34, 35]) {
			const migration = FAMILY_MIGRATIONS.find((m) => m.version === version)!;
			expect(() => migration.run!(raw)).not.toThrow();
		}

		// And it did not duplicate a column on the way through. A second
		// `timezone` or `digest_send_hour` would make every write ambiguous.
		const cols = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
		for (const name of ['timezone', 'digest_send_hour', 'appointment_send_hour']) {
			expect(cols.filter((c) => c.name === name)).toHaveLength(1);
		}
	});

	it('leaves an unset send hour as NULL, not 0', () => {
		// The distinction the whole "upgrade changes nobody's inbox" claim rests
		// on: midnight (0) is a legitimate chosen hour, so "unset" must be a
		// different value. A NOT NULL DEFAULT 0 would silently move every
		// existing family's alerts to midnight on the family's clock.
		const db = getFamilyClient(familyId);
		const raw = (db as any).raw as RawDatabase;
		const cols = raw.pragma('table_info(family_settings)') as Array<{ name: string; notnull: number; dflt_value: unknown }>;
		for (const name of ['digest_send_hour', 'appointment_send_hour']) {
			const col = cols.find((c) => c.name === name)!;
			expect(col.notnull).toBe(0);
			expect(col.dflt_value).toBeNull();
		}
	});
});
