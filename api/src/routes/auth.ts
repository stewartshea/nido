import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import {
  ensureRegistry,
  getFamilyClient,
  provisionFamily,
  removeFamily,
} from '../db-namespaces';
import { getAppSettings, sendMail, baseUrl, effectiveSignup } from '../mail';
import { jwtSecret } from '../auth';

const authRoutes = new Hono();

function newToken(): string {
	return randomBytes(32).toString('hex');
}

// Zod schemas for validation
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string(),
  lastName: z.string(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
});

// Row shapes for the routing / family lookups below.
type RouteRow = { family_id: string; user_id: string; role: string };
type FamilyUserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  email_verified: number;
};

// Register endpoint
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  try {
    const { email, password, firstName, lastName } = c.req.valid('json');

    // Instance-level signup switch (env override, else DB setting).
    const settings = await getAppSettings();
    const signupPolicy = effectiveSignup(settings);
    if (!signupPolicy.enabled) {
      return c.json({ error: 'New account signup is currently disabled by the administrator' }, 403);
    }

    // The registry is the single source of truth for account existence.
    const registry = await ensureRegistry();
    const existingUserResult = await registry.execute({
      sql: 'SELECT id FROM user_routing WHERE email = ? LIMIT 1',
      args: [email],
    });
    if (existingUserResult.rows.length > 0) {
      return c.json({ error: 'User already exists' }, 409);
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const verificationNeeded = Number(settings.email_verification ?? 0) === 1;
    const verificationToken = verificationNeeded ? newToken() : null;
    const verificationExpires = verificationNeeded ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : null;

    const familyId = randomUUID();
    const userId = randomUUID();
    const now = new Date().toISOString();

    // Create the namespace first; any later failure rolls the whole thing back
    // so a family never exists without its routed owner.
    try {
      const familyDb = await provisionFamily(familyId, `${lastName} Family`);
      await familyDb.execute({
        sql: `
          INSERT INTO users (id, email, password_hash, first_name, last_name, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [userId, email, hashedPassword, firstName, lastName, verificationNeeded ? 0 : 1, now, now],
      });
      await familyDb.execute({
        sql: 'INSERT INTO user_households (user_id, household_id, role) VALUES (?, ?, ?)',
        args: [userId, NAMESPACE_HOUSEHOLD_ID, 'owner'],
      });
      await registry.execute({
        sql: `
          INSERT INTO user_routing (id, email, family_id, user_id, role, is_platform_admin, verification_token, verification_expires, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `,
        args: [randomUUID(), email, familyId, userId, 'owner', verificationToken, verificationExpires, now, now],
      });
    } catch (err) {
      await removeFamily(familyId).catch(() => {});
      throw err;
    }

    if (verificationNeeded) {
      try {
        await sendMail(settings, email, 'Verify your Nido email', [
          `Hi ${firstName},`,
          '',
          'Confirm your Nido account by opening the link below (valid 24 hours):',
          `${baseUrl()}/?verify=${verificationToken}`,
          '',
          'If you did not create this account, you can ignore this email.',
        ].join('\n'));
      } catch (mailErr) {
        // SMTP may be misconfigured; do not block registration, but surface the state.
        console.error('Verification email failed to send:', mailErr);
      }
      return c.json({
        message: 'User registered — check your email to verify your account',
        requiresEmailVerification: true,
        user: { id: userId, email, firstName, lastName, emailVerified: false },
      });
    }

    // Generate JWT carrying the familyId the guard routes on.
    const token = jwt.sign(
      { userId, email, familyId, role: 'owner' },
      jwtSecret(),
      { expiresIn: '24h' }
    );

    return c.json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        email,
        firstName,
        lastName,
        emailVerified: true,
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ error: 'Registration failed' }, 500);
  }
});

// Verify email
authRoutes.get('/verify-email', async (c) => {
  const token = c.req.query('token') || '';
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: `SELECT family_id, user_id FROM user_routing WHERE verification_token = ? AND verification_expires > ? LIMIT 1`,
    args: [token, new Date().toISOString()],
  });
  const row = res.rows[0] as RouteRow | undefined;
  if (!row) return c.json({ message: 'Invalid or expired verification link' }, 400);

  const familyDb = getFamilyClient(row.family_id);
  await familyDb.execute({
    sql: `UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), row.user_id],
  });
  await registry.execute({
    sql: `UPDATE user_routing SET verification_token = NULL, verification_expires = NULL, updated_at = ? WHERE user_id = ?`,
    args: [new Date().toISOString(), row.user_id],
  });
  return c.json({ message: 'Email verified — you can now sign in' });
});

// Request a password reset
authRoutes.post('/forgot-password', zValidator('json', forgotSchema), async (c) => {
  const { email } = c.req.valid('json');
  const settings = await getAppSettings();
  const registry = await ensureRegistry();

  const userRes = await registry.execute({
    sql: 'SELECT family_id, user_id FROM user_routing WHERE email = ? LIMIT 1',
    args: [email],
  });
  const row = userRes.rows[0] as RouteRow | undefined;
  if (!row) {
    // Do not reveal whether the account exists; same response either way.
    return c.json({ message: 'If that email exists, a reset link has been sent' });
  }

  const familyDb = getFamilyClient(row.family_id);
  const nameRes = await familyDb.execute({
    sql: 'SELECT first_name FROM users WHERE id = ? LIMIT 1',
    args: [row.user_id],
  });
  const firstName = String(nameRes.rows[0]?.first_name ?? 'there');

  const token = newToken();
  await registry.execute({
    sql: 'UPDATE user_routing SET reset_token = ?, reset_expires = ? WHERE user_id = ?',
    args: [token, new Date(Date.now() + 3600 * 1000).toISOString(), row.user_id],
  });

  // The token is persisted before sendMail; a broken SMTP config yields a 500
  // but the link stays valid so operators can still complete the reset.
  try {
    await sendMail(settings, email, 'Reset your Nido password', [
      `Hi ${firstName},`,
      '',
      'Reset your password by opening the link below (valid 1 hour):',
      `${baseUrl()}/?reset=${token}`,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n'));
  } catch (mailErr) {
    console.error('Reset email failed to send:', mailErr);
    return c.json({ error: 'SMTP is not configured — reset emails cannot be sent' }, 500);
  }
  return c.json({ message: 'If that email exists, a reset link has been sent' });
});

// Complete a password reset
authRoutes.post('/reset-password', zValidator('json', resetSchema), async (c) => {
  const { token, password } = c.req.valid('json');
  const registry = await ensureRegistry();
  const res = await registry.execute({
    sql: `SELECT family_id, user_id FROM user_routing WHERE reset_token = ? AND reset_expires > ? LIMIT 1`,
    args: [token, new Date().toISOString()],
  });
  const row = res.rows[0] as RouteRow | undefined;
  if (!row) return c.json({ error: 'Invalid or expired reset token' }, 400);

  const hashedPassword = await bcrypt.hash(password, 10);
  const familyDb = getFamilyClient(row.family_id);
  await familyDb.execute({
    sql: `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    args: [hashedPassword, new Date().toISOString(), row.user_id],
  });
  await registry.execute({
    sql: `UPDATE user_routing SET reset_token = NULL, reset_expires = NULL, updated_at = ? WHERE user_id = ?`,
    args: [new Date().toISOString(), row.user_id],
  });
  return c.json({ message: 'Password updated — you can now sign in' });
});

// Login endpoint
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  try {
    const { email, password } = c.req.valid('json');

    // Route first: which family namespace owns this email?
    const registry = await ensureRegistry();
    const routeResult = await registry.execute({
      sql: 'SELECT family_id, user_id, role FROM user_routing WHERE email = ? LIMIT 1',
      args: [email],
    });
    const route = routeResult.rows[0] as RouteRow | undefined;
    if (!route) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const userResult = await getFamilyClient(route.family_id).execute({
      sql: 'SELECT id, email, password_hash, first_name, last_name, email_verified FROM users WHERE id = ? LIMIT 1',
      args: [route.user_id],
    });
    const user = userResult.rows[0] as FamilyUserRow | undefined;
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Generate JWT carrying the familyId the guard routes on.
    const token = jwt.sign(
      { userId: user.id, email: user.email, familyId: route.family_id, role: route.role },
      jwtSecret(),
      { expiresIn: '24h' }
    );

    return c.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: Number(user.email_verified) === 1,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// Verify token endpoint — decoded payload now carries familyId + role for the web client.
authRoutes.get('/verify', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtSecret());
    return c.json({ valid: true, user: decoded });
  } catch (error) {
    return c.json({ valid: false, error: 'Invalid token' }, 401);
  }
});

export { authRoutes };