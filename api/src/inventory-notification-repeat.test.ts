// src/inventory-notification-repeat.test.ts
//
// Regression: when two rules match the same item, the digest must record every
// rule as told. It used to key its bookkeeping by item, so all but one rule
// fell through and re-fired on every run — the "notifications fire again and
// again" bug. The email copy promises an unchanged item will not keep emailing.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { runFamilyDigest } from './notifications';

// A digest only sends when SMTP is configured. Stub the mail seam so the test
// exercises delivery bookkeeping, not a real SMTP server.
const { sent } = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }));
vi.mock('./mail', () => ({
	getAppSettings: async () => ({
		id: 1, signup_enabled: 1, email_verification: 0,
		smtp_host: 'smtp.test', smtp_port: 2525,
		smtp_user: null, smtp_pass: null, smtp_from: null,
	}),
	smtpConfigured: () => true,
	effectiveSignup: () => ({ enabled: true, envLocked: false }),
	sendMail: async (_settings: unknown, to: string, message: { subject: string }) => {
		sent.push({ to, subject: message.subject });
	},
	baseUrl: () => 'http://localhost:3001',
}));

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

let token = '';
let familyId = '';
let memberId = 0;

beforeAll(async () => {
	const reg = await call('', 'POST', '/api/v1/auth/register', {
		email: 'repeat@example.com', password: 'StrongP4ss!', firstName: 'Re', lastName: 'Peat',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;

	const member = await call(token, 'POST', `/api/v1/families/${familyId}/members`, {
		name: 'Kid', birthDate: '2025-01-01T00:00:00.000Z', gender: 'female',
	});
	memberId = member.body.member.id;
});

describe('a digest records every rule that matched, not just one per item', () => {
	it('does not re-send a second rule on the same item', async () => {
		const item = await call(token, 'POST', '/api/v1/inventory', {
			memberId, name: 'Wipes', category: 'baby_care', quantity: 1, unit: 'pack',
		});
		const itemId = item.body.item.id;

		// Two rules on one item, both trivially true.
		const a = await call(token, 'POST', '/api/v1/inventory/rules', {
			itemId, signal: 'quantity', comparator: 'lte', threshold: 5,
		});
		const b = await call(token, 'POST', '/api/v1/inventory/rules', {
			itemId, signal: 'quantity', comparator: 'lte', threshold: 99,
		});
		expect(a.status).toBe(201);
		expect(b.status).toBe(201);

		const t0 = Date.now();
		const first = await runFamilyDigest(familyId, { nowMs: t0 });
		expect(first.sent).toBe(1);
		expect(first.alerts).toBe(2);

		// Same item, same rules, two hours later: the hourly cadence window has
		// passed but nothing changed, so there is nothing to send.
		const second = await runFamilyDigest(familyId, { nowMs: t0 + 2 * 3_600_000 });
		expect(second.sent).toBe(0);
		expect(second.alerts).toBe(0);
		expect(sent.length).toBe(1);
	});
});
