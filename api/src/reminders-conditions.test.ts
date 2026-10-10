// src/reminders-conditions.test.ts
//
// The two requests that the old single-category, hard-coded rule could not
// express:
//
//   "no bath in 7 days"        - a routine, which was not one of the five
//                                categories the evaluator knew, so the rule
//                                could not be chosen and never fired.
//   "no pump or feed in 3h"    - two conditions OR'd, where one category and
//                                one window was the whole model.
//
// A rule now carries a list of conditions, any one of which having happened
// recently clears it, and the categories come from the vocabulary rather than a
// switch.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { openDb, runMigrations } from './db-core';
import { FAMILY_MIGRATIONS } from './db-namespaces';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();

let token = '';
let familyId = '';

async function addMember(name: string): Promise<number> {
	const res = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name, stage: 'infant', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
	});
	return res.body.member.id as number;
}

async function makeRule(body: Record<string, unknown>): Promise<any> {
	const made = await call('POST', token, '/api/v1/reminders', body);
	expect(made.status, JSON.stringify(made.body)).toBe(201);
	const all = await call('GET', token, '/api/v1/reminders');
	return all.body.reminders.find((r: any) => r.id === made.body.reminder.id);
}

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'remconds@example.com', password: 'StrongP4ss!', firstName: 'Rem', lastName: 'Conds',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
});

describe('a routine can be watched by name', () => {
	it('no bath in 7 days fires when the bath is older than a week', async () => {
		const memberId = await addMember('Bath Time');
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Bath', kind: 'routines', category: 'bath', achievedDate: hoursAgo(24 * 8),
		});
		const rule = await makeRule({
			kind: 'inactivity', hours: 24 * 7, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'routines', values: ['bath'] }],
		});
		expect(rule.conditions).toEqual([{ category: 'routines', values: ['bath'] }]);
		expect(rule.overdue).toBe(true);
		expect(rule.since).toBeTruthy();
	});

	it('clears when a bath is logged inside the window', async () => {
		const memberId = await addMember('Fresh Bath');
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Bath', kind: 'routines', category: 'bath', achievedDate: hoursAgo(2),
		});
		const rule = await makeRule({
			kind: 'inactivity', hours: 24 * 7, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'routines', values: ['bath'] }],
		});
		expect(rule.overdue).toBe(false);
	});

	it('ignores a different routine, which is the point of the filter', async () => {
		const memberId = await addMember('Tummy Time');
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Tummy time', kind: 'routines', category: 'tummy time', achievedDate: hoursAgo(1),
		});
		const rule = await makeRule({
			kind: 'inactivity', hours: 24 * 7, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'routines', values: ['bath'] }],
		});
		expect(rule.overdue).toBe(true);
	});
});

describe('several conditions are OR\'d', () => {
	it('a pump or a breastfeed, whichever happened most recently, clears the rule', async () => {
		const memberId = await addMember('Pump Or Feed');
		// A bottle is not a breastfeed, and the pump ran five hours ago.
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(5), type: 'pump', amount: 100, amountUnit: 'ml' });
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'bottle', amount: 4 });

		const rule = await makeRule({
			kind: 'inactivity', hours: 3, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'pumping' }, { category: 'feeds', values: ['breast'] }],
		});
		// The pump was five hours ago and there has never been a breastfeed.
		expect(rule.overdue).toBe(true);

		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'breast', side: 'left' });
		const after = await call('GET', token, '/api/v1/reminders');
		const fresh = after.body.reminders.find((r: any) => r.id === rule.id);
		expect(fresh.overdue).toBe(false);
	});

	it('a bottle does not satisfy a breastfeed-only condition', async () => {
		const memberId = await addMember('Bottle Only');
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'bottle', amount: 4 });
		const rule = await makeRule({
			kind: 'inactivity', hours: 3, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'feeds', values: ['breast'] }],
		});
		expect(rule.overdue).toBe(true);
	});
});

describe('AND (match: all) clears only when every condition happened', () => {
	it('stays overdue on a feed alone, and clears once the change is logged too', async () => {
		const memberId = await addMember('Feed And Change');
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'bottle', amount: 4 });

		const rule = await makeRule({
			kind: 'inactivity', hours: 3, match: 'all', targetType: 'member', targetId: memberId,
			conditions: [{ category: 'feeds' }, { category: 'diapers' }],
		});
		expect(rule.match).toBe('all');
		// A feed happened, but no change yet, so the pair is not satisfied.
		expect(rule.overdue).toBe(true);

		await call('POST', token, '/api/v1/diapers', { memberId, changeTime: hoursAgo(1), type: 'wet' });
		const after = await call('GET', token, '/api/v1/reminders');
		expect(after.body.reminders.find((r: any) => r.id === rule.id).overdue).toBe(false);
	});

	it('is bound by the oldest of the conditions, not the newest', async () => {
		const memberId = await addMember('Oldest Wins');
		await call('POST', token, '/api/v1/feedings', { memberId, startTime: hoursAgo(1), type: 'bottle', amount: 4 });
		await call('POST', token, '/api/v1/diapers', { memberId, changeTime: hoursAgo(5), type: 'wet' });
		const rule = await makeRule({
			kind: 'inactivity', hours: 3, match: 'all', targetType: 'member', targetId: memberId,
			conditions: [{ category: 'feeds' }, { category: 'diapers' }],
		});
		expect(rule.overdue).toBe(true);
	});
});

describe('an interval rule clears from a recorded event, not just a manual done', () => {
	it('is overdue with no routine, and clears once the bath is logged', async () => {
		const memberId = await addMember('Bath Every Week');
		const rule = await makeRule({
			kind: 'interval', intervalDays: 7, match: 'any', targetType: 'member', targetId: memberId,
			conditions: [{ category: 'routines', values: ['bath'] }],
		});
		expect(rule.overdue).toBe(true);

		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Bath', kind: 'routines', category: 'bath', achievedDate: hoursAgo(1),
		});
		const after = await call('GET', token, '/api/v1/reminders');
		expect(after.body.reminders.find((r: any) => r.id === rule.id).overdue).toBe(false);
	});

	it('a manual interval rule with nothing to watch clears only when marked done', async () => {
		const memberId = await addMember('Furnace Filter');
		const rule = await makeRule({
			kind: 'interval', intervalDays: 180, label: 'Change filter', category: 'custom',
			targetType: 'member', targetId: memberId,
		});
		expect(rule.overdue).toBe(true);

		await call('POST', token, `/api/v1/reminders/${rule.id}/done`);
		const after = await call('GET', token, '/api/v1/reminders');
		expect(after.body.reminders.find((r: any) => r.id === rule.id).overdue).toBe(false);
	});
});

describe('a category Nido cannot watch is rejected, not silently inert', () => {
	it('rejects an unknown category with a 400', async () => {
		const memberId = await addMember('Unknown');
		const res = await call('POST', token, '/api/v1/reminders', {
			kind: 'inactivity', hours: 3, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'teleportation' }],
		});
		expect(res.status).toBe(400);
		expect(String(res.body.error)).toMatch(/not something Nido can watch/i);
	});

	it('rejects an option value the category does not have', async () => {
		const memberId = await addMember('Bad Option');
		const res = await call('POST', token, '/api/v1/reminders', {
			kind: 'inactivity', hours: 3, targetType: 'member', targetId: memberId,
			conditions: [{ category: 'routines', values: ['moonwalk'] }],
		});
		expect(res.status).toBe(400);
	});
});

describe('the catalog is looked up, not hard-coded', () => {
	it('offers routines with the bath option', async () => {
		const res = await call('GET', token, '/api/v1/reminders/catalog');
		expect(res.status).toBe(200);
		const routines = res.body.categories.find((c: any) => c.id === 'routines');
		expect(routines).toBeTruthy();
		expect(routines.options).toContain('bath');
	});

	it('merges a family\'s own option value', async () => {
		await call('PUT', token, `/api/v1/families/${familyId}/settings`, {
			categoryOptions: { routines: { type: ['bath', 'our own thing'] } },
		});
		const res = await call('GET', token, '/api/v1/reminders/catalog');
		const routines = res.body.categories.find((c: any) => c.id === 'routines');
		expect(routines.options).toContain('our own thing');
	});
});

describe('an existing rule database upgrades to match_mode', () => {
	// The failure this guards against: a family database that ran the earlier
	// `conditions` migration sits at user_version 29 without `match_mode`. If the
	// column were folded into that migration it would never re-run, so every
	// insert would fail with a missing column and the UI would only ever say
	// "Could not add that reminder."
	it('adds match_mode to a database already at version 29', async () => {
		const client = openDb(':memory:');
		runMigrations(client.raw, FAMILY_MIGRATIONS.filter((m) => m.version <= 29));

		const before = (await client.execute({ sql: 'PRAGMA table_info(reminders)' })).rows.map((r: any) => r.name);
		expect(before).toContain('conditions');
		expect(before).not.toContain('match_mode');

		runMigrations(client.raw, FAMILY_MIGRATIONS);

		const after = (await client.execute({ sql: 'PRAGMA table_info(reminders)' })).rows.map((r: any) => r.name);
		expect(after).toContain('match_mode');
		client.close();
	});

	it('is a no-op where the column was already added and the version rewound', async () => {
		const client = openDb(':memory:');
		runMigrations(client.raw, FAMILY_MIGRATIONS);
		// Stand in for a database that got the column from the intermediate build
		// but reports version 29, so migration 30 runs again against it.
		client.raw.pragma('user_version = 29');

		expect(() => runMigrations(client.raw, FAMILY_MIGRATIONS)).not.toThrow();
		const columns = (await client.execute({ sql: 'PRAGMA table_info(reminders)' })).rows.map((r: any) => r.name);
		expect(columns.filter((c) => c === 'match_mode')).toHaveLength(1);
		client.close();
	});
});
