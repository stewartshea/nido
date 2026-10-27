// registry-view.ts
//
// A read-only view of the registry database for the platform admin: who and
// what exists inside the instance's control plane, without exposing the data
// that should stay server-side (verification/reset tokens, the SMTP password).
//
// Like system-overview.ts this reads the *registry* only — never a family
// database, whose contents stay inside each tenant's encrypted file.

import { getRegistryClient } from './namespaces';
import { effectiveSignup } from './mail';

export interface RegistryFamilyRow {
	familyId: string;
	name: string;
	familyCode: string | null;
	status: string;
	/** Accounts whose routing points here; 0 means the family is retained but unreachable. */
	accountCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface RegistryUserRow {
	email: string;
	familyId: string;
	userId: string;
	role: string;
	isPlatformAdmin: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface RegistryLeaseRow {
	name: string;
	holder: string;
	acquiredAt: string;
	expiresAt: string;
}

export interface RegistrySettingsView {
	signupEnabled: boolean;
	signupEnvLocked: boolean;
	emailVerification: boolean;
	smtpHost: string | null;
	smtpPort: number | null;
	smtpFrom: string | null;
	/** The username/from values are shown; secret values are only ever reported as present. */
	smtpUserSet: boolean;
	smtpPassSet: boolean;
	smtpConfigured: boolean;
	updatedAt: string;
}

export interface RegistryView {
	families: RegistryFamilyRow[];
	users: RegistryUserRow[];
	leases: RegistryLeaseRow[];
	settings: RegistrySettingsView;
}

export async function buildRegistryView(): Promise<RegistryView> {
	const registry = await getRegistryClient();
	const [families, users, leases, settingsRows] = await Promise.all([
		registry.execute({
			sql: `SELECT f.family_id, f.name, f.family_code, f.status, f.created_at, f.updated_at,
			             (SELECT COUNT(*) FROM user_routing r WHERE r.family_id = f.family_id) AS account_count
			      FROM families f
			      ORDER BY CASE WHEN f.status = 'active' THEN 0 ELSE 1 END, f.created_at, f.family_id`,
			args: [],
		}),
		registry.execute({
			sql: 'SELECT email, family_id, user_id, role, is_platform_admin, created_at, updated_at FROM user_routing ORDER BY created_at, email',
			args: [],
		}),
		registry.execute({
			sql: 'SELECT name, holder, acquired_at, expires_at FROM scheduler_leases ORDER BY name',
			args: [],
		}),
		registry.execute({ sql: 'SELECT * FROM app_settings WHERE id = 1 LIMIT 1', args: [] }),
	]);

	const s = settingsRows.rows[0] as Record<string, unknown> | undefined;
	const signup = effectiveSignup(s as any);

	return {
		families: families.rows.map((r) => ({
			familyId: String(r.family_id),
			name: String(r.name ?? ''),
			familyCode: r.family_code == null ? null : String(r.family_code),
			status: String(r.status ?? 'active'),
			accountCount: Number(r.account_count ?? 0),
			createdAt: String(r.created_at ?? ''),
			updatedAt: String(r.updated_at ?? ''),
		})),
		users: users.rows.map((r) => ({
			email: String(r.email),
			familyId: String(r.family_id),
			userId: String(r.user_id),
			role: String(r.role ?? 'member'),
			isPlatformAdmin: Number(r.is_platform_admin ?? 0) === 1,
			createdAt: String(r.created_at ?? ''),
			updatedAt: String(r.updated_at ?? ''),
		})),
		leases: leases.rows.map((r) => ({
			name: String(r.name),
			holder: String(r.holder),
			acquiredAt: String(r.acquired_at ?? ''),
			expiresAt: String(r.expires_at ?? ''),
		})),
		settings: {
			signupEnabled: signup.enabled,
			signupEnvLocked: signup.envLocked,
			emailVerification: Number(s?.email_verification ?? 0) === 1,
			smtpHost: s?.smtp_host ? String(s.smtp_host) : null,
			smtpPort: s?.smtp_port ? Number(s.smtp_port) : null,
			smtpFrom: s?.smtp_from ? String(s.smtp_from) : null,
			smtpUserSet: !!s?.smtp_user,
			smtpPassSet: !!s?.smtp_pass,
			smtpConfigured: !!(s?.smtp_host && s?.smtp_port),
			updatedAt: String(s?.updated_at ?? ''),
		},
	};
}