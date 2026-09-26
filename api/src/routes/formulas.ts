import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';

const formulaRoutes = new Hono<AuthEnv>();

function isoNow(): string {
	return new Date().toISOString();
}

// Helper: resolve user's role for a family (null if not a member).
async function familyRole(db: any, userId: string, familyId: number) {
	const res = await db.execute({
		sql: 'SELECT role FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, familyId],
	});
	return res.rows[0]?.role ? String(res.rows[0].role) : null;
}

// GET /?familyId= — list this family's formula catalog.
formulaRoutes.get('/', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const familyId = parseInt(c.req.query('familyId') || '0');
	if (!familyId) return c.json({ error: 'familyId is required' }, 400);
	if (!(await familyRole(db, userId, familyId))) return c.json({ error: 'Not a member of this family' }, 403);

	const res = await db.execute({
		sql: 'SELECT id, name, brand, formula_type, created_at FROM formulas WHERE family_id = ? ORDER BY name',
		args: [familyId],
	});
	return c.json({
		formulas: res.rows.map((r) => ({
			id: Number(r?.id),
			name: r?.name,
			brand: r?.brand,
			formulaType: r?.formula_type || 'standard',
		})),
	});
});

const formulaSchema = z.object({
	familyId: z.number(),
	name: z.string().min(1).max(80),
	brand: z.string().max(80).optional(),
	formulaType: z.string().min(1).max(80).default('standard').optional(),
});

// POST / — add a formula to the family catalog.
formulaRoutes.post('/', zValidator('json', formulaSchema), async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const { familyId, name, brand, formulaType } = c.req.valid('json');

	const role = await familyRole(db, userId, familyId);
	if (!role) return c.json({ error: 'Not a member of this family' }, 403);

	const ins = await db.execute({
		sql: 'INSERT INTO formulas (family_id, name, brand, formula_type, created_at) VALUES (?, ?, ?, ?, ?)',
		args: [familyId, name, brand || null, formulaType || 'standard', isoNow()],
	});
	return c.json(
		{ message: 'Formula added', formula: { id: Number(ins.lastInsertRowid), name, brand: brand || null, formulaType: formulaType || 'standard' } },
		201,
	);
});

const updateSchema = z.object({
	name: z.string().min(1).max(80).optional(),
	brand: z.string().max(80).optional().nullable(),
	formulaType: z.string().max(80).optional().nullable(),
});

// PUT /:id — rename/rebrand a formula (family owner/admin).
formulaRoutes.put('/:id{[0-9]+}', zValidator('json', updateSchema), async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const formulaId = parseInt(c.req.param('id'));

	const rowRes = await db.execute({ sql: 'SELECT family_id FROM formulas WHERE id = ?', args: [formulaId] });
	const row = rowRes.rows[0];
	if (!row) return c.json({ error: 'Formula not found' }, 404);

	const role = await familyRole(db, userId, Number(row.family_id));
	if (!role || (role !== 'owner' && role !== 'admin')) return c.json({ error: 'Owner or admin required' }, 403);

	const { name, brand, formulaType } = c.req.valid('json');
	await db.execute({
		sql: 'UPDATE formulas SET name = COALESCE(?, name), brand = COALESCE(?, brand), formula_type = COALESCE(?, formula_type) WHERE id = ?',
		args: [name ?? null, brand ?? null, formulaType ?? null, formulaId],
	});
	return c.json({ message: 'Formula updated' });
});

// DELETE /:id — remove from catalog (family owner/admin).
formulaRoutes.delete('/:id{[0-9]+}', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const formulaId = parseInt(c.req.param('id'));

	const rowRes = await db.execute({ sql: 'SELECT family_id FROM formulas WHERE id = ?', args: [formulaId] });
	const row = rowRes.rows[0];
	if (!row) return c.json({ error: 'Formula not found' }, 404);

	const role = await familyRole(db, userId, Number(row.family_id));
	if (!role || (role !== 'owner' && role !== 'admin')) return c.json({ error: 'Owner or admin required' }, 403);

	await db.execute({ sql: 'DELETE FROM formulas WHERE id = ?', args: [formulaId] });
	return c.json({ message: 'Formula deleted' });
});

export { formulaRoutes };
