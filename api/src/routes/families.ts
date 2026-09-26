import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type AuthEnv, jwtSecret } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { ensureRegistry, getFamilyClient } from '../db-namespaces';
import { getAppSettings, sendMail, smtpConfigured, baseUrl } from '../mail';
import { renderFamilyInviteEmail } from '../mail-templates';

const AVATAR_DIR = process.env.PHOTO_DIR || '/data/photos';

// Avatar files are stored without an extension (see handleUploadAvatar), and
// no mime column exists to round-trip the upload's claimed type, so serving
// one back requires sniffing the real bytes. "image/*" is not a valid
// Content-Type (only meaningful in an Accept header) and made every avatar
// fail to render.
function sniffImageMime(buf: Buffer): string {
	if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
	if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF' && (buf.toString('ascii', 3, 6) === '87a' || buf.toString('ascii', 3, 6) === '89a')) return 'image/gif';
	if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
	if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
	return 'application/octet-stream';
}

const familyRoutes = new Hono<AuthEnv>();

const MEMBER_TYPES = ['child', 'adult'];

function isoNow(): string {
	return new Date().toISOString();
}

// Maps a babies-family_members row to its REST shape.
function memberShape(row: any) {
	return {
		id: Number(row.id),
		name: row.name,
		birthDate: row.birth_date,
		gender: row.gender,
		type: row.member_type || row.type || 'child',
		email: row.email || null,
		avatar: row.avatar || null,
		legacyBabyId: row.legacy_baby_id ? Number(row.legacy_baby_id) : null,
		trackable: row.legacy_baby_id ? true : false,
		linkedAccount: Number(row.linked_account || 0) === 1,
		categories: row.categories ? JSON.parse(String(row.categories)) : [],
	};
}

function generateInviteToken(): string {
	return randomBytes(24).toString('hex');
}

async function familyAccess(c: Context<AuthEnv>, roles: string[] = ['owner', 'admin', 'member']): Promise<string | null> {
	const db = c.get('db');
	const userId = c.get('userId');
	const res = await db.execute({
		sql: 'SELECT role FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, NAMESPACE_HOUSEHOLD_ID],
	});
	const row = res.rows[0];
	if (!row) return null;
	return roles.includes(String(row.role)) ? String(row.role) : null;
}

function validateFamilyRef(c: Context<AuthEnv>): boolean {
	const ref = c.req.param('familyRef');
	const registryFamilyId = c.get('familyId');
	return ref === registryFamilyId || ref === '1';
}

const DEFAULT_CATEGORIES = ['feeds', 'diapers', 'sleep', 'growth', 'pumping', 'routines', 'firsts', 'milestones', 'medical', 'vaccines', 'moods', 'journal'];

const EXPORT_TABLES = ['feedings', 'diapers', 'sleep', 'growth', 'milestones', 'vaccinations', 'moods', 'journal_entries'] as const;

const PHOTO_PARENT_TYPES: Record<string, string> = { feedings: 'feeding', diapers: 'diaper', sleep: 'sleep', growth: 'growth', milestones: 'milestone' };

const DEFAULT_CATEGORY_OPTIONS = {
	feeds: {
		type: ['breast', 'formula', 'bottle', 'pump', 'solid'],
		side: ['left', 'right', 'both'],
	},
	diapers: {
		consistency: ['mushy', 'runny', 'formed', 'soft', 'blowout', 'other'],
		color: ['yellow', 'brown', 'green', 'black', 'red'],
	},
	sleep: {
		location: ['crib', 'bassinet', 'stroller', 'carrier', 'other'],
	},
	growth: {
		unit: ['metric', 'imperial'],
	},
	pumping: {
		type: ['left', 'right', 'both'],
	},
	routines: {
		type: ['tummy time', 'bath', 'story time', 'walk', 'other'],
	},
	firsts: {
		type: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'],
	},
	milestones: {
		category: ['physical', 'social', 'language', 'cognitive', 'other'],
	},
	medical: {
		visitType: ['wellness', 'sick visit', 'follow-up', 'other'],
	},
	vaccines: {
		route: ['oral', 'intramuscular', 'subcutaneous', 'dermal'],
	},
	moods: {
		mood: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'],
	},
};

function settingsShape(row: any) {
	return {
		categories: row?.categories ? JSON.parse(String(row.categories)) : null,
		categoryOptions: row?.category_options ? JSON.parse(String(row.category_options)) : {},
		shareAnonymizedDaily: Number(row?.share_anonymized_daily ?? 0) === 1,
	};
}

// ── Zod schemas ────────────────────────────────────────────────────────────

const addMemberSchema = z.object({
	type: z.enum(MEMBER_TYPES as [string, ...string[]]).default('child').optional(),
	name: z.string().min(1),
	birthDate: z.string().datetime().optional(),
	gender: z.string().max(20).optional(),
	email: z.string().email().optional(),
	categories: z.array(z.string()).optional(),
});

const inviteSchema = z.object({ email: z.string().email() });

const joinSchema = z.object({
	familyId: z.string().min(1),
	token: z.string().min(1),
});

// Accepting an invitation deletes the joiner's own single-family namespace.
// Every table below lives in that namespace, so a row in any of them is real
// data that would be destroyed with the file. Refuse rather than orphan it.
const FAMILY_CONTENT_TABLES = [
	'babies', 'feedings', 'diapers', 'sleep', 'growth', 'milestones',
	'vaccinations', 'moods', 'journal_entries', 'photos', 'reminders', 'formulas',
] as const;

async function familyHasContent(db: ReturnType<typeof getFamilyClient>): Promise<boolean> {
	for (const table of FAMILY_CONTENT_TABLES) {
		const res = await db.execute({ sql: `SELECT 1 FROM ${table} LIMIT 1`, args: [] });
		if (res.rows.length > 0) return true;
	}
	return false;
}

const updateMemberSchema = z.object({
	type: z.enum(MEMBER_TYPES as [string, ...string[]]).optional(),
	name: z.string().min(1).optional(),
	birthDate: z.string().datetime().nullable().optional(),
	gender: z.string().max(20).nullable().optional(),
	email: z.string().email().nullable().optional(),
	categories: z.array(z.string()).optional(),
});

const settingsSchema = z.object({
	categories: z.array(z.string()).optional(),
	categoryOptions: z.record(z.string(), z.record(z.string(), z.array(z.string()))).optional(),
	shareAnonymizedDaily: z.boolean().optional(),
});

const HOME_ID_PRIMARY = 1;

async function ensureDefaultHome(db: ReturnType<typeof getFamilyClient>) {
	await db.execute({
		sql: `INSERT OR IGNORE INTO homes (id, household_id, name, kind, is_primary, created_at, updated_at)
		      VALUES (?, ?, ?, ?, 1, ?, ?)`,
		args: [HOME_ID_PRIMARY, NAMESPACE_HOUSEHOLD_ID, 'Primary Home', 'primary', isoNow(), isoNow()],
	});
}

async function linkAccountMemberByEmail(db: ReturnType<typeof getFamilyClient>, memberId: number, email: string | null | undefined) {
	if (!email) return;
	const userRes = await db.execute({
		sql: 'SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1',
		args: [email],
	});
	const userId = userRes.rows[0]?.id;
	if (!userId) return;
	await db.execute({
		sql: 'INSERT OR IGNORE INTO account_members (user_id, member_id, created_at) VALUES (?, ?, ?)',
		args: [String(userId), memberId, isoNow()],
	});
}

async function buildAnonymizedDailyPreview(db: ReturnType<typeof getFamilyClient>) {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const totalsRow = (await db.execute({
		sql: `
			SELECT
				(SELECT COUNT(*) FROM family_members WHERE household_id = ?) AS members,
				(SELECT COUNT(*) FROM babies WHERE household_id = ?) AS trackable_members,
				(SELECT COUNT(*) FROM feedings WHERE created_at >= ?) AS feedings,
				(SELECT COUNT(*) FROM diapers WHERE created_at >= ?) AS diapers,
				(SELECT COUNT(*) FROM sleep WHERE created_at >= ?) AS sleep,
				(SELECT COUNT(*) FROM growth WHERE created_at >= ?) AS growth,
				(SELECT COUNT(*) FROM moods WHERE created_at >= ?) AS moods,
				(SELECT COUNT(*) FROM journal_entries WHERE created_at >= ?) AS journal,
				(SELECT COUNT(*) FROM milestones WHERE created_at >= ?) AS milestones,
				(SELECT COUNT(*) FROM vaccinations WHERE created_at >= ?) AS vaccinations
		`,
		args: [NAMESPACE_HOUSEHOLD_ID, NAMESPACE_HOUSEHOLD_ID, since, since, since, since, since, since, since, since],
	})).rows[0] as any;

	const feedTypes = (await db.execute({
		sql: 'SELECT type, COUNT(*) AS cnt FROM feedings WHERE created_at >= ? GROUP BY type',
		args: [since],
	})).rows.reduce((acc: Record<string, number>, row: any) => {
		acc[String(row.type || 'unknown')] = Number(row.cnt || 0);
		return acc;
	}, {} as Record<string, number>);

	const diaperTypes = (await db.execute({
		sql: 'SELECT type, COUNT(*) AS cnt FROM diapers WHERE created_at >= ? GROUP BY type',
		args: [since],
	})).rows.reduce((acc: Record<string, number>, row: any) => {
		acc[String(row.type || 'unknown')] = Number(row.cnt || 0);
		return acc;
	}, {} as Record<string, number>);

	return {
		windowHours: 24,
		generatedAt: isoNow(),
		totals: {
			members: Number(totalsRow?.members || 0),
			trackableMembers: Number(totalsRow?.trackable_members || 0),
			feedings: Number(totalsRow?.feedings || 0),
			diapers: Number(totalsRow?.diapers || 0),
			sleep: Number(totalsRow?.sleep || 0),
			growth: Number(totalsRow?.growth || 0),
			moods: Number(totalsRow?.moods || 0),
			journal: Number(totalsRow?.journal || 0),
			milestones: Number(totalsRow?.milestones || 0),
			vaccinations: Number(totalsRow?.vaccinations || 0),
		},
		breakdown: {
			feedTypes,
			diaperTypes,
		},
	};
}

// ── Handler functions ──────────────────────────────────────────────────────

// GET / — return exactly one routed family
async function handleGetFamilies(c: Context<AuthEnv>) {
	const userId = c.get('userId');
	const registryFamilyId = c.get('familyId');
	const db = c.get('db');

	const registry = await ensureRegistry();
	const registryRes = await registry.execute({
		sql: 'SELECT family_id, name, family_code, status FROM families WHERE family_id = ?',
		args: [registryFamilyId],
	});
	if (registryRes.rows.length === 0) {
		return c.json({ error: 'Family not found' }, 404);
	}
	const famRow = registryRes.rows[0] as any;

	const roleRes = await db.execute({
		sql: 'SELECT role FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, NAMESPACE_HOUSEHOLD_ID],
	});
	const role = roleRes.rows[0] ? String(roleRes.rows[0].role) : 'member';

	const countRes = await db.execute({
		sql: 'SELECT COUNT(*) AS cnt FROM family_members WHERE household_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const memberCount = Number(countRes.rows[0]?.cnt ?? 0);

	return c.json({
		families: [{
			familyId: registryFamilyId,
			householdId: 1,
			legacyFamilyId: 1,
			name: famRow.name,
			familyCode: famRow.family_code,
			status: famRow.status,
			role,
			memberCount,
		}],
	});
}

// POST / — 409 (creation happens during registration)
async function handleCreateFamily(c: Context<AuthEnv>) {
	return c.json({ error: 'Family creation happens during registration for this account model' }, 409);
}

// POST /join — accept an invitation and move this account into the inviting family.
//
// The one-family-per-account invariant lives in the registry: user_routing has
// one row per email (UNIQUE) carrying exactly one family_id. Joining therefore
// only has to re-point that column — no multi-family support is introduced, and
// a family gains members by accumulating separate accounts.
	function signFamilyToken(userId: string, email: string, familyId: string, role: string): string {
		return jwt.sign({ userId, email, familyId, role }, jwtSecret(), { expiresIn: '24h' });
	}

	async function handleJoinFamily(c: Context<AuthEnv>) {
		const userId = c.get('userId');
		const { familyId, token } = (c.req as any).valid('json');
		const registry = await ensureRegistry();

		// The routing row is the single source of truth for which namespace this
		// account reads, so it is looked up by user rather than by the family in
		// the (possibly stale) token claim.
		const routing = await registry.execute({
			sql: 'SELECT family_id, email FROM user_routing WHERE user_id = ? LIMIT 1',
			args: [userId],
		});
		const me = routing.rows[0] as unknown as { family_id: string; email: string } | undefined;
		if (!me) return c.json({ error: 'Account is not registered' }, 404);
		const currentFamilyId = String(me.family_id);

		// getFamilyClient provisions an empty namespace for whatever id it is
		// given, so an invented familyId would otherwise mint a fresh family
		// rather than being rejected as a bad link.
		const targetFamily = await registry.execute({
			sql: 'SELECT family_id FROM families WHERE family_id = ? LIMIT 1',
			args: [familyId],
		});
		if (targetFamily.rows.length === 0) {
			return c.json({ error: 'This invitation link is not valid' }, 404);
		}

		const target = getFamilyClient(familyId);
		await ensureDefaultHome(target);
		const invite = await target.execute({
			sql: 'SELECT id, email, status FROM family_invitations WHERE token = ? LIMIT 1',
			args: [token],
		});
		const invitation = invite.rows[0] as unknown as { id: number; email: string; status: string } | undefined;
		if (!invitation) return c.json({ error: 'This invitation link is not valid' }, 404);
		if (String(invitation.status) !== 'pending') {
			return c.json({ error: 'This invitation has already been used' }, 409);
		}
		if (String(invitation.email).toLowerCase() !== String(me.email).toLowerCase()) {
			return c.json({ error: 'This invitation was sent to a different email address' }, 403);
		}

		const now = isoNow();
		const accept = {
			message: 'You have joined the family',
			familyId,
			user: { id: userId, email: me.email, role: 'member' },
		};

		// Re-running after a partial failure: routing already points here, so the
		// only work left is consuming the invitation.
		if (currentFamilyId === familyId) {
			await target.execute({
				sql: "UPDATE family_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
				args: [now, Number(invitation.id)],
			});
			return c.json({ ...accept, token: signFamilyToken(userId, me.email, familyId, 'member') });
		}

		if (await familyHasContent(getFamilyClient(currentFamilyId))) {
			return c.json({
				error: 'Your current family still has tracked data. Joining moves your account out of it and you will lose access to that data. Export it first, or join from a fresh account.',
			}, 409);
		}

		// The profile only exists in the account's current namespace, and
		// user_households.user_id references users(id) in the host namespace, so
		// the row has to be carried across before membership is inserted.
		const source = getFamilyClient(currentFamilyId);
		const profile = await source.execute({
			sql: 'SELECT email, password_hash, first_name, last_name, email_verified FROM users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		const row = profile.rows[0] as unknown as {
			email: string;
			password_hash: string;
			first_name: string;
			last_name: string;
			email_verified: number;
		} | undefined;
		if (!row) return c.json({ error: 'Account profile could not be read' }, 500);

		await target.execute({
			sql: `INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, email_verified, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [userId, row.email, row.password_hash, row.first_name, row.last_name, row.email_verified, now, now],
		});
		await target.execute({
			sql: 'INSERT OR IGNORE INTO user_households (user_id, household_id, role) VALUES (?, ?, ?)',
			args: [userId, NAMESPACE_HOUSEHOLD_ID, 'member'],
		});

		const existingMember = await target.execute({
			sql: 'SELECT id FROM family_members WHERE household_id = ? AND lower(email) = lower(?) LIMIT 1',
			args: [NAMESPACE_HOUSEHOLD_ID, me.email],
		});
		let memberId = existingMember.rows[0]?.id ? Number(existingMember.rows[0]?.id) : null;
		if (!memberId) {
			const insMember = await target.execute({
				sql: `INSERT INTO family_members (household_id, legacy_baby_id, name, member_type, email, categories, created_at, updated_at)
				      VALUES (?, NULL, ?, 'adult', ?, ?, ?, ?)`,
				args: [NAMESPACE_HOUSEHOLD_ID, row.first_name || me.email, me.email, JSON.stringify(DEFAULT_CATEGORIES), now, now],
			});
			memberId = Number(insMember.lastInsertRowid);
			await target.execute({
				sql: 'INSERT OR IGNORE INTO member_homes (member_id, home_id, relation, is_primary, created_at) VALUES (?, ?, ?, 1, ?)',
				args: [memberId, HOME_ID_PRIMARY, 'resident', now],
			});
		}
		await target.execute({
			sql: 'INSERT OR IGNORE INTO account_members (user_id, member_id, created_at) VALUES (?, ?, ?)',
			args: [userId, memberId, now],
		});

		// Commit point. Everything above is idempotent, so a failure below leaves
		// the account on a working family with the invitation still redeemable.
		await registry.execute({
			sql: "UPDATE user_routing SET family_id = ?, role = 'member', updated_at = ? WHERE user_id = ?",
			args: [familyId, now, userId],
		});

		// Detach from the old namespace rather than deleting it: it may still hold
		// other members and their tracked data.
		await source
			.execute({
				sql: 'DELETE FROM user_households WHERE user_id = ? AND household_id = ?',
				args: [userId, NAMESPACE_HOUSEHOLD_ID],
			})
			.catch(() => {});

		await target.execute({
			sql: "UPDATE family_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
			args: [now, Number(invitation.id)],
		});

		return c.json({ ...accept, token: signFamilyToken(userId, me.email, familyId, 'member') });
	}

// GET /members — list members
async function handleGetMembers(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);
	await ensureDefaultHome(db);

	const res = await db.execute({
		sql: `
			SELECT
				fm.id,
				fm.legacy_baby_id,
				fm.name,
				fm.birth_date,
				fm.gender,
				fm.member_type,
				fm.email,
				fm.avatar,
				fm.categories,
				CASE WHEN am.user_id IS NULL THEN 0 ELSE 1 END AS linked_account
			FROM family_members fm
			LEFT JOIN account_members am ON am.member_id = fm.id
			WHERE fm.household_id = ?
			ORDER BY fm.created_at
		`,
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	return c.json({ members: res.rows.map(memberShape) });
}

// POST /members — add a member
async function handleAddMember(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);
	await ensureDefaultHome(db);

	const { type, name, birthDate, gender, email, categories } = (c.req as any).valid('json');
	const memberType = type || 'child';
	const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

	// Guard against accidental duplicates
	const dup = await db.execute({
		sql: 'SELECT id FROM family_members WHERE household_id = ? AND name = ? AND (birth_date IS ? OR birth_date = ?) LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID, name, birthDate ?? null, birthDate ?? null],
	});
	if (dup.rows.length > 0) {
		return c.json({ error: `${name} is already in this family (same name and birth date).` }, 409);
	}

	const memberCategories = categories ?? DEFAULT_CATEGORIES;
	let legacyBabyId: number | null = null;
	if (memberType === 'child') {
		const childInsert = await db.execute({
			sql: `INSERT INTO babies (household_id, name, birth_date, gender, type, email, categories, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, name, birthDate || null, gender || null, 'child', normalizedEmail, JSON.stringify(memberCategories), isoNow(), isoNow()],
		});
		legacyBabyId = Number(childInsert.lastInsertRowid);
	}

	const ins = await db.execute({
		sql: `INSERT INTO family_members (household_id, legacy_baby_id, name, birth_date, gender, member_type, email, categories, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [NAMESPACE_HOUSEHOLD_ID, legacyBabyId, name, birthDate || null, gender || null, memberType, normalizedEmail, JSON.stringify(memberCategories), isoNow(), isoNow()],
	});
	const memberId = Number(ins.lastInsertRowid);
	await db.execute({
		sql: 'INSERT OR IGNORE INTO member_homes (member_id, home_id, relation, is_primary, created_at) VALUES (?, ?, ?, 1, ?)',
		args: [memberId, HOME_ID_PRIMARY, memberType === 'adult' ? 'resident' : 'child', isoNow()],
	});
	await linkAccountMemberByEmail(db, memberId, normalizedEmail);

	const rowRes = await db.execute({
		sql: `
			SELECT fm.id, fm.legacy_baby_id, fm.name, fm.birth_date, fm.gender, fm.member_type, fm.email, fm.avatar, fm.categories,
			       CASE WHEN am.user_id IS NULL THEN 0 ELSE 1 END AS linked_account
			FROM family_members fm
			LEFT JOIN account_members am ON am.member_id = fm.id
			WHERE fm.id = ?
		`,
		args: [memberId],
	});
	const member = memberShape(rowRes.rows[0]);
	return c.json({ message: 'Family member added', member }, 201);
}

// PUT /members/:memberId — update a member
async function handleUpdateMember(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const rowRes = await db.execute({
		sql: 'SELECT id, legacy_baby_id, member_type FROM family_members WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (rowRes.rows.length === 0) return c.json({ error: 'Member not found' }, 404);
	const existing = rowRes.rows[0] as any;

	const { type, name, birthDate, gender, email, categories } = (c.req as any).valid('json');
	const nextMemberType = type || String(existing.member_type || 'child');
	const normalizedEmail = email === undefined ? undefined : (email === null ? null : String(email).trim().toLowerCase());
	const updates: string[] = [];
	const params: Array<number | string | null> = [];
	if (type) { updates.push('member_type = ?'); params.push(type); }
	if (name !== undefined) { updates.push('name = ?'); params.push(name); }
	if (birthDate !== undefined) { updates.push('birth_date = ?'); params.push(birthDate); }
	if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
	if (normalizedEmail !== undefined) { updates.push('email = ?'); params.push(normalizedEmail); }
	if (categories) { updates.push('categories = ?'); params.push(JSON.stringify(categories)); }
	if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);

	let legacyBabyId = existing.legacy_baby_id ? Number(existing.legacy_baby_id) : null;
	if (!legacyBabyId && nextMemberType === 'child') {
		const childInsert = await db.execute({
			sql: `INSERT INTO babies (household_id, name, birth_date, gender, type, email, categories, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				NAMESPACE_HOUSEHOLD_ID,
				name ?? 'Child',
				birthDate ?? null,
				gender ?? null,
				'child',
				normalizedEmail ?? null,
				JSON.stringify(categories ?? DEFAULT_CATEGORIES),
				isoNow(),
				isoNow(),
			],
		});
		legacyBabyId = Number(childInsert.lastInsertRowid);
		updates.push('legacy_baby_id = ?');
		params.push(legacyBabyId);
	}

	updates.push('updated_at = ?'); params.push(isoNow());
	params.push(memberId, NAMESPACE_HOUSEHOLD_ID);

	await db.execute({ sql: `UPDATE family_members SET ${updates.join(', ')} WHERE id = ? AND household_id = ?`, args: params });

	if (legacyBabyId) {
		const babyUpdates: string[] = [];
		const babyParams: Array<string | number | null> = [];
		if (name !== undefined) { babyUpdates.push('name = ?'); babyParams.push(name); }
		if (birthDate !== undefined) { babyUpdates.push('birth_date = ?'); babyParams.push(birthDate); }
		if (gender !== undefined) { babyUpdates.push('gender = ?'); babyParams.push(gender); }
		if (normalizedEmail !== undefined) { babyUpdates.push('email = ?'); babyParams.push(normalizedEmail); }
		if (categories) { babyUpdates.push('categories = ?'); babyParams.push(JSON.stringify(categories)); }
		if (babyUpdates.length > 0) {
			babyUpdates.push('type = ?');
			babyParams.push(nextMemberType === 'adult' ? 'adult' : 'child');
			babyUpdates.push('updated_at = ?');
			babyParams.push(isoNow());
			babyParams.push(legacyBabyId, NAMESPACE_HOUSEHOLD_ID);
			await db.execute({ sql: `UPDATE babies SET ${babyUpdates.join(', ')} WHERE id = ? AND household_id = ?`, args: babyParams });
		}
	}

	if (normalizedEmail !== undefined) {
		await db.execute({ sql: 'DELETE FROM account_members WHERE member_id = ?', args: [memberId] });
		await linkAccountMemberByEmail(db, memberId, normalizedEmail);
	}

	const memRes = await db.execute({
		sql: `
			SELECT fm.id, fm.legacy_baby_id, fm.name, fm.birth_date, fm.gender, fm.member_type, fm.email, fm.avatar, fm.categories,
			       CASE WHEN am.user_id IS NULL THEN 0 ELSE 1 END AS linked_account
			FROM family_members fm
			LEFT JOIN account_members am ON am.member_id = fm.id
			WHERE fm.id = ? AND fm.household_id = ?
		`,
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	const row = memRes.rows[0];
	return c.json({ message: 'Member updated', member: memberShape(row) });
}

// DELETE /members/:memberId — remove a member and its data
async function handleDeleteMember(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const memRes = await db.execute({
		sql: 'SELECT id, legacy_baby_id, avatar FROM family_members WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memRes.rows.length === 0) return c.json({ error: 'Member not found' }, 404);
	const avatar = memRes.rows[0]?.avatar;
	const legacyBabyId = memRes.rows[0]?.legacy_baby_id ? Number(memRes.rows[0]?.legacy_baby_id) : null;

	// Photo cleanup: collect record ids per parent type, then delete photos
	if (legacyBabyId) {
		for (const [table, parentType] of Object.entries(PHOTO_PARENT_TYPES)) {
			const ids = (await db.execute({ sql: `SELECT id FROM ${table} WHERE baby_id = ?`, args: [legacyBabyId] })).rows.map((r: any) => Number(r.id));
			if (ids.length > 0) {
				const placeholders = ids.map(() => '?').join(',');
				await db.execute({
					sql: `DELETE FROM photos WHERE family_id = ? AND parent_type = ? AND parent_id IN (${placeholders})`,
					args: [NAMESPACE_HOUSEHOLD_ID, parentType, ...ids],
				});
			}
		}

		for (const table of EXPORT_TABLES) {
			await db.execute({ sql: `DELETE FROM ${table} WHERE baby_id = ?`, args: [legacyBabyId] });
		}
		await db.execute({ sql: 'DELETE FROM import_log WHERE baby_id = ?', args: [legacyBabyId] });
		await db.execute({
			sql: `DELETE FROM reminders WHERE target_type = 'member' AND target_id = ?`,
			args: [legacyBabyId],
		});
		await db.execute({ sql: 'DELETE FROM babies WHERE id = ? AND household_id = ?', args: [legacyBabyId, NAMESPACE_HOUSEHOLD_ID] });
	}

	if (avatar) {
		try { await rm(join(AVATAR_DIR, String(avatar)), { force: true }); } catch { /* already gone */ }
	}

	await db.execute({ sql: 'DELETE FROM account_members WHERE member_id = ?', args: [memberId] });
	await db.execute({ sql: 'DELETE FROM member_homes WHERE member_id = ?', args: [memberId] });
	await db.execute({ sql: 'DELETE FROM family_members WHERE id = ? AND household_id = ?', args: [memberId, NAMESPACE_HOUSEHOLD_ID] });
	return c.json({ message: 'Member deleted' });
}

// POST /members/:memberId/avatar — upload avatar
async function handleUploadAvatar(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const form = await c.req.formData();
	const file = form.get('file');
	if (!file || typeof file === 'string') return c.json({ error: 'Missing image file' }, 400);

	const memCheck = await db.execute({
		sql: 'SELECT id, legacy_baby_id FROM family_members WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memCheck.rows.length === 0) return c.json({ error: 'Member not found' }, 404);
    const legacyBabyId = memCheck.rows[0]?.legacy_baby_id ? Number(memCheck.rows[0]?.legacy_baby_id) : null;

	const buf = Buffer.from(await file.arrayBuffer());
	const mime = file.type || 'application/octet-stream';
	if (!mime.startsWith('image/')) return c.json({ error: 'Only image uploads are allowed' }, 400);

	await mkdir(AVATAR_DIR, { recursive: true });
	const avatarName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	await writeFile(join(AVATAR_DIR, avatarName), buf);

	await db.execute({ sql: 'UPDATE family_members SET avatar = ?, updated_at = ? WHERE id = ? AND household_id = ?', args: [avatarName, isoNow(), memberId, NAMESPACE_HOUSEHOLD_ID] });
	if (legacyBabyId) {
		await db.execute({ sql: 'UPDATE babies SET avatar = ?, updated_at = ? WHERE id = ? AND household_id = ?', args: [avatarName, isoNow(), legacyBabyId, NAMESPACE_HOUSEHOLD_ID] });
	}

	return c.json({ message: 'Avatar uploaded', avatar: avatarName });
}

// GET /members/:memberId/avatar — fetch avatar
async function handleGetAvatar(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const memCheck = await db.execute({
		sql: 'SELECT id FROM family_members WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memCheck.rows.length === 0) return c.json({ error: 'Member not found' }, 404);

	const res = await db.execute({ sql: 'SELECT avatar FROM family_members WHERE id = ? AND household_id = ? LIMIT 1', args: [memberId, NAMESPACE_HOUSEHOLD_ID] });
	const avatar = res.rows[0]?.avatar;
	if (!avatar) return c.json({ error: 'No avatar' }, 404);

	try {
		const data = await readFile(join(AVATAR_DIR, String(avatar)));
		return new Response(data, { status: 200, headers: { 'Content-Type': sniffImageMime(data), 'Cache-Control': 'private, max-age=31536000' } });
	} catch {
		return c.json({ error: 'Avatar file missing' }, 404);
	}
}

// POST /invitations — invite by email (owner/admin)
async function handleCreateInvitation(c: Context<AuthEnv>) {
	const userId = c.get('userId');
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const { email } = (c.req as any).valid('json');
	const normalized = email.toLowerCase().trim();

	const existing = await db.execute({
		sql: 'SELECT id, email, token, status FROM family_invitations WHERE family_id = ? AND email = ? LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID, normalized],
	});
	const prior = existing.rows[0] as unknown as { id: number; email: string; token: string; status: string } | undefined;
	if (prior && String(prior.status) === 'accepted') {
		return c.json({ error: 'This person has already accepted an invitation to your family' }, 409);
	}

	// Reused rather than reinserted: UNIQUE(family_id, email) makes a second
	// insert throw, and re-inviting should resend the same link.
	let inviteId: number;
	let token: string;
	if (prior) {
		inviteId = Number(prior.id);
		token = prior.token;
	} else {
		token = generateInviteToken();
		const ins = await db.execute({
			sql: `INSERT INTO family_invitations (family_id, email, inviter_user_id, token, status, created_at)
			      VALUES (?, ?, ?, ?, 'pending', ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, normalized, userId, token, isoNow()],
		});
		inviteId = Number(ins.lastInsertRowid);
	}

	const familyId = c.get('familyId');
	const registry = await ensureRegistry();
	const famRow = await registry.execute({ sql: 'SELECT name FROM families WHERE family_id = ? LIMIT 1', args: [familyId] });
	const familyName = String(famRow.rows[0]?.name ?? 'the family');
	const inviterRow = await db.execute({
		sql: 'SELECT first_name FROM users WHERE id = ? LIMIT 1',
		args: [userId],
	});
	const inviterName = String(inviterRow.rows[0]?.first_name ?? '');

	const inviteUrl = `${baseUrl()}/join?family=${encodeURIComponent(familyId)}&token=${encodeURIComponent(token)}`;

	const settings = await getAppSettings();
	if (!smtpConfigured(settings)) {
		return c.json({ error: 'Email is not configured on this server, so the invitation could not be sent.', invitation: { id: inviteId, email: normalized, token, status: 'pending' } }, 503);
	}

	try {
		await sendMail(settings, normalized, renderFamilyInviteEmail({ inviterName, familyName, url: inviteUrl }));
	} catch (mailErr) {
		console.error('Family invitation email failed to send:', mailErr);
		// The row is deliberately not rolled back: the pending link must survive so
		// it can be resent or shared manually, and 502 stops the UI claiming it went out.
		return c.json({
			error: 'The invitation was saved but the email could not be sent. Share the link below instead.',
			invitation: { id: inviteId, email: normalized, token, status: 'pending', inviteUrl },
		}, 502);
	}

	return c.json(
		{
			message: 'Invitation sent',
			invitation: { id: inviteId, email: normalized, token, status: 'pending' },
		},
		201,
	);
}

// GET /invitations — list pending invites (owner/admin)
async function handleGetInvitations(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const res = await db.execute({
		sql: `SELECT id, email, token, status, created_at FROM family_invitations
		      WHERE family_id = ? ORDER BY created_at DESC`,
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const invitations = res.rows.map((r) => ({
		id: Number(r?.id),
		email: r?.email,
		token: r?.token,
		status: r?.status,
		createdAt: r?.created_at,
	}));
	return c.json({ invitations });
}

// DELETE /invitations/:inviteId — revoke a pending invite
async function handleDeleteInvitation(c: Context<AuthEnv>) {
	const db = c.get('db');
	const inviteId = Number(c.req.param('inviteId'));

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	await db.execute({
		sql: 'DELETE FROM family_invitations WHERE id = ? AND family_id = ?',
		args: [inviteId, NAMESPACE_HOUSEHOLD_ID],
	});
	return c.json({ message: 'Invitation revoked' });
}

// GET /settings — read family settings
async function handleGetSettings(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const res = await db.execute({
		sql: 'SELECT categories, category_options, share_anonymized_daily FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const row = res.rows[0] || null;
	return c.json({ settings: { ...settingsShape(row), defaultCategoryOptions: DEFAULT_CATEGORY_OPTIONS }, anonymizedPreview: await buildAnonymizedDailyPreview(db) });
}

// PUT /settings — update family settings (owner/admin)
async function handleUpdateSettings(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const { categories, categoryOptions, shareAnonymizedDaily } = (c.req as any).valid('json');

	const existing = await db.execute({
		sql: 'SELECT categories, category_options, share_anonymized_daily FROM family_settings WHERE family_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});

	if (existing.rows.length === 0) {
		await db.execute({
			sql: 'INSERT INTO family_settings (family_id, categories, category_options, share_anonymized_daily) VALUES (?, ?, ?, ?)',
			args: [NAMESPACE_HOUSEHOLD_ID, categories ? JSON.stringify(categories) : null, categoryOptions ? JSON.stringify(categoryOptions) : JSON.stringify({}), shareAnonymizedDaily ? 1 : 0],
		});
	} else {
		const cur = settingsShape(existing.rows[0]);
		const nextCategories = categories !== undefined ? categories : cur.categories;
		const nextOptions = categoryOptions !== undefined ? categoryOptions : cur.categoryOptions;
		const nextShare = shareAnonymizedDaily !== undefined ? shareAnonymizedDaily : cur.shareAnonymizedDaily;
		await db.execute({
			sql: 'UPDATE family_settings SET categories = ?, category_options = ?, share_anonymized_daily = ?, updated_at = ? WHERE family_id = ?',
			args: [nextCategories ? JSON.stringify(nextCategories) : null, JSON.stringify(nextOptions ?? {}), nextShare ? 1 : 0, isoNow(), NAMESPACE_HOUSEHOLD_ID],
		});
	}

	const fres = await db.execute({
		sql: 'SELECT categories, category_options, share_anonymized_daily FROM family_settings WHERE family_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	return c.json({ message: 'Settings updated', settings: settingsShape(fres.rows[0]), anonymizedPreview: await buildAnonymizedDailyPreview(db) });
}

async function handleAnonymizedPreview(c: Context<AuthEnv>) {
	const db = c.get('db');
	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);
	return c.json({ preview: await buildAnonymizedDailyPreview(db) });
}

// GET /export — JSON export (owner/admin)
async function handleExportFamily(c: Context<AuthEnv>) {
	const userId = c.get('userId');
	const registryFamilyId = c.get('familyId');
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const members = (await db.execute({
		sql: `
			SELECT fm.id, fm.legacy_baby_id, fm.name, fm.birth_date, fm.gender, fm.member_type, fm.email, fm.avatar, fm.categories,
			       CASE WHEN am.user_id IS NULL THEN 0 ELSE 1 END AS linked_account
			FROM family_members fm
			LEFT JOIN account_members am ON am.member_id = fm.id
			WHERE fm.household_id = ?
			ORDER BY fm.created_at
		`,
		args: [NAMESPACE_HOUSEHOLD_ID],
	})).rows.map(memberShape);

	const formulas = (await db.execute({
		sql: 'SELECT id, name, brand FROM formulas WHERE family_id = ? ORDER BY name',
		args: [NAMESPACE_HOUSEHOLD_ID],
	})).rows.map((r) => ({ id: Number(r?.id), name: r?.name, brand: r?.brand }));

	const registry = await ensureRegistry();
	const registryRes = await registry.execute({
		sql: 'SELECT family_id, name, family_code, status FROM families WHERE family_id = ? LIMIT 1',
		args: [registryFamilyId],
	});
	const family = registryRes.rows[0] || null;

	const exportData: { app: string; exportedAt: string; family: any; members: any[]; formulas: any[]; records: Record<string, unknown>; settings?: any; invitations?: any[] } = {
		app: 'Nido',
		exportedAt: new Date().toISOString(),
		family: family
			? { familyId: registryFamilyId, householdId: NAMESPACE_HOUSEHOLD_ID, name: (family as any).name, familyCode: (family as any).family_code, status: (family as any).status }
			: null,
		members,
		formulas,
		records: {},
	};
	const trackedIds = members
		.map((m: any) => Number(m.legacyBabyId || 0))
		.filter((id: number) => Number.isFinite(id) && id > 0);
	if (trackedIds.length > 0) {
		const ids = trackedIds.join(',');
		for (const table of EXPORT_TABLES) {
			const cols = table === 'milestones' ? 'id, baby_id, title, description, achieved_date, category, created_at'
				: table === 'growth' ? 'id, baby_id, measurement_date, weight, height, head_circumference, unit_system, notes, created_at'
				: table === 'sleep' ? 'id, baby_id, start_time, end_time, duration, location, notes, created_at'
				: table === 'diapers' ? 'id, baby_id, change_time, type, color, consistency, notes, created_at'
				: table === 'vaccinations' ? 'id, baby_id, name, date_given, next_due_date, administered_by, notes, created_at'
				: table === 'moods' ? 'id, baby_id, mood, recorded_at, notes, created_at'
				: table === 'journal_entries' ? 'id, baby_id, title, body, entry_date, created_at'
				: 'id, baby_id, start_time, end_time, duration, amount, type, side, formula_id, notes, created_at';
			const rows = await db.execute({ sql: `SELECT ${cols} FROM ${table} WHERE baby_id IN (${ids})`, args: [] });
			exportData.records[table] = rows.rows;
		}
	}

	const familySettingsRow = (await db.execute({ sql: 'SELECT categories, category_options, share_anonymized_daily FROM family_settings WHERE family_id = ?', args: [NAMESPACE_HOUSEHOLD_ID] })).rows[0];
	const invitations = (await db.execute({
		sql: 'SELECT email, status, created_at FROM family_invitations WHERE family_id = ? ORDER BY created_at',
		args: [NAMESPACE_HOUSEHOLD_ID],
	})).rows;
	exportData.settings = familySettingsRow ? {
		categories: familySettingsRow.categories ? JSON.parse(String(familySettingsRow.categories)) : null,
		categoryOptions: familySettingsRow.category_options ? JSON.parse(String(familySettingsRow.category_options)) : {},
		shareAnonymizedDaily: Number(familySettingsRow.share_anonymized_daily ?? 0) === 1,
	} : null;
	exportData.invitations = invitations.map((r) => ({ email: r?.email, status: r?.status, createdAt: r?.created_at }));
	return c.json(exportData);
}

// POST /restore — restore from backup (owner/admin)
async function handleRestoreFamily(c: Context<AuthEnv>) {
	const userId = c.get('userId');
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	let body: any;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON — upload a Nido backup file' }, 400);
	}

	// Resolve existing members by name so restores are idempotent.
	const existing = (await db.execute({
		sql: 'SELECT id, name FROM babies WHERE household_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	})).rows;
	const byName: Record<string, number> = {};
	for (const r of existing) {
		const n = String(r?.name || '');
		if (!byName[n]) byName[n] = Number(r?.id);
	}

	const memberIdMap: Record<number, number> = {};
	const members: any[] = Array.isArray(body.members) ? body.members : [];
	let membersAdded = 0;
	for (const m of members) {
		const name = String(m.name || '').trim() || 'Unnamed';
		if (byName[name]) {
			memberIdMap[Number(m.id)] = byName[name];
			continue;
		}
		const catRes = Array.isArray(m.categories) ? JSON.stringify(m.categories) : null;
		const ins = await db.execute({
			sql: `INSERT INTO babies (household_id, name, birth_date, gender, type, email, categories, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, name, m.birthDate || null, m.gender || null, m.type || 'child', m.email || null, catRes, isoNow(), isoNow()],
		});
		const newId = Number(ins.lastInsertRowid);
		const fmIns = await db.execute({
			sql: `INSERT INTO family_members (household_id, legacy_baby_id, name, member_type, birth_date, gender, email, avatar, categories, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [NAMESPACE_HOUSEHOLD_ID, newId, name, m.type || 'child', m.birthDate || null, m.gender || null, m.email || null, m.avatar || null, catRes, isoNow(), isoNow()],
		});
		const familyMemberId = Number(fmIns.lastInsertRowid);
		await db.execute({
			sql: 'INSERT OR IGNORE INTO member_homes (member_id, home_id, relation, is_primary, created_at) VALUES (?, ?, ?, 1, ?)',
			args: [familyMemberId, HOME_ID_PRIMARY, (m.type || 'child') === 'adult' ? 'resident' : 'child', isoNow()],
		});
		await linkAccountMemberByEmail(db, familyMemberId, m.email || null);
		memberIdMap[Number(m.id)] = newId;
		byName[name] = newId;
		membersAdded++;
	}

	// Formulas: match by name+brand to avoid duplicates; build formulaIdMap for feedings remap.
	const formulaIdMap: Record<number, number> = {};
	let formulasAdded = 0;
	for (const f of Array.isArray(body.formulas) ? body.formulas : []) {
		const oldFormulaId = Number(f.id);
		const dup = await db.execute({
			sql: 'SELECT id FROM formulas WHERE family_id = ? AND name = ? AND COALESCE(brand, \'\') = COALESCE(?, \'\') LIMIT 1',
			args: [NAMESPACE_HOUSEHOLD_ID, f.name, f.brand || null],
		});
		if (dup.rows.length > 0) {
			const row0 = dup.rows[0];
			const existingId = Number(row0?.id);
			formulaIdMap[oldFormulaId] = existingId;
			continue;
		}
		const ins = await db.execute({
			sql: 'INSERT INTO formulas (family_id, name, brand, formula_type) VALUES (?, ?, ?, ?)',
			args: [NAMESPACE_HOUSEHOLD_ID, f.name, f.brand || null, f.formulaType || 'standard'],
		});
		const newId = Number(ins.lastInsertRowid);
		formulaIdMap[oldFormulaId] = newId;
		formulasAdded++;
	}

	const records = (body.records ?? {}) as Record<string, any[]>;
	const recordCounts: Record<string, number> = {};
	for (const table of Object.keys(records)) {
		const rows = records[table] ?? [];
		let count = 0;
		for (const rec of rows) {
			const oldBaby = Number(rec?.baby_id);
			const babyId = memberIdMap[oldBaby] ?? oldBaby;
			try {
				if (table === 'feedings') {
					const mappedFormulaId = rec.formula_id == null ? null : (formulaIdMap[Number(rec.formula_id)] ?? null);
					await db.execute({ sql: `INSERT INTO feedings (baby_id, start_time, end_time, duration, amount, type, side, formula_id, notes, created_at)
					                        VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [babyId, rec.start_time, rec.end_time, rec.duration, rec.amount, rec.type, rec.side, mappedFormulaId, rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'diapers') {
					await db.execute({ sql: `INSERT INTO diapers (baby_id, change_time, type, color, consistency, notes, created_at) VALUES (?,?,?,?,?,?,?)`, args: [babyId, rec.change_time, rec.type, rec.color, rec.consistency, rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'sleep') {
					await db.execute({ sql: `INSERT INTO sleep (baby_id, start_time, end_time, duration, location, notes, created_at) VALUES (?,?,?,?,?,?,?)`, args: [babyId, rec.start_time, rec.end_time, rec.duration, rec.location, rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'growth') {
					await db.execute({ sql: `INSERT INTO growth (baby_id, measurement_date, weight, height, head_circumference, unit_system, notes, created_at) VALUES (?,?,?,?,?,?,?,?)`, args: [babyId, rec.measurement_date, rec.weight, rec.height, rec.head_circumference, rec.unit_system, rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'milestones') {
					await db.execute({ sql: `INSERT INTO milestones (baby_id, title, description, achieved_date, category, created_at) VALUES (?,?,?,?,?,?)`, args: [babyId, rec.title, rec.description, rec.achieved_date, rec.category, rec.created_at ?? isoNow()] });
				} else if (table === 'vaccinations') {
					await db.execute({ sql: `INSERT INTO vaccinations (baby_id, name, date_given, next_due_date, administered_by, notes, created_at) VALUES (?,?,?,?,?,?,?)`, args: [babyId, rec.name, rec.date_given, rec.next_due_date ?? rec.nextDueDate, rec.administered_by, rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'moods') {
					await db.execute({ sql: `INSERT INTO moods (baby_id, mood, recorded_at, notes, created_at) VALUES (?,?,?,?,?)`, args: [babyId, rec.mood, rec.recorded_at ?? rec.recordedAt ?? isoNow(), rec.notes, rec.created_at ?? isoNow()] });
				} else if (table === 'journal_entries') {
					await db.execute({ sql: `INSERT INTO journal_entries (baby_id, title, body, entry_date, created_at) VALUES (?,?,?,?,?)`, args: [babyId, rec.title, rec.body, rec.entry_date ?? rec.entryDate ?? isoNow(), rec.created_at ?? isoNow()] });
				}
				count++;
			} catch (e) {
				// skip malformed rows quietly
			}
		}
		recordCounts[table] = count;
	}

	// Restore family settings
	if (body.settings && typeof body.settings === 'object') {
		const cats = body.settings.categories;
		const opts = body.settings.categoryOptions ?? {};
		const share = body.settings.shareAnonymizedDaily === true ? 1 : 0;
		const existingSettings = await db.execute({ sql: 'SELECT family_id FROM family_settings WHERE family_id = ?', args: [NAMESPACE_HOUSEHOLD_ID] });
		if (existingSettings.rows.length === 0) {
			await db.execute({ sql: 'INSERT INTO family_settings (family_id, categories, category_options, share_anonymized_daily) VALUES (?,?,?,?)', args: [NAMESPACE_HOUSEHOLD_ID, cats ? JSON.stringify(cats) : null, JSON.stringify(opts), share] });
		} else {
			await db.execute({ sql: 'UPDATE family_settings SET categories = ?, category_options = ?, share_anonymized_daily = ? WHERE family_id = ?', args: [cats ? JSON.stringify(cats) : null, JSON.stringify(opts), share, NAMESPACE_HOUSEHOLD_ID] });
		}
	}

	// Restore audit row.
	// These two literals are written into import_runs and surface in export
	// history, so treat them as a stable schema value: changing them makes
	// older rows look like a different importer.
	const RESTORE_IMPORT_TYPE = 'nido_restore';
	const RESTORE_FILENAME = 'nido-backup.json';
	await db.execute({
		sql: 'INSERT INTO import_runs (family_id, baby_id, importer_user_id, import_type, filename, counts) VALUES (?, ?, ?, ?, ?, ?)',
		args: [NAMESPACE_HOUSEHOLD_ID, null, userId, RESTORE_IMPORT_TYPE, RESTORE_FILENAME, JSON.stringify(recordCounts)],
	});

	return c.json({
		message: 'Family restored',
		membersAdded,
		formulasAdded,
		recordCounts,
	});
}

// DELETE / — 501 (deferred to Phase D)
async function handleDeleteFamily(c: Context<AuthEnv>) {
	return c.json({ error: 'Family deletion is deferred to Phase D' }, 501);
}

// ── Canonical route registrations ──────────────────────────────────────────

familyRoutes.get('/', handleGetFamilies);
familyRoutes.post('/', handleCreateFamily);
familyRoutes.post('/join', zValidator('json', joinSchema), handleJoinFamily);

familyRoutes.get('/members', handleGetMembers);
familyRoutes.post('/members', zValidator('json', addMemberSchema), handleAddMember);
familyRoutes.put('/members/:memberId{[0-9]+}', zValidator('json', updateMemberSchema), handleUpdateMember);
familyRoutes.delete('/members/:memberId{[0-9]+}', handleDeleteMember);

familyRoutes.post('/members/:memberId{[0-9]+}/avatar', handleUploadAvatar);
familyRoutes.get('/members/:memberId{[0-9]+}/avatar', handleGetAvatar);

familyRoutes.post('/invitations', zValidator('json', inviteSchema), handleCreateInvitation);
familyRoutes.get('/invitations', handleGetInvitations);
familyRoutes.delete('/invitations/:inviteId{[0-9]+}', handleDeleteInvitation);

familyRoutes.get('/settings', handleGetSettings);
familyRoutes.put('/settings', zValidator('json', settingsSchema), handleUpdateSettings);
familyRoutes.get('/settings/anonymized-preview', handleAnonymizedPreview);

familyRoutes.get('/export', handleExportFamily);
familyRoutes.post('/restore', handleRestoreFamily);

familyRoutes.delete('/', handleDeleteFamily);

// ── Legacy alias routes (validateFamilyRef, then delegate) ─────────────────

familyRoutes.get('/:familyRef/members', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleGetMembers(c);
});
familyRoutes.post('/:familyRef/members', zValidator('json', addMemberSchema), async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleAddMember(c);
});

familyRoutes.put('/:familyRef/members/:memberId{[0-9]+}', zValidator('json', updateMemberSchema), async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleUpdateMember(c);
});
familyRoutes.delete('/:familyRef/members/:memberId{[0-9]+}', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleDeleteMember(c);
});

familyRoutes.get('/:familyRef/members/:memberId{[0-9]+}/avatar', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleGetAvatar(c);
});
familyRoutes.post('/:familyRef/members/:memberId{[0-9]+}/avatar', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleUploadAvatar(c);
});

familyRoutes.get('/:familyRef/invitations', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleGetInvitations(c);
});
familyRoutes.post('/:familyRef/invitations', zValidator('json', inviteSchema), async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleCreateInvitation(c);
});
familyRoutes.delete('/:familyRef/invitations/:inviteId{[0-9]+}', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleDeleteInvitation(c);
});

familyRoutes.get('/:familyRef/settings', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleGetSettings(c);
});
familyRoutes.put('/:familyRef/settings', zValidator('json', settingsSchema), async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleUpdateSettings(c);
});
familyRoutes.get('/:familyRef/settings/anonymized-preview', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleAnonymizedPreview(c);
});

familyRoutes.get('/:familyRef/export', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleExportFamily(c);
});
familyRoutes.post('/:familyRef/restore', async (c) => {
	if (!validateFamilyRef(c)) return c.json({ error: 'Family not found' }, 404);
	return handleRestoreFamily(c);
});

// DELETE /:familyRef — broad, last; 501
familyRoutes.delete('/:familyRef', handleDeleteFamily);

export { familyRoutes };
