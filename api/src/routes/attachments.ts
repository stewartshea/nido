// routes/attachments.ts
//
// Files attached to a record.
//
// The bytes go through the encrypted blob store, so an attachment is inside the
// same tenancy boundary as everything else: its key is derived from the family
// and its address is authenticated, which is what the older plaintext `photos`
// directory does not do.
//
// `ref_type` names the table the file hangs off, not the tracking category. An
// appointment, a medication dose and a vaccination report are all milestone
// rows, so they are all ref_type='milestone' — which is why adding attachments
// here covers the vet visit and the GP appointment without new entities.
import { Hono } from 'hono';
import { Readable } from 'node:stream';
import type { SqliteFacade } from '../db-core';
import { type AuthEnv } from '../auth';
import { EncryptedBlobStore } from '../blob-store';

const attachmentRoutes = new Hono<AuthEnv>();

/** ref_type -> the table it points at. */
const REF_TABLES: Record<string, string> = {
	feeding: 'feedings',
	diaper: 'diapers',
	sleep: 'sleep',
	growth: 'growth',
	milestone: 'milestones',
	vaccination: 'vaccinations',
	mood: 'moods',
	journal: 'journal_entries',
	subject: 'subjects',
};

const MAX_BYTES = 25 * 1024 * 1024;

let store: EncryptedBlobStore | null = null;
function blobStore(): EncryptedBlobStore {
	if (!store) store = EncryptedBlobStore.fromEnv();
	return store;
}

/**
 * Does this record exist in this family, and which subject is it for?
 *
 * A profile attachment is addressed by the member id, because that is the id
 * every caller and every screen already has. It is resolved to the subjects row
 * here rather than pushed onto the caller: family_members.id and subjects.id are
 * different numbers that only sometimes coincide, and making the UI know that
 * would be the exact confusion the subject rename existed to remove.
 */
async function resolveRef(db: SqliteFacade, refType: string, refId: number): Promise<{ subjectId: number | null } | null> {
	if (refType === 'subject') {
		const member = (await db.execute({
			sql: 'SELECT legacy_subject_id FROM family_members WHERE id = ? LIMIT 1',
			args: [refId],
		})).rows[0] as { legacy_subject_id?: number } | undefined;
		if (!member || member.legacy_subject_id === null || member.legacy_subject_id === undefined) return null;
		return { subjectId: Number(member.legacy_subject_id) };
	}
	const table = REF_TABLES[refType];
	if (!table) return null;
	const row = (await db.execute({
		sql: `SELECT subject_id FROM ${table} WHERE id = ? LIMIT 1`,
		args: [refId],
	})).rows[0] as { subject_id?: number } | undefined;
	if (!row) return null;
	return { subjectId: row.subject_id === undefined || row.subject_id === null ? null : Number(row.subject_id) };
}

// POST / — multipart: refType, refId, file
attachmentRoutes.post('/', async (c) => {
	const db = c.get('db');
	const familyId = c.get('familyId');
	const userId = c.get('userId');

	const form = await c.req.formData();
	const refType = String(form.get('refType') ?? '');
	const refId = Number(form.get('refId') ?? 0);
	const file = form.get('file');
	const note = form.get('note');

	if (!REF_TABLES[refType]) {
		return c.json({ error: `refType must be one of ${Object.keys(REF_TABLES).join('|')}` }, 400);
	}
	if (!Number.isInteger(refId) || refId <= 0) return c.json({ error: 'refId is required' }, 400);
	if (!file || typeof file === 'string') return c.json({ error: 'Missing file' }, 400);
	if (file.size > MAX_BYTES) return c.json({ error: `File exceeds the ${MAX_BYTES} byte limit` }, 413);

	const ref = await resolveRef(db, refType, refId);
	if (!ref) return c.json({ error: 'Record not found' }, 404);

	try {
		const put = await blobStore().put(familyId, Readable.fromWeb(file.stream() as any), { maxBytes: MAX_BYTES });
		const ins = await db.execute({
			sql: `INSERT INTO attachments (subject_id, ref_type, ref_id, blob_id, storage_key, filename, content_type, size, created_at, created_by)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				ref.subjectId,
				refType,
				refId,
				put.blobId,
				put.storageKey,
				file.name || null,
				file.type || 'application/octet-stream',
				put.size,
				new Date().toISOString(),
				userId,
			],
		});
		return c.json(
			{
				attachment: {
					id: Number(ins.lastInsertRowid),
					refType,
					refId,
					filename: file.name || null,
					contentType: file.type || 'application/octet-stream',
					size: put.size,
					sha256: put.sha256,
					note: note ? String(note) : null,
					url: `/api/v1/attachments/${Number(ins.lastInsertRowid)}/file`,
				},
			},
			201,
		);
	} catch (err) {
		c.get('log').error('attachment upload failed', { err });
		return c.json({ error: 'Could not store that file' }, 500);
	}
});

// GET /?refType=&refId= — list a record's attachments
attachmentRoutes.get('/', async (c) => {
	const db = c.get('db');
	const refType = c.req.query('refType') ?? '';
	const refId = Number(c.req.query('refId') ?? 0);
	if (!REF_TABLES[refType] || !refId) return c.json({ error: 'refType and refId are required' }, 400);

	const rows = (await db.execute({
		sql: `SELECT id, subject_id, ref_type, ref_id, filename, content_type, size, created_at, created_by
		      FROM attachments WHERE ref_type = ? AND ref_id = ? ORDER BY created_at DESC`,
		args: [refType, refId],
	})).rows;

	return c.json({
		attachments: rows.map((r: any) => ({
			id: Number(r.id),
			subjectId: r.subject_id === null ? null : Number(r.subject_id),
			refType: String(r.ref_type),
			refId: Number(r.ref_id),
			filename: r.filename ?? null,
			contentType: String(r.content_type),
			size: Number(r.size),
			createdAt: r.created_at,
			createdBy: r.created_by ?? null,
			url: `/api/v1/attachments/${Number(r.id)}/file`,
		})),
	});
});

// GET /:id/file — the decrypted bytes
attachmentRoutes.get('/:id{[0-9]+}/file', async (c) => {
	const db = c.get('db');
	const familyId = c.get('familyId');
	const id = Number(c.req.param('id'));

	const row = (await db.execute({
		sql: 'SELECT blob_id, storage_key, filename, content_type, created_at FROM attachments WHERE id = ? LIMIT 1',
		args: [id],
	})).rows[0] as any;
	if (!row) return c.json({ error: 'Attachment not found' }, 404);

	try {
		const stream = await blobStore().open(familyId, String(row.blob_id), new Date(String(row.created_at)));
		return new Response(Readable.toWeb(stream) as any, {
			status: 200,
			headers: {
				'Content-Type': String(row.content_type),
				'Cache-Control': 'private, max-age=31536000',
				...(row.filename ? { 'Content-Disposition': `inline; filename="${String(row.filename).replace(/"/g, '')}"` } : {}),
			},
		});
	} catch (err) {
		c.get('log').error('attachment read failed', { err });
		return c.json({ error: 'Could not read that file' }, 500);
	}
});

// DELETE /:id — remove the row and its bytes
attachmentRoutes.delete('/:id{[0-9]+}', async (c) => {
	const db = c.get('db');
	const familyId = c.get('familyId');
	const id = Number(c.req.param('id'));

	const row = (await db.execute({
		sql: 'SELECT blob_id, created_at FROM attachments WHERE id = ? LIMIT 1',
		args: [id],
	})).rows[0] as any;
	if (!row) return c.json({ error: 'Attachment not found' }, 404);

	await blobStore().remove(familyId, String(row.blob_id), new Date(String(row.created_at)));
	await db.execute({ sql: 'DELETE FROM attachments WHERE id = ?', args: [id] });
	return c.json({ message: 'Attachment removed' });
});

export { attachmentRoutes };
