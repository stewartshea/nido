// src/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import app from './server';
import { ensureRegistry, getFamilyClient } from './db-namespaces';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function postJson(path: string, body: unknown) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function registerUser(email: string, password = 'TestPass123!') {
  return postJson('/api/v1/auth/register', {
    email,
    password,
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
}

describe('auth endpoints (registry-backed)', () => {
  describe('register', () => {
    it('provisions a family namespace and returns a routed JWT', async () => {
      const { status, body } = await registerUser('reg-flow-1@example.com');
      expect(status).toBe(200);
      expect(body.message).toBe('User registered successfully');
      expect(body.user.emailVerified).toBe(true);
      expect(body.user.id).toMatch(UUID_RE);

      const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
      expect(decoded.userId).toBe(body.user.id);
      expect(decoded.email).toBe('reg-flow-1@example.com');
      expect(decoded.familyId).toMatch(UUID_RE);
      expect(decoded.role).toBe('owner');

      // The routing row and the family namespace must both exist.
      const registry = await ensureRegistry();
      const routed = await registry.execute({
        sql: 'SELECT family_id, user_id, role FROM user_routing WHERE email = ? LIMIT 1',
        args: ['reg-flow-1@example.com'],
      });
      const route = routed.rows[0] as { family_id: string; user_id: string; role: string } | undefined;
      expect(route?.role).toBe('owner');

      const familyDb = getFamilyClient(route!.family_id);
      const userRes = await familyDb.execute({
        sql: 'SELECT email, email_verified FROM users WHERE id = ? LIMIT 1',
        args: [route!.user_id],
      });
      expect(userRes.rows.length).toBe(1);
    });

    it('rejects a duplicate email with 409', async () => {
      await registerUser('reg-dup@example.com');
      const { status, body } = await registerUser('reg-dup@example.com');
      expect(status).toBe(409);
      expect(body.error).toBe('User already exists');
    });

    it('isolates families: distinct users get distinct namespaces', async () => {
      const a = await registerUser('reg-iso-a@example.com');
      const b = await registerUser('reg-iso-b@example.com');
      const decodedA = jwt.verify(a.body.token, JWT_SECRET) as jwt.JwtPayload;
      const decodedB = jwt.verify(b.body.token, JWT_SECRET) as jwt.JwtPayload;
      expect(decodedA.familyId).not.toBe(decodedB.familyId);
    });
  });

  describe('login', () => {
    it('returns a token and camelCase user for valid credentials', async () => {
      await registerUser('login-ok@example.com');
      const { status, body } = await postJson('/api/v1/auth/login', {
        email: 'login-ok@example.com',
        password: 'TestPass123!',
      });
      expect(status).toBe(200);
      expect(body.message).toBe('Login successful');
      expect(body.token).toBeTruthy();
      expect(body.user).toMatchObject({
        email: 'login-ok@example.com',
        firstName: 'Ada',
        emailVerified: true,
      });
      expect(body.user.password_hash).toBeUndefined();

      const decoded = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
      expect(decoded.familyId).toMatch(UUID_RE);
    });

    it('rejects a wrong password with 401', async () => {
      await registerUser('login-wrong@example.com');
      const { status, body } = await postJson('/api/v1/auth/login', {
        email: 'login-wrong@example.com',
        password: 'WrongPass123!',
      });
      expect(status).toBe(401);
      expect(body.error).toBe('Invalid credentials');
    });

    it('rejects an unknown email with 401', async () => {
      const { status, body } = await postJson('/api/v1/auth/login', {
        email: 'nobody@example.com',
        password: 'TestPass123!',
      });
      expect(status).toBe(401);
      expect(body.error).toBe('Invalid credentials');
    });
  });

  describe('verify endpoint / auth guard', () => {
    it('decodes a valid token with familyId + role', async () => {
      const reg = await registerUser('verify-ok@example.com');
      const res = await app.fetch(
        new Request('http://localhost/api/v1/auth/verify', {
          headers: { Authorization: `Bearer ${reg.body.token}` },
        })
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.valid).toBe(true);
      expect(body.user.familyId).toMatch(UUID_RE);
      expect(body.user.role).toBe('owner');
    });

    it('rejects a missing token with 401', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/auth/verify'));
      expect(res.status).toBe(401);
    });

    it('rejects a token without a familyId claim', async () => {
      const token = jwt.sign({ userId: 'u1', email: 'x@example.com' }, JWT_SECRET);
      const res = await app.fetch(
        new Request('http://localhost/api/v1/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      expect(res.status).toBe(401);
    });

    it('rejects a token for an unprovisioned family', async () => {
      const token = jwt.sign(
        { userId: 'u2', email: 'y@example.com', familyId: randomUUID() },
        JWT_SECRET
      );
      const res = await app.fetch(
        new Request('http://localhost/api/v1/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      expect(res.status).toBe(401);
    });
  });

  describe('email verification flow', () => {
    beforeAll(async () => {
      const registry = await ensureRegistry();
      await registry.execute({ sql: 'INSERT OR IGNORE INTO app_settings (id) VALUES (1)', args: [] });
      await registry.execute({
        sql: 'UPDATE app_settings SET email_verification = 1, updated_at = ? WHERE id = 1',
        args: [new Date().toISOString()],
      });
    });

    afterAll(async () => {
      const registry = await ensureRegistry();
      await registry.execute({
        sql: 'UPDATE app_settings SET email_verification = 0, updated_at = ? WHERE id = 1',
        args: [new Date().toISOString()],
      });
    });

    it('registers unverified without a token', async () => {
      const { status, body } = await registerUser('verify-email-pending@example.com');
      expect(status).toBe(200);
      expect(body.requiresEmailVerification).toBe(true);
      expect(body.token).toBeUndefined();
      expect(body.user.emailVerified).toBe(false);
    });

    it('marks the user verified and unblocks login', async () => {
      await registerUser('verify-email-flow@example.com');
      const registry = await ensureRegistry();
      const routed = await registry.execute({
        sql: 'SELECT family_id, verification_token FROM user_routing WHERE email = ? LIMIT 1',
        args: ['verify-email-flow@example.com'],
      });
      const row = routed.rows[0] as { family_id: string; verification_token: string } | undefined;
      expect(row?.verification_token).toBeTruthy();

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/auth/verify-email?token=${row!.verification_token}`)
      );
      expect(res.status).toBe(200);

      // Token cleared from routing; user flagged verified in the family db.
      const cleared = await registry.execute({
        sql: 'SELECT verification_token FROM user_routing WHERE email = ? LIMIT 1',
        args: ['verify-email-flow@example.com'],
      });
      expect((cleared.rows[0] as { verification_token: unknown }).verification_token).toBeNull();

      const familyDb = getFamilyClient(row!.family_id);
      const userRes = await familyDb.execute({
        sql: 'SELECT email_verified FROM users WHERE email = ? LIMIT 1',
        args: ['verify-email-flow@example.com'],
      });
      expect(Number((userRes.rows[0] as { email_verified: unknown }).email_verified)).toBe(1);

      const login = await postJson('/api/v1/auth/login', {
        email: 'verify-email-flow@example.com',
        password: 'TestPass123!',
      });
      expect(login.status).toBe(200);
      expect(login.body.token).toBeTruthy();
    });

    it('rejects an invalid verification token with 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/v1/auth/verify-email?token=not-a-real-token')
      );
      expect(res.status).toBe(400);
    });
  });

  describe('password reset flow', () => {
    it('persists the reset token even when SMTP is unconfigured, then resets', async () => {
      await registerUser('reset-flow@example.com');
      const { status } = await postJson('/api/v1/auth/forgot-password', {
        email: 'reset-flow@example.com',
      });
      // SMTP is not configured in tests: expect 500, but the token was persisted first.
      expect(status).toBe(500);

      const registry = await ensureRegistry();
      const routed = await registry.execute({
        sql: 'SELECT reset_token FROM user_routing WHERE email = ? LIMIT 1',
        args: ['reset-flow@example.com'],
      });
      const token = String((routed.rows[0] as { reset_token: unknown }).reset_token);
      expect(token.length).toBeGreaterThan(10);

      const reset = await postJson('/api/v1/auth/reset-password', {
        token,
        password: 'NewPass123!',
      });
      expect(reset.status).toBe(200);
      expect(reset.body.message).toBe('Password updated — you can now sign in');

      const oldLogin = await postJson('/api/v1/auth/login', {
        email: 'reset-flow@example.com',
        password: 'TestPass123!',
      });
      expect(oldLogin.status).toBe(401);

      const newLogin = await postJson('/api/v1/auth/login', {
        email: 'reset-flow@example.com',
        password: 'NewPass123!',
      });
      expect(newLogin.status).toBe(200);
    });

    it('does not reveal whether an unknown email exists', async () => {
      const { status, body } = await postJson('/api/v1/auth/forgot-password', {
        email: 'ghost@example.com',
      });
      expect(status).toBe(200);
      expect(body.message).toContain('If that email exists');
    });

    it('rejects an invalid reset token with 400', async () => {
      const { status, body } = await postJson('/api/v1/auth/reset-password', {
        token: 'invalid-token-value',
        password: 'NewPass123!',
      });
      expect(status).toBe(400);
      expect(body.error).toBe('Invalid or expired reset token');
    });
  });
});