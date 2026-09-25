import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { ensureRegistry } from '../db-namespaces';
import { isPlatformAdmin } from '../authz';
import { type AuthEnv } from '../auth';

const userRoutes = new Hono<AuthEnv>();

// Zod schemas for validation
const updateUserSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// Get current user
userRoutes.get('/me', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    
    const userResult = await db.execute({
      sql: 'SELECT id, email, first_name, last_name, created_at FROM users WHERE id = ?',
      args: [userId]
    });
    
    if (userResult.rows.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    const user = userResult.rows[0];
    const admin = await isPlatformAdmin(userId);

    const registry = await ensureRegistry();
    const familiesResult = await registry.execute({
      sql: `SELECT f.family_id, f.name, f.family_code, fr.role
            FROM families f
            JOIN user_routing fr ON fr.family_id = f.family_id
            WHERE fr.user_id = ?`,
      args: [userId],
    });
    const families = familiesResult.rows.map((r) => ({
      familyId: r?.family_id,
      name: r?.name,
      familyCode: r?.family_code,
      role: r?.role,
    }));

    return c.json({ user: { ...user, is_platform_admin: admin ? 1 : 0 }, families });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

// Update user profile
userRoutes.put('/me', zValidator('json', updateUserSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.get('db');
    
    const { firstName, lastName, email } = c.req.valid('json');
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (firstName !== undefined) {
      updates.push('first_name = ?');
      params.push(firstName);
    }
    
    if (lastName !== undefined) {
      updates.push('last_name = ?');
      params.push(lastName);
    }
    
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email);
    }
    
    if (updates.length === 0) {
      return c.json({ message: 'No updates provided' });
    }
    
    // Add updated_at timestamp
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(userId); // For WHERE clause
    
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute({
      sql,
      args: params
    });
    
    // Sync email change to the registry so login-by-email keeps working.
    if (email !== undefined) {
      const registry = await ensureRegistry();
      await registry.execute({
        sql: 'UPDATE user_routing SET email = ? WHERE user_id = ?',
        args: [email, userId],
      });
    }
    
    // Return updated user
    const userResult = await db.execute({
      sql: 'SELECT id, email, first_name, last_name, created_at, updated_at FROM users WHERE id = ?',
      args: [userId]
    });
    
    if (userResult.rows.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    const user = userResult.rows[0];
    return c.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

// POST /me/password — change the authenticated user's password.
userRoutes.post('/me/password', zValidator('json', changePasswordSchema), async (c) => {
  const userId = c.get('userId');
  const db = c.get('db');

  const { currentPassword, newPassword } = c.req.valid('json');

  const res = await db.execute({
    sql: 'SELECT id, password_hash FROM users WHERE id = ?',
    args: [userId],
  });
  const row = res.rows[0];
  if (!row) return c.json({ error: 'User not found' }, 404);

  const ok = await bcrypt.compare(currentPassword, String(row.password_hash));
  if (!ok) return c.json({ error: 'Current password is incorrect' }, 400);

  const hash = await bcrypt.hash(newPassword, 10);
  await db.execute({
    sql: 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    args: [hash, new Date().toISOString(), userId],
  });
  return c.json({ message: 'Password updated' });
});

export { userRoutes };