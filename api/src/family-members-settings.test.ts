import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';

async function requestJson(method: string, path: string, token: string | null, body?: unknown) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	const json = await res.json();
	return { status: res.status, body: json as Record<string, any> };
}

async function register(email: string) {
	const out = await requestJson('POST', '/api/v1/auth/register', null, {
		email,
		password: 'TestPass123!',
		firstName: 'Taylor',
		lastName: 'Rivera',
	});
	expect(out.status).toBe(200);
	const decoded = jwt.verify(String(out.body.token), JWT_SECRET) as jwt.JwtPayload;
	return {
		token: String(out.body.token),
		familyId: String(decoded.familyId),
	};
}

describe('family members + settings', () => {
	it('defaults anonymized sharing to off and returns a preview payload', async () => {
		const owner = await register('settings-preview-owner@example.com');
		const res = await requestJson('GET', `/api/v1/families/${owner.familyId}/settings`, owner.token);
		expect(res.status).toBe(200);
		expect(res.body.settings.shareAnonymizedDaily).toBe(false);
		expect(res.body.anonymizedPreview.windowHours).toBe(24);
		expect(typeof res.body.anonymizedPreview.generatedAt).toBe('string');
		expect(res.body.anonymizedPreview.totals).toBeTruthy();
	});

	it('enables anonymized sharing and exposes member/account linkage fields', async () => {
		const owner = await register('settings-link-owner@example.com');

		const add = await requestJson('POST', `/api/v1/families/${owner.familyId}/members`, owner.token, {
			type: 'adult',
			name: 'Taylor Rivera',
			email: 'settings-link-owner@example.com',
		});
		expect(add.status).toBe(201);
		expect(add.body.member.type).toBe('adult');
		expect(add.body.member.trackable).toBe(false);
		expect(add.body.member.linkedAccount).toBe(true);
		expect(add.body.member.legacyBabyId).toBeNull();

		const update = await requestJson('PUT', `/api/v1/families/${owner.familyId}/settings`, owner.token, {
			shareAnonymizedDaily: true,
		});
		expect(update.status).toBe(200);
		expect(update.body.settings.shareAnonymizedDaily).toBe(true);

		const preview = await requestJson('GET', `/api/v1/families/${owner.familyId}/settings/anonymized-preview`, owner.token);
		expect(preview.status).toBe(200);
		expect(preview.body.preview.windowHours).toBe(24);
		expect(preview.body.preview.totals.members).toBeGreaterThanOrEqual(1);
	});
});
