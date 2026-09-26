import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ensureRegistry } from '../db-namespaces';
import { getAppSettings, sendMail, effectiveSignup } from '../mail';
import { renderSmtpTestEmail } from '../mail-templates';
import { isPlatformAdmin } from '../authz';
import { type AuthEnv } from '../auth';

const settingsRoutes = new Hono<AuthEnv>();

const updateSettingsSchema = z.object({
	signupEnabled: z.boolean().optional(),
	emailVerification: z.boolean().optional(),
	smtpHost: z.string().max(255).nullable().optional(),
	smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
	smtpUser: z.string().max(255).nullable().optional(),
	smtpPass: z.string().max(1024).nullable().optional(),
	smtpFrom: z.string().email().nullable().optional(),
});

function snakeToCamel(row: any) {
	const signup = effectiveSignup(row as any);
	return {
		signupEnabled: signup.enabled,
		signupEnvLocked: signup.envLocked,
		signupDbValue: Number(row?.signup_enabled ?? 1) === 1,
		emailVerification: Number(row?.email_verification ?? 0) === 1,
		smtpHost: row?.smtp_host ?? null,
		smtpPort: row?.smtp_port ? Number(row.smtp_port) : null,
		smtpUser: row?.smtp_user ?? null,
		smtpFrom: row?.smtp_from ?? null,
		smtpConfigured: !!(row?.smtp_host && row?.smtp_port),
	};
}

settingsRoutes.get('/', async (c) => {
	return c.json({ settings: snakeToCamel((await getAppSettings())) });
});

settingsRoutes.put('/', zValidator('json', updateSettingsSchema), async (c) => {
	const userId = c.get('userId');
	const registry = await ensureRegistry();

	// Only an owner of any family may change instance settings.
	if (!(await isPlatformAdmin(userId))) return c.json({ error: "Platform admin access required" }, 403);

	const { signupEnabled, emailVerification, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = c.req.valid('json');

	const current = await getAppSettings();
	const updates: string[] = [];
	const params: Array<number | string | null> = [];
	const set = (col: string, v: number | string | null | undefined) => {
		if (v !== undefined) { updates.push(`${col} = ?`); params.push(v); }
	};
	if (signupEnabled !== undefined) set('signup_enabled', signupEnabled ? 1 : 0);
	if (emailVerification !== undefined) set('email_verification', emailVerification ? 1 : 0);
	if (smtpHost !== undefined) set('smtp_host', smtpHost ?? null);
	if (smtpPort !== undefined) set('smtp_port', smtpPort ?? null);
	if (smtpUser !== undefined) set('smtp_user', smtpUser ?? null);
	if (smtpPass !== undefined) set('smtp_pass', smtpPass ?? null);
	if (smtpFrom !== undefined) set('smtp_from', smtpFrom ?? null);
	if (updates.length > 0) {
		updates.push('updated_at = ?');
		params.push(new Date().toISOString());
		await registry.execute({ sql: `UPDATE app_settings SET ${updates.join(', ')} WHERE id = 1`, args: params });
	}

	const fresh = await getAppSettings();
	return c.json({ message: 'Settings saved', settings: snakeToCamel(fresh) });
});

// POST /test — send a test email to the caller (platform admin only).
settingsRoutes.post('/test', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	if (!(await isPlatformAdmin(userId))) return c.json({ error: "Platform admin access required" }, 403);

	const s = await getAppSettings();
	if (!s.smtp_host || !s.smtp_port) return c.json({ error: 'SMTP is not configured' }, 400);

	const userRes = await db.execute({ sql: 'SELECT email FROM users WHERE id = ?', args: [userId] });
	const to = String(userRes.rows[0]?.email || '');
	try {
		await sendMail(s, to, renderSmtpTestEmail({ to }));
		return c.json({ message: `Test email sent to ${to}` });
	} catch (e: any) {
		return c.json({ error: `Failed to send test email: ${String(e?.message || e).slice(0, 200)}` }, 500);
	}
});

export { settingsRoutes };