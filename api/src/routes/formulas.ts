import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { type AuthEnv } from '../auth';
import { DEFAULT_FORMULA_CATALOG } from '../data/formula-catalog';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';

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

async function seedFormulaCatalog(db: any, familyId: number) {
	try {
		const existing = await db.execute({
			sql: 'SELECT name, COALESCE(brand, \'\') AS brand FROM formulas WHERE family_id = ?',
			args: [familyId],
		});

		const keys = new Set(
			existing.rows.map((r: any) => `${String(r?.name || '').trim().toLowerCase()}::${String(r?.brand || '').trim().toLowerCase()}`),
		);

		for (const formula of DEFAULT_FORMULA_CATALOG) {
			const key = `${formula.name.trim().toLowerCase()}::${formula.brand.trim().toLowerCase()}`;
			if (keys.has(key)) continue;
			await db.execute({
				sql: 'INSERT OR IGNORE INTO formulas (family_id, name, brand, formula_type, created_at) VALUES (?, ?, ?, ?, ?)',
				args: [familyId, formula.name, formula.brand, formula.formulaType, isoNow()],
			});
			keys.add(key);
		}
	} catch (err) {
		console.error('seedFormulaCatalog failed:', err);
	}
}

// GET / — list this family's formula catalog (within the current namespace).
formulaRoutes.get('/', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const householdId = NAMESPACE_HOUSEHOLD_ID;

	const role = await familyRole(db, userId, householdId);
	if (!role) {
		console.error('[formulas] familyRole returned null — userId=%s householdId=%d', userId, householdId);
		return c.json({ error: 'Not a member of this family' }, 403);
	}

	await seedFormulaCatalog(db, householdId);

	const res = await db.execute({
		sql: 'SELECT id, name, brand, formula_type, created_at FROM formulas WHERE family_id = ? ORDER BY name',
		args: [householdId],
	});
	console.log('[formulas] returned %d formulas for householdId=%d', res.rows.length, householdId);
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
	name: z.string().min(1).max(80),
	brand: z.string().max(80).optional(),
	formulaType: z.string().min(1).max(80).default('standard').optional(),
});

formulaRoutes.post('/', zValidator('json', formulaSchema), async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const { name, brand, formulaType } = c.req.valid('json');
	const householdId = NAMESPACE_HOUSEHOLD_ID;

	if (!(await familyRole(db, userId, householdId))) return c.json({ error: 'Not a member of this family' }, 403);

	const ins = await db.execute({
		sql: 'INSERT INTO formulas (family_id, name, brand, formula_type, created_at) VALUES (?, ?, ?, ?, ?)',
		args: [householdId, name, brand || null, formulaType || 'standard', isoNow()],
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
