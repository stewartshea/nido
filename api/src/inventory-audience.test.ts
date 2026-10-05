import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './db-namespaces';
import { NAMESPACE_HOUSEHOLD_ID } from './db-core';
import {
	clearStaleNotifications, dueRecipients, loadRulesForFamily, parseAudienceIds,
	recordNotified, resolveRecipients,
} from './inventory-eval';

async function call(token: string, method: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const DAY = 24 * 60 * 60 * 1000;

describe('who a notification rule is addressed to', () => {
	let db: any;
	let token = '';
	let ownerId = '';
	let verifiedId = '';
	let unverifiedId = '';
	let itemId = 0;
	let ruleId = 0;

	beforeAll(async () => {
		const reg = await call('', 'POST', '/api/v1/auth/register', {
			email: 'audience.owner@example.com', password: 'StrongP4ss!',
			firstName: 'Ola', lastName: 'Owner',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		db = getFamilyClient(familyId);
		ownerId = String((jwt.decode(token) as any).userId);

		// A second caregiver who confirmed their address, and one who never did.
		verifiedId = 'user-verified-0001';
		unverifiedId = 'user-unverified-001';
		const now = new Date().toISOString();
		for (const [id, email, verified] of [
			[verifiedId, 'verified@example.com', 1],
			[unverifiedId, 'unverified@example.com', 0],
		] as const) {
			await db.execute({
				sql: `INSERT INTO users (id, email, password_hash, first_name, last_name, email_verified, created_at, updated_at)
				      VALUES (?, ?, 'x', 'Vera', 'Caregiver', ?, ?, ?)`,
				args: [id, email, verified, now, now],
			});
			await db.execute({
				sql: 'INSERT INTO user_households (user_id, household_id, role) VALUES (?, ?, ?)',
				args: [id, NAMESPACE_HOUSEHOLD_ID, 'member'],
			});
		}

		const member = await call(token, 'POST', `/api/v1/families/${familyId}/members`, {
			name: 'Kid', birthDate: '2025-01-01T00:00:00.000Z', gender: 'female',
		});
		expect(member.body.member).toBeTruthy();
		const item = await call(token, 'POST', '/api/v1/inventory', {
			memberId: member.body.member.id, name: 'Diapers', category: 'diapers', quantity: 3, unit: 'count',
		});
		expect(item.body.item).toBeTruthy();
		itemId = item.body.item.id;

		const rule = await call(token, 'POST', '/api/v1/inventory/rules', {
			itemId, signal: 'quantity', comparator: 'lte', threshold: 5,
		});
		ruleId = rule.body.rule.id;
	});

	async function rule() {
		const found = (await loadRulesForFamily(db)).find((r) => r.id === ruleId);
		expect(found).toBeTruthy();
		return found!;
	}

	it('reads a stored audience id list, and treats junk as empty', () => {
		expect(parseAudienceIds('["a","b"]')).toEqual(['a', 'b']);
		expect(parseAudienceIds(null)).toEqual([]);
		expect(parseAudienceIds('not json')).toEqual([]);
		expect(parseAudienceIds('"a string"')).toEqual([]);
	});

	it('defaults to the whole family, and includes everyone who confirmed an address', async () => {
		const recipients = await resolveRecipients(db, await rule());
		const ids = recipients.map((r) => r.userId).sort();
		expect(ids).toEqual([ownerId, verifiedId].sort());
	});

	it('never emails an address that was never confirmed', async () => {
		const recipients = await resolveRecipients(db, await rule());
		expect(recipients.map((r) => r.userId)).not.toContain(unverifiedId);
	});

	it('narrows to the named caregivers when a rule says so', async () => {
		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, {
			audienceKind: 'users', audienceIds: [verifiedId],
		});
		const recipients = await resolveRecipients(db, await rule());
		expect(recipients.map((r) => r.userId)).toEqual([verifiedId]);

		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, { audienceKind: 'family' });
	});

	it('names each caregiver the way the family does, not the way they signed up', async () => {
		const now = new Date().toISOString();
		const ins = await db.execute({
			sql: `INSERT INTO family_members (household_id, name, member_type, created_at, updated_at)
			      VALUES (?, ?, 'adult', ?, ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, 'Vera Okafor', now, now],
		});
		await db.execute({
			sql: 'INSERT INTO account_members (user_id, member_id, created_at) VALUES (?, ?, ?)',
			args: [verifiedId, Number(ins.lastInsertRowid), now],
		});

		const res = await call(token, 'GET', '/api/v1/families/accounts');
		expect(res.status).toBe(200);
		const byId = new Map<string, any>((res.body.accounts as any[]).map((a) => [a.id, a]));

		// Linked to a member: the family's name for that person wins over the
		// first/last they typed at sign-up.
		expect(byId.get(verifiedId).name).toBe('Vera Okafor');
		// The owner has no member row, so their account name is the fallback.
		expect(byId.get(ownerId).name).toBe('Ola Owner');
	});

	it('ignores an id that is not a member of this family', async () => {
		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, {
			audienceKind: 'users', audienceIds: [verifiedId, 'someone-else-999'],
		});
		const recipients = await resolveRecipients(db, await rule());
		expect(recipients.map((r) => r.userId)).toEqual([verifiedId]);
		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, { audienceKind: 'family' });
	});

	it('tells everyone once, and only the people already told are quiet next time', async () => {
		const now = Date.now();
		const r = await rule();
		const everyone = await resolveRecipients(db, r);

		const first = await dueRecipients(db, r, itemId, everyone, now);
		expect(first.length).toBe(everyone.length);

		await recordNotified(db, r.id, itemId, first.map((x) => x.userId), now);
		const second = await dueRecipients(db, r, itemId, everyone, now + 60_000);
		expect(second).toEqual([]);
	});

	it('keeps one person quiet without silencing the others', async () => {
		const now = Date.now();
		const r = await rule();
		const everyone = await resolveRecipients(db, r);
		const vera = everyone.find((x) => x.userId === verifiedId)!;
		await clearStaleNotifications(db, [r.id], new Set());

		// Only Vera's delivery landed. This is the case the old per-rule timestamp
		// got wrong: her bounce would have marked the alert told for everyone.
		await recordNotified(db, r.id, itemId, [vera.userId], now);

		const stillDue = await dueRecipients(db, r, itemId, everyone, now + 60_000);
		expect(stillDue.map((x) => x.userId)).not.toContain(verifiedId);
		expect(stillDue.map((x) => x.userId)).toContain(ownerId);
	});

	it('re-notifies once the repeat window has elapsed', async () => {
		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, { repeatDays: 3 });
		const now = Date.now();
		const r = await rule();
		const everyone = await resolveRecipients(db, r);

		await recordNotified(db, r.id, itemId, everyone.map((x) => x.userId), now);
		expect(await dueRecipients(db, r, itemId, everyone, now + 2 * DAY)).toEqual([]);
		expect((await dueRecipients(db, r, itemId, everyone, now + 4 * DAY)).length).toBe(everyone.length);

		await call(token, 'PUT', `/api/v1/inventory/rules/${ruleId}`, { repeatDays: null });
	});

	it('forgets who it told once the rule stops firing, so the next crossing counts again', async () => {
		const now = Date.now();
		const r = await rule();
		const everyone = await resolveRecipients(db, r);
		await recordNotified(db, r.id, itemId, everyone.map((x) => x.userId), now);

		const cleared = await clearStaleNotifications(db, [r.id], new Set());
		expect(cleared).toBeGreaterThan(0);
		expect((await dueRecipients(db, r, itemId, everyone, now + 60_000)).length).toBe(everyone.length);
	});

	it('keeps the state for a rule and item that is still firing', async () => {
		const now = Date.now();
		const r = await rule();
		const everyone = await resolveRecipients(db, r);
		await recordNotified(db, r.id, itemId, everyone.map((x) => x.userId), now);

		expect(await clearStaleNotifications(db, [r.id], new Set([`${r.id}:${itemId}`]))).toBe(0);
		expect(await dueRecipients(db, r, itemId, everyone, now + 60_000)).toEqual([]);
	});
});
