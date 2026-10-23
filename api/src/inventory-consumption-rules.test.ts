// src/inventory-consumption-rules.test.ts
//
// Phase 2 of issue #40: the rule is a row of its own (inventory_consumption_rules)
// with a condition document against the activity registry, so an item can match
// on several dimensions at once ("a routine bath"), follow any member's events
// when it belongs to the household, and coexist with further rules on the same
// item — while the flattened Phase-1 shape keeps reading from the same rule.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './db-namespaces';
import { consumableSources } from './reminder-conditions';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const now = () => new Date().toISOString();

/**
 * One record through each consumable activity's route. The conformance test
 * walks the registry and fails if a table has no fixture here — the registry's
 * promise ("a route bills stock for this table") has to stay demonstrable.
 */
const FIXTURES: Record<string, { path: string; body: (memberId: number) => Record<string, unknown> }> = {
	feedings: { path: '/api/v1/feedings', body: (m) => ({ memberId: m, startTime: now(), type: 'bottle' }) },
	diapers: { path: '/api/v1/diapers', body: (m) => ({ memberId: m, changeTime: now(), type: 'wet' }) },
	sleep: { path: '/api/v1/sleep', body: (m) => ({ memberId: m, startTime: now() }) },
	growth: { path: '/api/v1/growth', body: (m) => ({ memberId: m, measurementDate: now(), weight: 7.2 }) },
	milestones: { path: '/api/v1/milestones', body: (m) => ({ memberId: m, title: 'Conformance', achievedDate: now() }) },
	moods: { path: '/api/v1/moods', body: (m) => ({ memberId: m, mood: 'happy' }) },
	journal_entries: { path: '/api/v1/journal', body: (m) => ({ memberId: m, title: 'Conformance entry' }) },
	vaccinations: { path: '/api/v1/vaccinations', body: (m) => ({ memberId: m, name: 'Conformance shot' }) },
};

describe('inventory consumption rules: conditions, scope, and one event → many rules', () => {
	let token = '';
	let familyId = '';
	let memberId = 0;
	let siblingId = 0;

	const logFeed = (type: string, subject = memberId) =>
		call('POST', token, '/api/v1/feedings', {
			memberId: subject, startTime: now(), type,
		});

	const findItem = async (id: number) => {
		const res = await call('GET', token, '/api/v1/inventory');
		return res.body.items.find((i: any) => i.id === id);
	};

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'consume-rules-2@example.com', password: 'StrongP4ss!', firstName: 'Rules', lastName: 'Phase Two',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Rule Baby', birthDate: '2026-01-01T00:00:00.000Z', gender: 'female',
		});
		memberId = member.body.member.id;
		const sibling = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Rule Sibling', birthDate: '2026-03-01T00:00:00.000Z', gender: 'male',
		});
		siblingId = sibling.body.member.id;
	});

	it('applies a nested consumptionRule, mirroring its flattened Phase-1 view', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Bottle brushes', category: 'cleaning', quantity: 6,
			consumptionRule: {
				sourceTable: 'feedings',
				conditions: [{ attr: 'type', values: ['bottle'] }],
				unitsPerUse: 2,
			},
		});
		expect(made.status).toBe(201);
		const item = made.body.item;
		expect(item.consumptionRule.sourceTable).toBe('feedings');
		expect(item.consumptionRule.match).toBe('all');
		expect(item.consumptionRule.conditions).toEqual([{ attr: 'type', values: ['bottle'] }]);
		// The flattened fields are derived from the rule, not stored separately.
		expect(item.eventCategory).toBe('feedings');
		expect(item.eventOption).toBe('bottle');
		expect(item.unitsPerDecrement).toBe(2);

		await logFeed('breast');                       // filtered out
		expect((await findItem(item.id)).quantity).toBe(6);
		await logFeed('bottle');                       // 1 of 2 carried
		expect((await findItem(item.id)).quantity).toBe(6);
		await logFeed('bottle');                       // second bottle bills one
		expect((await findItem(item.id)).quantity).toBe(5);

		// A nested document replaces the rule wholesale.
		const swapped = await call('PUT', token, `/api/v1/inventory/${item.id}`, {
			consumptionRule: {
				sourceTable: 'feedings',
				conditions: [{ attr: 'type', values: ['breast'] }],
				unitsPerUse: 1,
			},
		});
		expect(swapped.status).toBe(200);
		await logFeed('bottle');
		expect((await findItem(item.id)).quantity).toBe(5);
		await logFeed('breast');
		expect((await findItem(item.id)).quantity).toBe(4);
	});

	it('refuses a rule naming an unknown activity, attribute or option value', async () => {
		const unknownActivity = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Bogus activity', category: 'other',
			consumptionRule: { sourceTable: 'laundry' },
		});
		expect(unknownActivity.status).toBe(400);

		const unknownAttr = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Bogus attribute', category: 'other',
			consumptionRule: { sourceTable: 'feedings', conditions: [{ attr: 'colour' }] },
		});
		expect(unknownAttr.status).toBe(400);

		const unknownValue = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Bogus value', category: 'other',
			consumptionRule: { sourceTable: 'feedings', conditions: [{ attr: 'type', values: ['sparkling'] }] },
		});
		expect(unknownValue.status).toBe(400);
	});

	it('matches a milestone on kind and category together, not either alone', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Bath toys', category: 'baby_care', quantity: 3,
			consumptionRule: {
				sourceTable: 'milestones',
				conditions: [
					{ attr: 'kind', values: ['routines'] },
					{ attr: 'category', values: ['bath'] },
				],
			},
		});
		expect(made.status).toBe(201);
		expect(made.body.item.consumptionRule.conditions.length).toBe(2);
		// Two dimensions do not flatten into a single option.
		expect(made.body.item.eventOption).toBe(null);
		const id = made.body.item.id;

		// Right kind, wrong category.
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Tummy time', achievedDate: now(), kind: 'routines', category: 'tummy time',
		});
		expect((await findItem(id)).quantity).toBe(3);

		// 'bath' exists under grooming too — kind and category must agree.
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'Grooming bath', achievedDate: now(), kind: 'grooming', category: 'bath',
		});
		expect((await findItem(id)).quantity).toBe(3);

		// Both match: a routine bath bills.
		await call('POST', token, '/api/v1/milestones', {
			memberId, title: 'First bath', achievedDate: now(), kind: 'routines', category: 'bath',
		});
		expect((await findItem(id)).quantity).toBe(2);
	});

	it('follows any member\'s events for a household item, only its own for a member item', async () => {
		const household = await call('POST', token, '/api/v1/inventory', {
			name: 'Household wipes', category: 'household', quantity: 10,
			eventCategory: 'feedings',
		});
		expect(household.status).toBe(201);
		const scoped = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Baby-only wipes', category: 'baby_care', quantity: 10,
			eventCategory: 'feedings',
		});
		expect(scoped.status).toBe(201);

		await logFeed('bottle', siblingId);           // a different member's feed
		expect((await findItem(household.body.item.id)).quantity).toBe(9);
		expect((await findItem(scoped.body.item.id)).quantity).toBe(10);

		await logFeed('bottle', memberId);
		expect((await findItem(household.body.item.id)).quantity).toBe(8);
		expect((await findItem(scoped.body.item.id)).quantity).toBe(9);
	});

	it('lets two rules on one item both bill the same logged event', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Dual rules', category: 'other', quantity: 10,
			eventCategory: 'feedings',
		});
		expect(made.status).toBe(201);
		const id = made.body.item.id;

		// A second rule straight in the database: the API shapes one rule per
		// item today, but nothing in the schema forbids more, and the gate and
		// ledger are keyed by rule precisely so this works.
		const db = getFamilyClient(familyId);
		await db.execute({
			sql: `INSERT INTO inventory_consumption_rules (item_id, source_table, amount_per_use) VALUES (?, 'feedings', 2)`,
			args: [id],
		});

		await logFeed('bottle');
		expect((await findItem(id)).quantity).toBe(7);   // 1 from the first rule + 2 from the second

		const gates = await db.execute({
			sql: `SELECT COUNT(*) AS n FROM inventory_consumption_events
			      WHERE rule_id IN (SELECT id FROM inventory_consumption_rules WHERE item_id = ?)`,
			args: [id],
		});
		expect(Number((gates.rows[0] as any).n)).toBe(2); // one gate row per rule, same event
	});

	it('does not rebill a pre-unlink event once the activity is linked again', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Relinkable', category: 'other', quantity: 5,
			eventCategory: 'feedings',
		});
		const id = made.body.item.id;

		const first = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'feedings', refId: 555001,
		});
		expect(first.body.applied).toContain('Relinkable');
		expect((await findItem(id)).quantity).toBe(4);

		const unlinked = await call('PUT', token, `/api/v1/inventory/${id}`, { eventCategory: null });
		expect(unlinked.status).toBe(200);
		const relinked = await call('PUT', token, `/api/v1/inventory/${id}`, { eventCategory: 'feedings' });
		expect(relinked.status).toBe(200);

		const again = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'feedings', refId: 555001,
		});
		expect(again.body.applied).toEqual([]);       // the old ledger row still gates it
		expect((await findItem(id)).quantity).toBe(4);
	});

	it('lets a history reset start billing the same event over again', async () => {
		const made = await call('POST', token, '/api/v1/inventory', {
			memberId, name: 'Resettable', category: 'other', quantity: 5,
			eventCategory: 'feedings',
		});
		const id = made.body.item.id;

		const first = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'feedings', refId: 556001,
		});
		expect(first.body.applied).toContain('Resettable');
		expect((await findItem(id)).quantity).toBe(4);

		const reset = await call('POST', token, `/api/v1/inventory/${id}/reset-history`, { quantity: 4 });
		expect(reset.status).toBe(200);

		const again = await call('POST', token, '/api/v1/inventory/consume', {
			memberId, refTable: 'feedings', refId: 556001,
		});
		expect(again.body.applied).toContain('Resettable');
		expect((await findItem(id)).quantity).toBe(3);
	});

	it('bills stock through every activity the registry declares consumable', async () => {
		const sources = consumableSources();
		expect(sources.length).toBeGreaterThanOrEqual(8);

		for (const source of sources) {
			const fixture = FIXTURES[source.table];
			if (!fixture) {
				// The registry is the picker's promise; a table without a
				// route fixture would mean an activity that does nothing.
				throw new Error(`Consumable activity "${source.table}" has no route fixture — add one here`);
			}
			const made = await call('POST', token, '/api/v1/inventory', {
				memberId, name: `Conformance ${source.table}`, category: 'other', quantity: 10,
				eventCategory: source.table,
			});
			expect(made.status, `${source.table} item refused`).toBe(201);

			const logged = await call('POST', token, fixture.path, fixture.body(memberId));
			expect(logged.status, `${source.table} route rejected its fixture: ${JSON.stringify(logged.body)}`).toBeLessThan(300);

			const item = await findItem(made.body.item.id);
			expect(item.quantity, `${source.table} did not bill stock`).toBe(9);
		}
	});
});
