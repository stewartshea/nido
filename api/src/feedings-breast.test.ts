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

describe('per-breast timing on feedings', () => {
	let token = '';
	let memberId = 0;

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'breast-timing@example.com',
			password: 'StrongP4ss!',
			firstName: 'Breast',
			lastName: 'Tester',
		});
		token = reg.body.token;
		const familyId = (jwt.decode(token) as any).familyId as string;
		const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Timing Baby',
			birthDate: '2024-01-01T00:00:00.000Z',
			gender: 'female',
		});
		memberId = member.body.member.id;
	});

	it('returns per-breast timestamps and durations from the list endpoint', async () => {
		const created = await call('POST', token, '/api/v1/feedings', {
			memberId,
			startTime: '2026-09-29T10:00:00.000Z',
			endTime: '2026-09-29T10:20:00.000Z',
			type: 'breast',
			side: 'both',
			leftBreastAt: '2026-09-29T10:08:00.000Z',
			rightBreastAt: '2026-09-29T10:20:00.000Z',
			leftDuration: 480000,
			rightDuration: 720000,
		});
		expect(created.status).toBe(200);

		const list = await call('GET', token, `/api/v1/feedings?memberId=${memberId}`);
		expect(list.status).toBe(200);
		const row = list.body.feedings[0];
		expect(row.left_breast_at).toBe('2026-09-29T10:08:00.000Z');
		expect(row.right_breast_at).toBe('2026-09-29T10:20:00.000Z');
		expect(row.left_duration).toBe(480000);
		expect(row.right_duration).toBe(720000);
	});

	it('clears the per-breast split when PUT is given nulls', async () => {
		const created = await call('POST', token, '/api/v1/feedings', {
			memberId,
			startTime: '2026-09-29T11:00:00.000Z',
			type: 'breast',
			side: 'both',
			leftBreastAt: '2026-09-29T11:05:00.000Z',
			rightBreastAt: '2026-09-29T11:10:00.000Z',
			leftDuration: 300000,
			rightDuration: 300000,
		});
		const id = created.body.feeding.id;

		const put = await call('PUT', token, `/api/v1/feedings/${id}`, {
			side: 'left',
			leftBreastAt: '2026-09-29T11:02:00.000Z',
			rightBreastAt: null,
			leftDuration: 120000,
			rightDuration: null,
		});
		expect(put.status).toBe(200);
		expect(put.body.feeding.side).toBe('left');
		expect(put.body.feeding.right_breast_at).toBeNull();
		expect(put.body.feeding.right_duration).toBeNull();
		expect(put.body.feeding.left_duration).toBe(120000);
	});

	it('returns them from GET by id and persists them through PUT', async () => {
		const created = await call('POST', token, '/api/v1/feedings', {
			memberId,
			startTime: '2026-09-29T12:00:00.000Z',
			type: 'breast',
			side: 'left',
		});
		const id = created.body.feeding.id;

		const put = await call('PUT', token, `/api/v1/feedings/${id}`, {
			leftBreastAt: '2026-09-29T12:05:00.000Z',
			leftDuration: 300000,
		});
		expect(put.status).toBe(200);
		expect(put.body.feeding.left_breast_at).toBe('2026-09-29T12:05:00.000Z');
		expect(put.body.feeding.left_duration).toBe(300000);

		const got = await call('GET', token, `/api/v1/feedings/${id}`);
		expect(got.body.feeding.left_breast_at).toBe('2026-09-29T12:05:00.000Z');
		expect(got.body.feeding.left_duration).toBe(300000);
	});
});
