import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './db-namespaces';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './paging';

async function postJson(token: string, path: string, body: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function getJson(token: string, path: string) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method: 'GET',
			headers: { Authorization: `Bearer ${token}` },
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const SEED_COUNT = 150;
const BASE_MS = Date.parse('2024-01-01T00:00:00.000Z');

describe('list route paging', () => {
	let token = '';
	let familyId = '';
	let memberId = 0;
	let babyId = 0;

	beforeAll(async () => {
		const reg = await postJson('', '/api/v1/auth/register', {
			email: 'paging-owner@example.com',
			password: 'StrongP4ss!',
			firstName: 'Paging',
			lastName: 'Tester',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any)?.familyId as string;

		const member = await postJson(token, `/api/v1/families/${familyId}/members`, {
			type: 'child',
			name: 'Paging Kid',
			birthDate: '2024-01-15T00:00:00.000Z',
			gender: 'female',
			categories: ['feeds', 'diapers'],
		});
		memberId = Number(member.body.member.id);

		const db = getFamilyClient(familyId);
		const scope = await db.execute({
			sql: `
				SELECT COALESCE(fm.legacy_baby_id, aligned.id) AS baby_id
				FROM family_members fm
				LEFT JOIN babies aligned ON aligned.id = fm.id AND aligned.household_id = fm.household_id
				WHERE fm.id = ?
				LIMIT 1
			`,
			args: [memberId],
		});
		babyId = Number((scope.rows[0] as any).baby_id);
		expect(babyId).toBeGreaterThan(0);

		// Seeded straight into the database: the point under test is the list
		// route, and 300 HTTP round trips would dominate the suite runtime.
		// Timestamps ascend with insertion order so the newest row also has the
		// highest rowid — exactly the case an unordered `LIMIT` drops.
		const feedArgs: unknown[] = [];
		const diaperArgs: unknown[] = [];
		for (let i = 0; i < SEED_COUNT; i++) {
			const at = new Date(BASE_MS + i * 60_000).toISOString();
			feedArgs.push(babyId, at, 'bottle');
			diaperArgs.push(babyId, at, 'wet');
		}
		const placeholders = (rows: number, cols: number) =>
			Array.from({ length: rows }, () => `(${Array.from({ length: cols }, () => '?').join(', ')})`).join(', ');

		await db.execute({
			sql: `INSERT INTO feedings (baby_id, start_time, type) VALUES ${placeholders(SEED_COUNT, 3)}`,
			args: feedArgs,
		});
		await db.execute({
			sql: `INSERT INTO diapers (baby_id, change_time, type) VALUES ${placeholders(SEED_COUNT, 3)}`,
			args: diaperArgs,
		});
	});

	it('returns the newest record first even past the old 100-row cap', async () => {
		const res = await getJson(token, `/api/v1/feedings?memberId=${memberId}`);
		expect(res.status).toBe(200);
		const rows = res.body.feedings as any[];

		expect(rows).toHaveLength(DEFAULT_PAGE_SIZE);
		expect(res.body.total).toBe(SEED_COUNT);
		expect(rows[0].start_time).toBe(new Date(BASE_MS + (SEED_COUNT - 1) * 60_000).toISOString());
	});

	it('orders strictly newest-first', async () => {
		const res = await getJson(token, `/api/v1/feedings?memberId=${memberId}&limit=200`);
		const times = (res.body.feedings as any[]).map((r) => r.start_time);
		const sorted = [...times].sort((a, b) => b.localeCompare(a));
		expect(times).toEqual(sorted);
	});

	it('pages with offset without gaps or duplicates', async () => {
		const seen: number[] = [];
		for (let offset = 0; offset < SEED_COUNT; offset += 60) {
			const res = await getJson(
				token,
				`/api/v1/feedings?memberId=${memberId}&limit=60&offset=${offset}`,
			);
			expect(res.body.total).toBe(SEED_COUNT);
			seen.push(...(res.body.feedings as any[]).map((r) => Number(r.id)));
		}
		expect(seen).toHaveLength(SEED_COUNT);
		expect(new Set(seen).size).toBe(SEED_COUNT);
	});

	it('returns an empty page past the end instead of erroring', async () => {
		const res = await getJson(token, `/api/v1/feedings?memberId=${memberId}&offset=9999`);
		expect(res.status).toBe(200);
		expect(res.body.feedings).toHaveLength(0);
		expect(res.body.total).toBe(SEED_COUNT);
	});

	it('clamps an oversized limit rather than dumping the table', async () => {
		const res = await getJson(token, `/api/v1/feedings?memberId=${memberId}&limit=99999`);
		expect(res.status).toBe(200);
		expect((res.body.feedings as any[]).length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
		expect(res.body.total).toBe(SEED_COUNT);
	});

	it('falls back to the default page for nonsense paging input', async () => {
		for (const query of ['limit=abc', 'limit=-5', 'limit=0', 'offset=-3', 'offset=xyz']) {
			const res = await getJson(token, `/api/v1/feedings?memberId=${memberId}&${query}`);
			expect(res.status).toBe(200);
			expect((res.body.feedings as any[]).length).toBe(DEFAULT_PAGE_SIZE);
		}
	});

	it('pages diapers, which previously sorted after an unordered LIMIT', async () => {
		const first = await getJson(token, `/api/v1/diapers?memberId=${memberId}&limit=50`);
		const rows = first.body.diapers as any[];
		expect(rows).toHaveLength(50);
		expect(first.body.total).toBe(SEED_COUNT);
		expect(rows[0].change_time).toBe(new Date(BASE_MS + (SEED_COUNT - 1) * 60_000).toISOString());

		const second = await getJson(token, `/api/v1/diapers?memberId=${memberId}&limit=50&offset=50`);
		const overlap = rows.filter((r) =>
			(second.body.diapers as any[]).some((o) => o.id === r.id),
		);
		expect(overlap).toHaveLength(0);
	});

	it('rejects a member outside the caller family before counting', async () => {
		const other = await postJson('', '/api/v1/auth/register', {
			email: 'paging-outsider@example.com',
			password: 'StrongP4ss!',
			firstName: 'Out',
			lastName: 'Sider',
		});
		const res = await getJson(other.body.token, `/api/v1/feedings?memberId=${memberId}`);
		expect(res.status).toBe(404);
		expect(res.body.total).toBeUndefined();
	});
});
