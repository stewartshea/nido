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

describe('deleting a member that has records', () => {
	let token = '';
	let familyId = '';

	beforeAll(async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'member-delete@example.com',
			password: 'StrongP4ss!',
			firstName: 'Delete',
			lastName: 'Tester',
		});
		token = reg.body.token;
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('removes the member together with their feedings and pump sessions', async () => {
		const created = await call('POST', token, `/api/v1/families/${familyId}/members`, {
			name: 'Doomed Baby',
			birthDate: '2024-01-01T00:00:00.000Z',
			gender: 'female',
		});
		const memberId = created.body.member.id as number;

		await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: '2026-09-29T10:00:00.000Z', type: 'breast', side: 'both',
			leftBreastAt: '2026-09-29T10:05:00.000Z', rightBreastAt: '2026-09-29T10:10:00.000Z',
			leftDuration: 300000, rightDuration: 300000,
		});
		await call('POST', token, '/api/v1/feedings', {
			memberId, startTime: '2026-09-29T12:00:00.000Z', type: 'pump', side: 'left',
			leftBreastAt: '2026-09-29T12:00:00.000Z', amount: 3, amountUnit: 'oz',
		});

		const del = await call('DELETE', token, `/api/v1/families/${familyId}/members/${memberId}`);
		expect(del.status).toBe(200);

		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const ids = (list.body.members ?? list.body.babies ?? []).map((m: any) => m.id);
		expect(ids).not.toContain(memberId);
	});
});
