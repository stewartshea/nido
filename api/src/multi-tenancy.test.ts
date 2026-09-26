import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { ensureRegistry, getFamilyClient } from './db-namespaces';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';

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

async function register(email: string, pw = 'StrongP4ss!') {
	const res = await postJson('', '/api/v1/auth/register', {
		email,
		password: pw,
		firstName: 'Test',
		lastName: email.split('@')[0],
	});
	return { token: res.body.token as string, userId: res.body.user.id as string, familyId: (jwt.decode(res.body.token) as any)?.familyId as string };
}

async function addMember(token: string, familyId: string, overrides: Record<string, any> = {}) {
	const payload = {
		type: 'child',
		name: `Member-${Date.now()}`,
		birthDate: new Date('2024-01-15').toISOString(),
		gender: 'female',
		categories: ['feeds', 'diapers', 'sleep', 'growth'],
		...overrides,
	};
	const { status, body } = await postJson(token, `/api/v1/families/${familyId}/members`, payload);
	expect(status).toBe(201);
	return body.member as { id: number; name: string; type: string; categories: string[] };
}

describe('multi-tenancy isolation', () => {
	let userA: { token: string; userId: string; familyId: string };
	let userB: { token: string; userId: string; familyId: string };
	let memberA: { id: number; name: string };
	let memberB: { id: number; name: string };

	it('provisions two isolated families', async () => {
		userA = await register('mt-owner-a@example.com');
		userB = await register('mt-owner-b@example.com');
		expect(userA.familyId).not.toBe(userB.familyId);
	});

	it('each family adds a trackable member', async () => {
		memberA = await addMember(userA.token, userA.familyId);
		memberB = await addMember(userB.token, userB.familyId);
		expect(memberA.id).toBeGreaterThan(0);
		expect(memberB.id).toBeGreaterThan(0);
	});

	it('creates feedings scoped to each member', async () => {
		const start = new Date().toISOString();
		const feedA = await postJson(userA.token, '/api/v1/feedings', {
			memberId: memberA.id,
			startTime: start,
			type: 'breast',
			side: 'left',
		});
		expect(feedA.status).toBe(200);

		const feedB = await postJson(userB.token, '/api/v1/feedings', {
			memberId: memberB.id,
			startTime: start,
			type: 'bottle',
			amount: 4,
		});
		expect(feedB.status).toBe(200);
	});

	it('feeds lists are scoped per family (different counts)', async () => {
		const feedsA = await getJson(userA.token, `/api/v1/feedings?memberId=${memberA.id}`);
		expect(feedsA.status).toBe(200);
		const listA = feedsA.body.feedings ?? [];
		expect(listA.length).toBeGreaterThan(0);
		for (const f of listA) expect(f.baby_id).toBe(memberA.id);
	});

	it('second member in family A is hidden from family B', async () => {
		const memberA2 = await addMember(userA.token, userA.familyId, {
			name: `Second-${Date.now()}`,
		});
		await postJson(userA.token, '/api/v1/feedings', {
			memberId: memberA2.id,
			startTime: new Date().toISOString(),
			type: 'bottle',
			amount: 6,
		});

		const resA2 = await getJson(userA.token, `/api/v1/feedings?memberId=${memberA2.id}`);
		expect(resA2.status).toBe(200);
		expect((resA2.body.feedings ?? []).length).toBe(1);

		const resB2 = await getJson(userB.token, `/api/v1/feedings?memberId=${memberA2.id}`);
		expect(resB2.status).toBe(404);
	});

	it('user B sees only their own members', async () => {
		const res = await getJson(userB.token, `/api/v1/families/${userB.familyId}/members`);
		expect(res.status).toBe(200);
		const members = res.body.members ?? [];
		expect(members.length).toBe(1);
		expect(members[0].id).toBe(memberB.id);
	});

	it('adult member sees no feeds/diapers categories in settings', async () => {
		const adult = await addMember(userA.token, userA.familyId, {
			type: 'adult',
			name: `Adult-${Date.now()}`,
			categories: ['routines', 'milestones', 'moods'],
		});
		const res = await getJson(userA.token, `/api/v1/families/${userA.familyId}/members`);
		const members = res.body.members ?? [];
		const found = members.find((m: any) => m.id === adult.id);
		expect(found.type).toBe('adult');
		expect(found.categories).toEqual(['routines', 'milestones', 'moods']);
	});

	it('member categories can evolve (infant → toddler redirect)', async () => {
		const evolving = await addMember(userA.token, userA.familyId, {
			name: `Evolving-${Date.now()}`,
			categories: ['feeds', 'diapers', 'sleep'],
		});
		expect(evolving.categories).toEqual(['feeds', 'diapers', 'sleep']);

		const res = await app.fetch(
			new Request(`http://localhost/api/v1/families/${userA.familyId}/members/${evolving.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.token}` },
				body: JSON.stringify({ type: 'child', categories: ['routines', 'milestones', 'moods', 'journal'] }),
			}),
		);
		expect(res.status).toBe(200);

		const getRes = await getJson(userA.token, `/api/v1/families/${userA.familyId}/members`);
		const updated = (getRes.body.members ?? []).find((m: any) => m.id === evolving.id);
		expect(updated.type).toBe('child');
		expect(updated.categories).toEqual(['routines', 'milestones', 'moods', 'journal']);
	});
});

describe('milestone categories and trends', () => {
	let token: string;
	let familyId: string;
	let memberId: number;

	it('creates milestones with custom categories', async () => {
		const u = await register('mt-vitamin@example.com');
		token = u.token;
		familyId = u.familyId;
		const m = await addMember(token, familyId);
		memberId = m.id;

		const now = new Date().toISOString();
		const { status } = await postJson(token, '/api/v1/milestones', {
			memberId: memberId,
			title: 'Vitamin D drop',
			achievedDate: now,
			category: 'vitamin',
			tags: ['health', 'daily'],
		});
		expect(status).toBe(200);
	});

	it('lists milestones with custom categories', async () => {
		const res = await getJson(token, `/api/v1/milestones?memberId=${memberId}`);
		expect(res.status).toBe(200);
		const list = res.body.milestones ?? [];
		expect(list.length).toBe(1);
		expect(list[0].category).toBe('vitamin');
	});

	it('trends endpoint counts custom categories', async () => {
		const res = await getJson(token, `/api/v1/milestones/trends?memberId=${memberId}&days=7`);
		expect(res.status).toBe(200);
		expect(res.body.trends.length).toBe(1);
		expect(res.body.trends[0].category).toBe('vitamin');
		expect(res.body.trends[0].count).toBe(1);
		expect(res.body.total).toBe(1);
	});

	it('creates routines/medical with custom category', async () => {
		const now = new Date().toISOString();
		for (const cat of ['medication', 'bath', 'vitamin', 'appointment']) {
			const { status } = await postJson(token, '/api/v1/milestones', {
				memberId: memberId,
				title: `Routine: ${cat}`,
				achievedDate: now,
				category: cat,
			});
			expect(status).toBe(200);
		}
	});

	it('categories endpoint returns distinct custom categories', async () => {
		const res = await getJson(token, '/api/v1/milestones/categories');
		expect(res.status).toBe(200);
		const cats = res.body.categories.map((c: any) => c.id);
		expect(cats).toContain('vitamin');
		expect(cats).toContain('medication');
		expect(cats).toContain('bath');
		expect(cats).toContain('appointment');
	});

	it('trends shows aggregate counts', async () => {
		const res = await getJson(token, `/api/v1/milestones/trends?memberId=${memberId}&days=30`);
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(5);
		expect(res.body.trends.length).toBe(4);
	});
});

describe('formula catalog seeding', () => {
	it('seeds the default catalog into an empty family', async () => {
		const { token, familyId } = await register('mt-formula@example.com');
		await addMember(token, familyId);

		const res = await getJson(token, `/api/v1/formulas?familyId=${familyId}`);
		expect(res.status).toBe(200);
		const formulas = res.body.formulas ?? [];
		expect(formulas.length).toBeGreaterThan(10);
		expect(formulas.some((f: any) => f.brand === 'Enfamil')).toBe(true);
		expect(formulas.some((f: any) => f.brand === 'Similac')).toBe(true);
		expect(formulas.some((f: any) => f.brand === 'Kendamil')).toBe(true);
	});
});