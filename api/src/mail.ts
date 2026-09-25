import nodemailer from 'nodemailer';
import { getRegistryClient } from './db-namespaces';

export interface AppSettings {
	id: number;
	signup_enabled: number;
	email_verification: number;
	smtp_host: string | null;
	smtp_port: number | null;
	smtp_user: string | null;
	smtp_pass: string | null;
	smtp_from: string | null;
}

export async function getAppSettings(): Promise<AppSettings> {
	const registry = await getRegistryClient();
	const res = await registry.execute({ sql: 'SELECT * FROM app_settings WHERE id = 1 LIMIT 1', args: [] });
	const row = res.rows[0] as unknown as AppSettings | undefined;
	if (row) return row;
	await registry.execute({ sql: 'INSERT OR IGNORE INTO app_settings (id) VALUES (1)', args: [] });
	const retry = await registry.execute({ sql: 'SELECT * FROM app_settings WHERE id = 1 LIMIT 1', args: [] });
	return retry.rows[0] as unknown as AppSettings;
}

export function smtpConfigured(s: AppSettings): boolean {
	return !!(s.smtp_host && s.smtp_port);
}

// Effective signup policy. The SIGNUP_ENABLED env var is authoritative when
// set (e.g. SIGNUP_ENABLED=false hard-disables registration and cannot be
// overridden from the Admin panel); otherwise the DB setting applies so the
// toggle keeps working for operators who do not set the env var.
export function effectiveSignup(s: { signup_enabled: number }): { enabled: boolean; envLocked: boolean } {
	const env = process.env.SIGNUP_ENABLED;
	if (env !== undefined && env !== '') {
		return { enabled: String(env).toLowerCase() === 'true' || String(env) === '1', envLocked: true };
	}
	return { enabled: Number(s.signup_enabled ?? 1) === 1, envLocked: false };
}

export async function sendMail(s: AppSettings, to: string, subject: string, text: string): Promise<void> {
	if (!smtpConfigured(s)) {
		throw new Error('SMTP is not configured');
	}
	const transporter = nodemailer.createTransport({
		host: s.smtp_host!,
		port: s.smtp_port!,
		secure: (s.smtp_port === 465),
		auth: s.smtp_user && s.smtp_pass
			? { user: s.smtp_user, pass: s.smtp_pass }
			: undefined,
	});
	const from = s.smtp_from || `Nido <nido@${s.smtp_host}>`;
	await transporter.sendMail({ from, to, subject, text });
}

export function baseUrl(): string {
	const url = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
	return url.replace(/\/$/, '');
}