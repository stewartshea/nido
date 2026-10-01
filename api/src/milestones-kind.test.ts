import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('milestone kind', () => {
	let token = '';
	let memberId = 0;

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'milestone-kind@example.com',
			password: 'StrongP4ss!',
			firstName: 'Kind',
			lastName: 'Tester',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Kind Baby',
			birthDate: '2024-01-01T00:00:00.000Z',
			gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('keeps a routine from being stored as a milestone', async () => {
		const created = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Morning bath',
			achievedDate: '2026-09-30T08:00:00.000Z',
			kind: 'routines',
			category: 'bath',
		});
		expect(created.status).toBe(200);
		expect(created.body.milestone.kind).toBe('routines');
		expect(created.body.milestone.category).toBe('bath');
	});

	it('stores a routine with a category that a milestone would also use', async () => {
		// "other" exists in every vocabulary, so only the kind can disambiguate.
		const routine = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Extra tummy time',
			achievedDate: '2026-09-30T09:00:00.000Z',
			kind: 'routines',
			category: 'other',
		});
		const milestone = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Something else',
			achievedDate: '2026-09-30T10:00:00.000Z',
			kind: 'milestones',
			category: 'other',
		});
		expect(routine.body.milestone.kind).toBe('routines');
		expect(milestone.body.milestone.kind).toBe('milestones');

		const list = await call('GET', token, `/api/v1/milestones?memberId=${memberId}`);
		const byTitle = Object.fromEntries(list.body.milestones.map((m: any) => [m.title, m]));
		expect(byTitle['Extra tummy time'].kind).toBe('routines');
		expect(byTitle['Something else'].kind).toBe('milestones');
	});

	it('defaults to milestones when no kind is sent', async () => {
		const created = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Uncategorised',
			achievedDate: '2026-09-30T11:00:00.000Z',
		});
		expect(created.body.milestone.kind).toBe('milestones');
	});

	it('rejects an unknown kind', async () => {
		const res = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Bad',
			achievedDate: '2026-09-30T11:00:00.000Z',
			kind: 'nonsense',
		});
		expect(res.status).toBe(400);
	});

	it('can move a record between kinds on update', async () => {
		const created = await call('POST', token, '/api/v1/milestones', {
			memberId,
			title: 'Moved later',
			achievedDate: '2026-09-30T12:00:00.000Z',
			kind: 'milestones',
			category: 'other',
		});
		const id = created.body.milestone.id;
		const updated = await call('PUT', token, `/api/v1/milestones/${id}`, { kind: 'routines' });
		expect(updated.body.milestone.kind).toBe('routines');
	});
});
