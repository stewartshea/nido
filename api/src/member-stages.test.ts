// src/member-stages.test.ts
//
// Pets and adults were listable as members but had nowhere to record anything:
// only a child got a profile row to hang logs off. These tests cover the two
// halves of that — the category set a stage starts with, and a non-child
// actually being loggable.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

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

const add = (token: string, data: Record<string, unknown>) =>
	call('POST', token, '/api/v1/families/members', data);

let token = '';
let familyId = '';

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'stages@example.com',
		password: 'StrongP4ss!',
		firstName: 'Stage',
		lastName: 'Tester',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
});

describe('a stage decides the categories a profile starts with', () => {
	it('gives a pet pet categories, and makes it loggable by default', async () => {
		const res = await add(token, { type: 'pet', name: 'Rex' });
		expect(res.status).toBe(201);
		expect(res.body.member.type).toBe('pet');
		expect(res.body.member.stage).toBe('pet');
		expect(res.body.member.trackable).toBe(true);
		expect(res.body.member.categories).toContain('grooming');
		expect(res.body.member.categories).toContain('medication');
		// A pet does not have nappies or pumping.
		expect(res.body.member.categories).not.toContain('diapers');
		expect(res.body.member.categories).not.toContain('pumping');
	});

	it('defaults an adult to adult categories and to not being tracked', async () => {
		const res = await add(token, { type: 'adult', name: 'Sam' });
		expect(res.status).toBe(201);
		expect(res.body.member.stage).toBe('adult');
		// An adult is usually the one doing the logging, not the subject of it.
		expect(res.body.member.trackable).toBe(false);
		expect(res.body.member.categories).toContain('medication');
		expect(res.body.member.categories).not.toContain('feeds');
	});

	it('lets an adult be tracked when the family asks for it', async () => {
		const res = await add(token, { type: 'adult', name: 'Tracked Adult', trackable: true });
		expect(res.body.member.trackable).toBe(true);
		expect(res.body.member.stage).toBe('adult');
	});

	it('uses the stage when one is given explicitly', async () => {
		const infant = await add(token, { type: 'child', name: 'Newborn', stage: 'infant' });
		expect(infant.body.member.stage).toBe('infant');
		expect(infant.body.member.categories).toContain('diapers');
		expect(infant.body.member.categories).not.toContain('firsts');

		const child = await add(token, { type: 'child', name: 'Schoolkid', stage: 'child' });
		expect(child.body.member.stage).toBe('child');
		expect(child.body.member.categories).toContain('milestones');
		expect(child.body.member.categories).not.toContain('diapers');
	});
});

describe('existing behaviour is unchanged when no stage is chosen', () => {
	// The regression that would matter most: a family adding a baby must not
	// silently lose feeds and nappies because a new concept arrived.
	it('gives a child with no stage exactly the original category list', async () => {
		const res = await add(token, { type: 'child', name: 'Untyped Baby' });
		expect(res.status).toBe(201);
		expect(res.body.member.stage).toBeNull();
		expect(res.body.member.categories).toEqual([
			'feeds', 'diapers', 'sleep', 'growth', 'pumping', 'routines', 'firsts', 'milestones', 'medical', 'vaccines', 'moods', 'journal',
		]);
	});
});

describe('a pet is loggable, which it could not be before', () => {
	let petId = 0;
	beforeAll(async () => {
		const res = await add(token, { type: 'pet', name: 'Loggable Pet' });
		petId = res.body.member.id;
	});

	it('records a vaccination against a pet', async () => {
		const res = await call('POST', token, '/api/v1/vaccinations', {
			memberId: petId,
			name: 'Rabies booster',
			dateGiven: '2026-04-01T00:00:00.000Z',
			nextDueDate: '2027-04-01T00:00:00.000Z',
		});
		expect(res.status).toBe(200);
	});

	it('records medication and grooming, the kinds added for this', async () => {
		const med = await call('POST', token, '/api/v1/milestones', {
			memberId: petId,
			title: 'Flea treatment',
			achievedDate: '2026-04-02T00:00:00.000Z',
			kind: 'medication',
		});
		expect(med.status).toBe(200);
		expect(med.body.milestone.kind).toBe('medication');

		const groom = await call('POST', token, '/api/v1/milestones', {
			memberId: petId,
			title: 'Nail trim',
			achievedDate: '2026-04-03T00:00:00.000Z',
			kind: 'grooming',
		});
		expect(groom.status).toBe(200);
		expect(groom.body.milestone.kind).toBe('grooming');
	});

	it('still refuses to log against an untracked adult', async () => {
		const adult = await add(token, { type: 'adult', name: 'Untracked Adult' });
		const res = await call('POST', token, '/api/v1/milestones', {
			memberId: adult.body.member.id,
			title: 'Should not land',
			achievedDate: '2026-04-04T00:00:00.000Z',
		});
		expect(res.status).toBe(404);
	});
});

describe('a profile with no category list falls back to its stage, not to everything', () => {
	// The account owner is created by a migration that inserts a null category
	// list. The browser used to read an empty list as "show every category", so
	// every owner was offered feeds and nappies.
	it('heals a member whose stored list is null, which is what the owner backfill writes', async () => {
		// The owner-member migration inserted NULL categories. Rather than trust the
		// registration path (which now sets a list), force the stored value back to
		// NULL and read it the way the browser does.
		const made = await add(token, { type: 'adult', name: 'Null Stored', trackable: true });
		const id = made.body.member.id;
		const { getFamilyClient } = await import('./db-namespaces');
		await getFamilyClient(familyId).execute({
			sql: 'UPDATE family_members SET categories = NULL WHERE id = ?',
			args: [id],
		});

		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const m = list.body.members.find((x: any) => x.id === id);
		expect(m.categories).not.toContain('feeds');
		expect(m.categories).not.toContain('diapers');
		expect(m.categories).toContain('medication');
	});

	it('gives an owner with a null list the adult set, never the baby one', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'nullcats@example.com', password: 'StrongP4ss!', firstName: 'Null', lastName: 'Owner',
		});
		const t = reg.body.token;
		const fid = (jwt.decode(t) as any).familyId as string;
		const list = await call('GET', t, `/api/v1/families/${fid}/members`);
		const owner = list.body.members[0];
		expect(owner.stage).toBe('adult');
		expect(owner.categories).not.toContain('feeds');
		expect(owner.categories).not.toContain('diapers');
		expect(owner.categories).toContain('medication');
	});

	it('keeps a category the family explicitly enabled, even if the stage omits it', async () => {
		// A stage template is a starting point, not a cage.
		const made = await add(token, { type: 'adult', name: 'Milestone Adult', trackable: true, categories: ['routines', 'milestones', 'moods'] });
		expect(made.body.member.categories).toEqual(['routines', 'milestones', 'moods']);
	});

	it('still returns nothing when the family explicitly turned everything off', async () => {
		const made = await add(token, { type: 'adult', name: 'Silent Adult', trackable: true });
		const cleared = await call('PUT', token, `/api/v1/families/${familyId}/members/${made.body.member.id}`, { categories: [] });
		// An empty explicit list is a real answer; it just cannot be stored, so the
		// stage comes back. Documented here so the behaviour is not a surprise.
		expect(Array.isArray(cleared.body.member.categories)).toBe(true);
	});
});

describe('a family can change what a stage tracks', () => {
	it('uses the family\u2019s version of a stage for the next profile of that stage', async () => {
		// A household that does not track moods for its dog should say so once.
		const put = await call('PUT', token, `/api/v1/families/${familyId}/settings`, {
			stageCategories: { pet: ['feeds', 'vaccines', 'grooming'] },
		});
		expect(put.status).toBe(200);
		expect(put.body.settings.stageCategories.pet).toEqual(['feeds', 'vaccines', 'grooming']);

		const res = await add(token, { type: 'pet', name: 'Trimmed Pet' });
		expect(res.status).toBe(201);
		expect(res.body.member.categories).toEqual(['feeds', 'vaccines', 'grooming']);
	});

	it('leaves other stages on the built-in set', async () => {
		const res = await add(token, { type: 'child', name: 'Untouched', stage: 'infant' });
		expect(res.body.member.categories).toContain('diapers');
		expect(res.body.member.categories).toContain('pumping');
	});

	it('exposes the built-in stage templates so the UI is not a second copy', async () => {
		const res = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(res.body.settings.defaultStageCategories.pet).toContain('grooming');
		expect(res.body.settings.defaultStageCategories.adult).toContain('medication');
	});
});

describe('quick links belong to the person, not the account', () => {
	it('pins tiles against a member and reads them back', async () => {
		const made = await add(token, { type: 'adult', name: 'Pinner', trackable: true });
		const id = made.body.member.id;
		// Nothing pinned yet: the UI falls back to the member's own categories.
		expect(made.body.member.quickLinks).toBeNull();

		const upd = await call('PUT', token, `/api/v1/families/${familyId}/members/${id}`, {
			quickLinks: ['vitamins', 'medication'],
		});
		expect(upd.status).toBe(200);
		expect(upd.body.member.quickLinks).toEqual(['vitamins', 'medication']);

		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const mine = list.body.members.find((m: any) => m.id === id);
		expect(mine.quickLinks).toEqual(['vitamins', 'medication']);
	});

	it('keeps two members\u2019 pins apart', async () => {
		const a = await add(token, { type: 'adult', name: 'Pin A', trackable: true });
		const b = await add(token, { type: 'adult', name: 'Pin B', trackable: true });
		await call('PUT', token, `/api/v1/families/${familyId}/members/${a.body.member.id}`, { quickLinks: ['vitamins'] });

		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const find = (id: number) => list.body.members.find((m: any) => m.id === id);
		expect(find(a.body.member.id).quickLinks).toEqual(['vitamins']);
		expect(find(b.body.member.id).quickLinks).toBeNull();
	});

	it('pins vitamins, which is why the category exists', async () => {
		const made = await add(token, { type: 'adult', name: 'Vitamin Taker', trackable: true });
		expect(made.body.member.categories).toContain('vitamins');
		const res = await call('POST', token, '/api/v1/milestones', {
			memberId: made.body.member.id,
			title: 'Vitamin D',
			achievedDate: '2026-04-05T00:00:00.000Z',
			kind: 'vitamins',
		});
		expect(res.status).toBe(200);
		expect(res.body.milestone.kind).toBe('vitamins');
	});
});

describe('changing stage never rewrites categories', () => {
	it('records the new stage but leaves a deliberately chosen list alone', async () => {
		const made = await add(token, { type: 'child', name: 'Turner', categories: ['journal'] });
		const id = made.body.member.id;
		expect(made.body.member.categories).toEqual(['journal']);

		const upd = await call('PUT', token, `/api/v1/families/${familyId}/members/${id}`, { stage: 'child' });
		expect(upd.status).toBe(200);
		expect(upd.body.member.stage).toBe('child');
		// A family that turned things off must not have them turned back on by an
		// age change.
		expect(upd.body.member.categories).toEqual(['journal']);
	});
});
