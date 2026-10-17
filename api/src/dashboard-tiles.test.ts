// src/dashboard-tiles.test.ts
//
// The dashboard's "Today for X" panel is driven by two things the API has to
// supply: the latest record per milestone-backed kind (so a pet on medication
// can show time since the last dose) and the member's saved tile list (so the
// panel is customizable and follows them across devices).
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

const HOUR = 60 * 60 * 1000;
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR).toISOString();

let token = '';
let familyId = '';

async function newPet(name: string): Promise<number> {
	const res = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'pet', name, stage: 'pet', birthDate: '2020-01-01T00:00:00.000Z', gender: 'female',
	});
	return res.body.member.id;
}

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'dash-tiles@example.com', password: 'StrongP4ss!', firstName: 'Dash', lastName: 'Tiles',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
});

describe("a pet's last dose is on the summary", () => {
	it('reports the most recent row for each milestone-backed kind', async () => {
		const id = await newPet('Rex');
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Apoquel 16mg', achievedDate: hoursAgo(8), kind: 'medication', category: 'dose',
		});
		// A second, more recent dose: the summary must show this one, not the first.
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Apoquel 16mg', achievedDate: hoursAgo(2), kind: 'medication', category: 'dose',
		});
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Nail trim', achievedDate: hoursAgo(30), kind: 'grooming', category: 'nails',
		});

		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		expect(res.status).toBe(200);

		const { latestByKind, latestMilestoneKinds } = res.body.summary;
		expect(latestByKind.medication.title).toBe('Apoquel 16mg');
		expect(new Date(latestByKind.medication.achieved_date).getTime()).toBeCloseTo(Date.now() - 2 * HOUR, -5);
		expect(latestByKind.grooming.title).toBe('Nail trim');
		// Only one row per kind, however many doses exist.
		expect((latestMilestoneKinds as any[]).filter((r) => r.kind === 'medication')).toHaveLength(1);
	});

	it('has no entry for a kind the member has never logged', async () => {
		const id = await newPet('Quiet');
		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		expect(res.body.summary.latestMilestoneKinds).toEqual([]);
		expect(res.body.summary.latestByKind.medication).toBeUndefined();
	});
});

describe('the dashboard panel is customizable per member', () => {
	it('saves a tile list and reads it back', async () => {
		const id = await newPet('Tiled');
		const put = await call('PUT', token, `/api/v1/families/${familyId}/members/${id}`, {
			dashboardTiles: ['medication', 'grooming', 'feeds'],
		});
		expect(put.status).toBe(200);
		expect(put.body.member.dashboardTiles).toEqual(['medication', 'grooming', 'feeds']);

		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const saved = list.body.members.find((m: any) => m.id === id);
		expect(saved.dashboardTiles).toEqual(['medication', 'grooming', 'feeds']);
	});

	it('defaults to null so the panel falls back to the member categories', async () => {
		const id = await newPet('Falls back');
		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const member = list.body.members.find((m: any) => m.id === id);
		expect(member.dashboardTiles).toBeNull();
	});

	it('clears a saved list with null', async () => {
		const id = await newPet('Reset');
		await call('PUT', token, `/api/v1/families/${familyId}/members/${id}`, { dashboardTiles: ['medication'] });
		const cleared = await call('PUT', token, `/api/v1/families/${familyId}/members/${id}`, { dashboardTiles: null });
		expect(cleared.body.member.dashboardTiles).toBeNull();
	});
});

describe('the summary reports the appointments still ahead', () => {
	it('lists future appointments soonest-first and omits the ones that have passed', async () => {
		const id = await newPet('Booked');
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Vet check', achievedDate: inDays(10), kind: 'appointments', category: 'checkup',
		});
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Booster', achievedDate: inDays(3), kind: 'appointments', category: 'vaccine',
		});
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Already happened', achievedDate: hoursAgo(5), kind: 'appointments',
		});

		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		expect(res.status).toBe(200);

		// Soonest first, past excluded. This is the ordering the tile needs: it
		// promises the *next* appointment, not the furthest-out one.
		const upcoming = res.body.summary.upcomingAppointments as any[];
		expect(upcoming.map((a) => a.title)).toEqual(['Booster', 'Vet check']);

		// latestByKind is "most recent by date", which for a future appointment
		// is the *furthest* one — the reason upcomingAppointments exists as its
		// own field rather than being derived from this.
		expect(res.body.summary.latestByKind.appointments.title).toBe('Vet check');
	});

	it('is empty when nothing is booked ahead', async () => {
		const id = await newPet('Unbooked');
		await call('POST', token, '/api/v1/milestones', {
			memberId: id, title: 'Last visit', achievedDate: hoursAgo(48), kind: 'appointments',
		});
		const res = await call('GET', token, `/api/v1/health/summary/${id}`);
		expect(res.body.summary.upcomingAppointments).toEqual([]);
	});
});
