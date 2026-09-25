import { Hono } from 'hono';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqliteFacade } from '../db-core';
import { type AuthEnv } from '../auth';

const PHOTO_DIR = process.env.PHOTO_DIR || '/data/photos';

const PARENT_TYPES = ['feeding', 'diaper', 'sleep', 'growth', 'milestone'] as const;
const PARENT_TYPE_VALUES = [...PARENT_TYPES] as [string, ...string[]];

const PLURAL = { feeding: 'feedings', diaper: 'diapers', sleep: 'sleep', growth: 'growth', milestone: 'milestones' } as Record<string, string>;

async function familyOfMember(db: SqliteFacade, userId: string, parentType: string, parentId: number): Promise<number | null> {
	const res = await db.execute({
		sql: `SELECT b.household_id AS family_id
		      FROM ${PLURAL[parentType]} r
		      JOIN babies b ON b.id = r.baby_id
		      WHERE r.id = ? LIMIT 1`,
		args: [parentId],
	});
	const row = res.rows[0];
	if (!row) return null;
	const familyId = Number(row.family_id);
	const access = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, familyId],
	});
	return access.rows.length > 0 ? familyId : null;
}

const photoRoutes = new Hono<AuthEnv>();


// POST / — upload a photo attached to a family record.
// Multipart fields: parentType, parentId, file.
photoRoutes.post('/', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');

	const form = await c.req.formData();
	const parentType = form.get('parentType');
	const parentIdRaw = form.get('parentId');
	const file = form.get('file');
	if (typeof parentType !== 'string' || !PARENT_TYPE_VALUES.includes(parentType)) {
		return c.json({ error: 'parentType must be feeding|diaper|sleep|growth|milestone' }, 400);
	}
	if (typeof parentIdRaw !== 'string' || !/^\d+$/.test(parentIdRaw)) {
		return c.json({ error: 'parentId is required' }, 400);
	}
	const parentId = Number(parentIdRaw);
	if (!file || typeof file === 'string') return c.json({ error: 'Missing image file' }, 400);

	const familyId = await familyOfMember(db, userId, parentType, parentId);
	if (!familyId) return c.json({ error: 'Record not found in your household' }, 404);

	const buf = Buffer.from(await file.arrayBuffer());
	const mime = file.type || 'application/octet-stream';
	if (!mime.startsWith('image/')) return c.json({ error: 'Only image uploads are allowed' }, 400);

	await mkdir(PHOTO_DIR, { recursive: true });
	const name = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	await writeFile(join(PHOTO_DIR, name), buf);

	const ins = await db.execute({
		sql: `INSERT INTO photos (family_id, parent_type, parent_id, file_path, mime, added_by, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		args: [familyId, parentType, parentId, name, mime, userId, new Date().toISOString()],
	});

	return c.json({
		message: 'Photo uploaded',
		photo: {
			id: Number(ins.lastInsertRowid),
			parentType,
			parentId,
			url: `/api/v1/photos/${Number(ins.lastInsertRowid)}/file`,
			mime,
		},
	}, 201);
});

// GET /?parentType=&parentId= — list photos for a record (family-scoped).
photoRoutes.get('/', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const parentType = c.req.query('parentType') ?? '';
	const parentId = parseInt(c.req.query('parentId') || '0');
	if (!parentType || !parentId || !PARENT_TYPE_VALUES.includes(parentType)) {
		return c.json({ error: 'parentType and parentId are required' }, 400);
	}

	const familyId = await familyOfMember(db, userId, parentType, parentId);
	if (!familyId) return c.json({ error: 'Record not found in your household' }, 404);

	const res = await db.execute({
		sql: `SELECT id, parent_type, parent_id, mime FROM photos
		      WHERE family_id = ? AND parent_type = ? AND parent_id = ?
		      ORDER BY created_at`,
		args: [familyId, parentType, parentId],
	});
	const photos = res.rows.map((r) => ({
		id: Number(r?.id),
		parentType: r?.parent_type,
		parentId: Number(r?.parent_id),
		url: `/api/v1/photos/${Number(r?.id)}/file`,
		mime: r?.mime,
	}));
	return c.json({ photos });
});

// GET /:id/file — serve the actual image bytes (family-scoped).
photoRoutes.get('/:id{[0-9]+}/file', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const photoId = parseInt(c.req.param('id'));

	const rowRes = await db.execute({
		sql: `SELECT family_id, file_path, mime FROM photos WHERE id = ? LIMIT 1`,
		args: [photoId],
	});
	const row = rowRes.rows[0];
	if (!row) return c.json({ error: 'Photo not found' }, 404);

	const access = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, Number(row.family_id)],
	});
	if (access.rows.length === 0) return c.json({ error: 'Access denied' }, 403);

	try {
		const data = await readFile(join(PHOTO_DIR, String(row.file_path)));
		return new Response(data, {
			status: 200,
			headers: {
				'Content-Type': String(row.mime),
				'Cache-Control': 'private, max-age=31536000',
			},
		});
	} catch {
		return c.json({ error: 'Photo file missing' }, 404);
	}
});

// DELETE /:id — remove a photo (family-scoped).
photoRoutes.delete('/:id{[0-9]+}', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const photoId = parseInt(c.req.param('id'));

	const rowRes = await db.execute({
		sql: `SELECT id, family_id, file_path FROM photos WHERE id = ? LIMIT 1`,
		args: [photoId],
	});
	const row = rowRes.rows[0];
	if (!row) return c.json({ error: 'Photo not found' }, 404);

	const access = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, Number(row.family_id)],
	});
	if (access.rows.length === 0) return c.json({ error: 'Access denied' }, 403);

	await db.execute({ sql: 'DELETE FROM photos WHERE id = ?', args: [photoId] });
	try {
		await rm(join(PHOTO_DIR, String(row.file_path)), { force: true });
	} catch {}
	return c.json({ message: 'Photo deleted' });
});

export { photoRoutes };