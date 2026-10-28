import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { getFamilyClient } from './namespaces';

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

let token = '';
let memberId = 0;
const BIRTH = '2026-01-01T00:00:00.000Z';
const AT_12_WEEKS = '2026-03-26T00:00:00.000Z';

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'growth-updated@example.com', password: 'StrongP4ss!', firstName: 'G', lastName: 'Stamp',
	});
	token = reg.body.token;
	const familyId = (jwt.decode(token) as any).familyId as string;
	const member = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'child', name: 'Measure', stage: 'infant', birthDate: BIRTH, gender: 'male',
	});
	memberId = member.body.member.id;
});

describe('editing a growth measurement does not rewrite its provenance (issue #55)', () => {
	it('leaves created_at alone and stamps updated_at instead', async () => {
		const made = await call('POST', token, '/api/v1/growth', {
			memberId,
			measurementDate: AT_12_WEEKS,
			weight: 8.4, unitSystem: 'metric',
		});
		expect(made.status).toBe(200);
		const id = made.body.growth.id;

		const familyId = (jwt.decode(token) as any).familyId as string;
		const db = getFamilyClient(familyId);
		const before = (await db.execute({
			sql: 'SELECT created_at, updated_at FROM growth WHERE id = ?',
			args: [id],
		})).rows[0] as Record<string, string | null>;
		expect(before.created_at).toBeTruthy();
		// Rows written before migration 40 have no updated_at yet; the edit adds it.

		await new Promise((r) => setTimeout(r, 20)); // timestamps must be able to differ
		const edited = await call('PUT', token, `/api/v1/growth/${id}`, { weight: 8.6 });
		expect(edited.status).toBe(200);

		const after = (await db.execute({
			sql: 'SELECT created_at, updated_at FROM growth WHERE id = ?',
			args: [id],
		})).rows[0] as Record<string, string | null>;
		expect(after.created_at).toBe(before.created_at); // provenance untouched
		expect(after.updated_at).toBeTruthy();           // the edit is the one stamped
	});
});