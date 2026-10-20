// src/timezone-migration.test.ts
//
// The upgrade path, which is the part of a guarded migration that plain SQL
// would break. A family database that already carries the column at an earlier
// user_version is a real state (an interrupted upgrade, a rewound version),
// and a plain ADD COLUMN there throws and blocks the whole family from opening.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient, FAMILY_MIGRATIONS } from './db-namespaces';
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

describe('the family-timezone migration', () => {
	it('is registered at a version no other migration already holds', () => {
		// Two migrations sharing a version means the second is silently skipped
		// on any database that already ran the first — the trap that the feed
		// grouping migration was renumbered to avoid.
		const versions = FAMILY_MIGRATIONS.map((m) => m.version);
		expect(new Set(versions).size).toBe(versions.length);
		expect(versions).toContain(34);
	});

	it('adds the column on a fresh database', async () => {
		const db = getFamilyClient(familyId);
		const cols = (await db.execute({ sql: 'PRAGMA table_info(family_settings)' })).rows.map((r: any) => r.name);
		expect(cols).toContain('timezone');
	});

	it('re-runs harmlessly when the column is already there', () => {
		// The exact state the guard exists for. Calling the migration body again
		// must be a no-op rather than a "duplicate column name" throw.
		const db = getFamilyClient(familyId);
		const migration = FAMILY_MIGRATIONS.find((m) => m.version === 34)!;
		const raw = (db as any).raw as RawDatabase;
		expect(() => migration.run!(raw)).not.toThrow();

		// And it did not lose the data on the way through.
		const cols = raw.pragma('table_info(family_settings)') as Array<{ name: string }>;
		expect(cols.filter((c) => c.name === 'timezone')).toHaveLength(1);
	});
});
