import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type AuthEnv } from '../auth';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { ensureRegistry } from '../db-namespaces';

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
		type: row.type || 'child',
		email: row.email || null,
		avatar: row.avatar || null,
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
});

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
		sql: 'SELECT COUNT(*) AS cnt FROM babies WHERE household_id = ?',
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

// POST /join — 501 (deferred)
async function handleJoinFamily(c: Context<AuthEnv>) {
	return c.json({ error: 'Invitation acceptance is deferred for the one-family-per-account model' }, 501);
}

// GET /members — list members
async function handleGetMembers(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const res = await db.execute({
		sql: 'SELECT id, name, birth_date, gender, type, email, avatar, categories FROM babies WHERE household_id = ? ORDER BY created_at',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	return c.json({ members: res.rows.map(memberShape) });
}

// POST /members — add a member
async function handleAddMember(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const { type, name, birthDate, gender, email, categories } = (c.req as any).valid('json');

	// Guard against accidental duplicates
	const dup = await db.execute({
		sql: 'SELECT id FROM babies WHERE household_id = ? AND name = ? AND (birth_date IS ? OR birth_date = ?) LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID, name, birthDate ?? null, birthDate ?? null],
	});
	if (dup.rows.length > 0) {
		return c.json({ error: `${name} is already in this family (same name and birth date).` }, 409);
	}

	const memberCategories = categories ?? DEFAULT_CATEGORIES;
	const ins = await db.execute({
		sql: `INSERT INTO babies (household_id, name, birth_date, gender, type, email, categories, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [NAMESPACE_HOUSEHOLD_ID, name, birthDate || null, gender || null, type || 'child', email || null, JSON.stringify(memberCategories), isoNow(), isoNow()],
	});
	const member = { id: Number(ins.lastInsertRowid), name, birthDate: birthDate || null, gender: gender || null, type: type || 'child', email: email || null, categories: memberCategories };
	return c.json({ message: 'Family member added', member }, 201);
}

// PUT /members/:memberId — update a member
async function handleUpdateMember(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const rowRes = await db.execute({
		sql: 'SELECT id FROM babies WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (rowRes.rows.length === 0) return c.json({ error: 'Member not found' }, 404);

	const { type, name, birthDate, gender, email, categories } = (c.req as any).valid('json');
	const updates: string[] = [];
	const params: Array<number | string | null> = [];
	if (type) { updates.push('type = ?'); params.push(type); }
	if (name !== undefined) { updates.push('name = ?'); params.push(name); }
	if (birthDate !== undefined) { updates.push('birth_date = ?'); params.push(birthDate); }
	if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
	if (email !== undefined) { updates.push('email = ?'); params.push(email); }
	if (categories) { updates.push('categories = ?'); params.push(JSON.stringify(categories)); }
	if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
	updates.push('updated_at = ?'); params.push(isoNow());
	params.push(memberId, NAMESPACE_HOUSEHOLD_ID);

	await db.execute({ sql: `UPDATE babies SET ${updates.join(', ')} WHERE id = ? AND household_id = ?`, args: params });

	const memRes = await db.execute({
		sql: 'SELECT id, name, birth_date, gender, type, email, avatar, categories FROM babies WHERE id = ? AND household_id = ?',
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
		sql: 'SELECT id, avatar FROM babies WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memRes.rows.length === 0) return c.json({ error: 'Member not found' }, 404);
	const avatar = memRes.rows[0]?.avatar;

	// Photo cleanup: collect record ids per parent type, then delete photos
	for (const [table, parentType] of Object.entries(PHOTO_PARENT_TYPES)) {
		const ids = (await db.execute({ sql: `SELECT id FROM ${table} WHERE baby_id = ?`, args: [memberId] })).rows.map((r: any) => Number(r.id));
		if (ids.length > 0) {
			const placeholders = ids.map(() => '?').join(',');
			await db.execute({
				sql: `DELETE FROM photos WHERE family_id = ? AND parent_type = ? AND parent_id IN (${placeholders})`,
				args: [NAMESPACE_HOUSEHOLD_ID, parentType, ...ids],
			});
		}
	}

	for (const table of EXPORT_TABLES) {
		await db.execute({ sql: `DELETE FROM ${table} WHERE baby_id = ?`, args: [memberId] });
	}
	await db.execute({ sql: 'DELETE FROM import_log WHERE baby_id = ?', args: [memberId] });
	await db.execute({
		sql: `DELETE FROM reminders WHERE target_type = 'member' AND target_id = ?`,
		args: [memberId],
	});

	if (avatar) {
		try { await rm(join(AVATAR_DIR, String(avatar)), { force: true }); } catch { /* already gone */ }
	}

	await db.execute({ sql: 'DELETE FROM babies WHERE id = ? AND household_id = ?', args: [memberId, NAMESPACE_HOUSEHOLD_ID] });
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
		sql: 'SELECT id FROM babies WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memCheck.rows.length === 0) return c.json({ error: 'Member not found' }, 404);

	const buf = Buffer.from(await file.arrayBuffer());
	const mime = file.type || 'application/octet-stream';
	if (!mime.startsWith('image/')) return c.json({ error: 'Only image uploads are allowed' }, 400);

	await mkdir(AVATAR_DIR, { recursive: true });
	const avatarName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	await writeFile(join(AVATAR_DIR, avatarName), buf);

	await db.execute({ sql: 'UPDATE babies SET avatar = ?, updated_at = ? WHERE id = ? AND household_id = ?', args: [avatarName, isoNow(), memberId, NAMESPACE_HOUSEHOLD_ID] });

	return c.json({ message: 'Avatar uploaded', avatar: avatarName });
}

// GET /members/:memberId/avatar — fetch avatar
async function handleGetAvatar(c: Context<AuthEnv>) {
	const db = c.get('db');
	const memberId = Number(c.req.param('memberId'));

	const role = await familyAccess(c);
	if (!role) return c.json({ error: 'No family access' }, 403);

	const memCheck = await db.execute({
		sql: 'SELECT id FROM babies WHERE id = ? AND household_id = ? LIMIT 1',
		args: [memberId, NAMESPACE_HOUSEHOLD_ID],
	});
	if (memCheck.rows.length === 0) return c.json({ error: 'Member not found' }, 404);

	const res = await db.execute({ sql: 'SELECT avatar FROM babies WHERE id = ? AND household_id = ? LIMIT 1', args: [memberId, NAMESPACE_HOUSEHOLD_ID] });
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
	if (existing.rows.length > 0) {
		const row = existing.rows[0] as unknown as { id: number; email: string; token: string; status: string };
		if (String(row.status) === 'pending') {
			return c.json({ message: 'An invitation to this email is already pending', invitation: { id: Number(row.id), email: row.email, token: row.token, status: row.status } });
		}
	}

	const token = generateInviteToken();
	const ins = await db.execute({
		sql: `INSERT INTO family_invitations (family_id, email, inviter_user_id, token, status, created_at)
		      VALUES (?, ?, ?, ?, 'pending', ?)`,
		args: [NAMESPACE_HOUSEHOLD_ID, normalized, userId, token, isoNow()],
	});
	return c.json(
		{
			message: 'Invitation sent',
			invitation: { id: Number(ins.lastInsertRowid), email: normalized, token, status: 'pending' },
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
		sql: 'SELECT categories, category_options FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	const row = res.rows[0] || null;
	return c.json({ settings: { ...settingsShape(row), defaultCategoryOptions: DEFAULT_CATEGORY_OPTIONS } });
}

// PUT /settings — update family settings (owner/admin)
async function handleUpdateSettings(c: Context<AuthEnv>) {
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const { categories, categoryOptions } = (c.req as any).valid('json');

	const existing = await db.execute({
		sql: 'SELECT categories, category_options FROM family_settings WHERE family_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});

	if (existing.rows.length === 0) {
		await db.execute({
			sql: 'INSERT INTO family_settings (family_id, categories, category_options) VALUES (?, ?, ?)',
			args: [NAMESPACE_HOUSEHOLD_ID, categories ? JSON.stringify(categories) : null, categoryOptions ? JSON.stringify(categoryOptions) : JSON.stringify({})],
		});
	} else {
		const cur = settingsShape(existing.rows[0]);
		const nextCategories = categories !== undefined ? categories : cur.categories;
		const nextOptions = categoryOptions !== undefined ? categoryOptions : cur.categoryOptions;
		await db.execute({
			sql: 'UPDATE family_settings SET categories = ?, category_options = ?, updated_at = ? WHERE family_id = ?',
			args: [nextCategories ? JSON.stringify(nextCategories) : null, JSON.stringify(nextOptions ?? {}), isoNow(), NAMESPACE_HOUSEHOLD_ID],
		});
	}

	const fres = await db.execute({
		sql: 'SELECT categories, category_options FROM family_settings WHERE family_id = ?',
		args: [NAMESPACE_HOUSEHOLD_ID],
	});
	return c.json({ message: 'Settings updated', settings: settingsShape(fres.rows[0]) });
}

// GET /export — JSON export (owner/admin)
async function handleExportFamily(c: Context<AuthEnv>) {
	const userId = c.get('userId');
	const registryFamilyId = c.get('familyId');
	const db = c.get('db');

	const role = await familyAccess(c, ['owner', 'admin']);
	if (!role) return c.json({ error: 'Owner or admin required' }, 403);

	const members = (await db.execute({
		sql: 'SELECT id, name, birth_date, gender, type, email, avatar, categories FROM babies WHERE household_id = ? ORDER BY created_at',
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
	if (members.length > 0) {
		const ids = members.map((m) => m.id).join(',');
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

	const familySettingsRow = (await db.execute({ sql: 'SELECT categories, category_options FROM family_settings WHERE family_id = ?', args: [NAMESPACE_HOUSEHOLD_ID] })).rows[0];
	const invitations = (await db.execute({
		sql: 'SELECT email, status, created_at FROM family_invitations WHERE family_id = ? ORDER BY created_at',
		args: [NAMESPACE_HOUSEHOLD_ID],
	})).rows;
	exportData.settings = familySettingsRow ? { categories: familySettingsRow.categories ? JSON.parse(String(familySettingsRow.categories)) : null, categoryOptions: familySettingsRow.category_options ? JSON.parse(String(familySettingsRow.category_options)) : {} } : null;
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
			sql: 'INSERT INTO formulas (family_id, name, brand) VALUES (?, ?, ?)',
			args: [NAMESPACE_HOUSEHOLD_ID, f.name, f.brand || null],
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
		const existingSettings = await db.execute({ sql: 'SELECT family_id FROM family_settings WHERE family_id = ?', args: [NAMESPACE_HOUSEHOLD_ID] });
		if (existingSettings.rows.length === 0) {
			await db.execute({ sql: 'INSERT INTO family_settings (family_id, categories, category_options) VALUES (?,?,?)', args: [NAMESPACE_HOUSEHOLD_ID, cats ? JSON.stringify(cats) : null, JSON.stringify(opts)] });
		} else {
			await db.execute({ sql: 'UPDATE family_settings SET categories = ?, category_options = ? WHERE family_id = ?', args: [cats ? JSON.stringify(cats) : null, JSON.stringify(opts), NAMESPACE_HOUSEHOLD_ID] });
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
familyRoutes.post('/join', handleJoinFamily);

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