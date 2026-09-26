// src/family-invite.test.ts
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { ensureRegistry, getFamilyClient } from './db-namespaces';
import { NAMESPACE_HOUSEHOLD_ID } from './db-core';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';
const TS = '2026-01-01T00:00:00.000Z';

interface Account {
	email: string;
	token: string;
	userId: string;
	familyId: string;
}

async function postJson(path: string, body: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function postAs(token: string, path: string, body: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function register(email: string): Promise<Account> {
	const { status, body } = await postJson('/api/v1/auth/register', {
		email,
		password: 'TestPass123!',
		firstName: 'Ada',
		lastName: 'Lovelace',
	});
	expect(status).toBe(200);
	const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
	return { email, token: body.token, userId: String(decoded.userId), familyId: String(decoded.familyId) };
}

async function seedInvitation(hostFamilyId: string, email: string, inviterId: string, token: string, status = 'pending') {
	const hostDb = getFamilyClient(hostFamilyId);
	await hostDb.execute({
		sql: `INSERT INTO family_invitations (family_id, email, inviter_user_id, token, status, created_at)
		      VALUES (?, ?, ?, ?, ?, ?)`,
		args: [NAMESPACE_HOUSEHOLD_ID, email, inviterId, token, status, TS],
	});
	return token;
}

describe('family invitations', () => {
	describe('POST /families/invitations', () => {
		// The original handler inserted a row and replied "Invitation sent"
		// without ever calling sendMail, so the UI reported success for a mail
		// that did not exist. With no SMTP configured it must now fail loudly
		// and still hand back the link.
		it('reports failure instead of claiming an email was sent', async () => {
			const owner = await register('inviter-fail@example.com');
			const { status, body } = await postAs(owner.token, '/api/v1/families/invitations', {
				email: 'guest@example.com',
			});
			expect(status).toBe(503);
			expect(body.message).toBeUndefined();
			expect(body.error).toBeTruthy();
			expect(body.invitation.token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
		});

		it('reuses the existing token when re-inviting rather than colliding', async () => {
			const owner = await register('inviter-resend@example.com');
			const first = await postAs(owner.token, '/api/v1/families/invitations', { email: 'twice@example.com' });
			const second = await postAs(owner.token, '/api/v1/families/invitations', { email: 'twice@example.com' });
			expect(second.status).toBe(503);
			expect(second.body.invitation.token).toBe(first.body.invitation.token);
		});
	});

	describe('POST /families/join', () => {
		it('requires authentication', async () => {
			const owner = await register('join-auth-owner@example.com');
			const token = await seedInvitation(owner.familyId, 'x@example.com', owner.userId, 'tok-auth-1');
			const { status } = await postJson('/api/v1/families/join', { familyId: owner.familyId, token });
			expect(status).toBe(401);
		});

		it('validates the request body', async () => {
			const owner = await register('join-body-owner@example.com');
			const { status } = await postAs(owner.token, '/api/v1/families/join', {});
			expect(status).toBe(400);
		});

		it('rejects an unknown token', async () => {
			const owner = await register('join-tok-owner@example.com');
			const guest = await register('join-tok-guest@example.com');
			const { status, body } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token: 'not-a-real-token',
			});
			expect(status).toBe(404);
			expect(body.error).toMatch(/not valid/i);
		});

		// A leaked link must not be redeemable by whoever finds it.
		it('rejects a token redeemed by a different account', async () => {
			const owner = await register('join-mismatch-owner@example.com');
			const guest = await register('join-mismatch-guest@example.com');
			const token = await seedInvitation(owner.familyId, 'intended@example.com', owner.userId, 'tok-mismatch');
			const { status, body } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token,
			});
			expect(status).toBe(403);
			expect(body.error).toMatch(/different email/i);
		});

		it('rejects an already-accepted invitation', async () => {
			const owner = await register('join-used-owner@example.com');
			const guest = await register('join-used-guest@example.com');
			const token = await seedInvitation(owner.familyId, guest.email, owner.userId, 'tok-used', 'accepted');
			const { status, body } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token,
			});
			expect(status).toBe(409);
			expect(body.error).toMatch(/already been used/i);
		});

		// Joining deletes the joiner's own namespace, so tracked data must block
		// it rather than be destroyed along with the file.
		it('refuses to join when the joiner still has tracked data', async () => {
			const owner = await register('join-data-owner@example.com');
			const guest = await register('join-data-guest@example.com');
			const token = await seedInvitation(owner.familyId, guest.email, owner.userId, 'tok-data');
			const guestDb = getFamilyClient(guest.familyId);
			await guestDb.execute({
				sql: 'INSERT INTO babies (household_id, name) VALUES (?, ?)',
				args: [NAMESPACE_HOUSEHOLD_ID, 'Charlie'],
			});

			const { status, body } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token,
			});
			expect(status).toBe(409);
			expect(body.error).toMatch(/still has tracked data/i);

			// The guest's data and routing must be untouched by the refusal.
			const registry = await ensureRegistry();
			const routed = await registry.execute({
				sql: 'SELECT family_id FROM user_routing WHERE user_id = ? LIMIT 1',
				args: [guest.userId],
			});
			expect(String(routed.rows[0]?.family_id)).toBe(guest.familyId);
		});

		it('moves the account into the inviting family and reissues its token', async () => {
			const owner = await register('join-ok-owner@example.com');
			const guest = await register('join-ok-guest@example.com');
			const token = await seedInvitation(owner.familyId, guest.email, owner.userId, 'tok-ok');

			const { status, body } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token,
			});
			expect(status).toBe(200);
			expect(body.message).toMatch(/joined the family/i);

			// The reissued token must carry the NEW family, otherwise every later
			// request keeps routing to the deleted namespace.
			const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
			expect(decoded.familyId).toBe(owner.familyId);
			expect(decoded.userId).toBe(guest.userId);
			expect(decoded.role).toBe('member');

			const registry = await ensureRegistry();
			const routed = await registry.execute({
				sql: 'SELECT family_id FROM user_routing WHERE user_id = ? LIMIT 1',
				args: [guest.userId],
			});
			expect(String(routed.rows[0]?.family_id)).toBe(owner.familyId);

			// user_households is what authorises every data query, so membership
			// is not real until this row exists in the host family.
			const hostDb = getFamilyClient(owner.familyId);
			const member = await hostDb.execute({
				sql: 'SELECT role FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
				args: [guest.userId, NAMESPACE_HOUSEHOLD_ID],
			});
			expect(member.rows.length).toBe(1);
			expect(String(member.rows[0]?.role)).toBe('member');

			const invite = await hostDb.execute({
				sql: 'SELECT status, accepted_at FROM family_invitations WHERE token = ? LIMIT 1',
				args: [token],
			});
			expect(String(invite.rows[0]?.status)).toBe('accepted');
			expect(invite.rows[0]?.accepted_at).toBeTruthy();

			// The old namespace is deliberately NOT deleted: it may still hold other
			// members and their data, so the account is only detached from it.
			const oldFamily = await registry.execute({
				sql: 'SELECT family_id FROM families WHERE family_id = ? LIMIT 1',
				args: [guest.familyId],
			});
			expect(oldFamily.rows.length).toBe(1);

			const oldDb = getFamilyClient(guest.familyId);
			const stillMember = await oldDb.execute({
				sql: 'SELECT 1 FROM user_households WHERE user_id = ? LIMIT 1',
				args: [guest.userId],
			});
			expect(stillMember.rows.length).toBe(0);
		});

		// Routing is authoritative, so redeeming into the family you are already
		// routed at is the partial-failure retry path rather than an error. It
		// still has to present a real pending invitation addressed to this account.
		it('rejects a bad token even when already routed at the target family', async () => {
			const owner = await register('join-same@example.com');
			const { status, body } = await postAs(owner.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token: 'whatever',
			});
			expect(status).toBe(404);
			expect(body.error).toMatch(/not valid/i);
		});

		it('completes a pending invitation when already routed at the target family', async () => {
			const owner = await register('join-retry@example.com');
			const token = await seedInvitation(owner.familyId, owner.email, owner.userId, 'tok-retry');

			const { status, body } = await postAs(owner.token, '/api/v1/families/join', {
				familyId: owner.familyId,
				token,
			});
			expect(status).toBe(200);
			expect(body.token).toBeTruthy();

			const hostDb = getFamilyClient(owner.familyId);
			const invite = await hostDb.execute({
				sql: 'SELECT status FROM family_invitations WHERE token = ? LIMIT 1',
				args: [token],
			});
			expect(String(invite.rows[0]?.status)).toBe('accepted');
		});

		it('refuses to redeem an invitation for an unregistered family id', async () => {
			const guest = await register('join-unknown-family@example.com');
			const { status } = await postAs(guest.token, '/api/v1/families/join', {
				familyId: '11111111-2222-3333-4444-555555555555',
				token: 'tok-unknown',
			});
			expect(status).toBe(404);
		});
	});
});
