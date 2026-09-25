import { Hono } from 'hono';
import type { SqliteFacade } from '../db-core';
import { parseNarababyCsv } from '../import/narababy';
import { type AuthEnv } from '../auth';

const importRoutes = new Hono<AuthEnv>();

function isoNow(): string {
	return new Date().toISOString();
}

function opt(value: number | string | null | undefined): number | string | null {
	return value === undefined ? null : value;
}

async function getHouseholdId(db: SqliteFacade, userId: string): Promise<number | null> {
	const res = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? LIMIT 1',
		args: [userId],
	});
	const row = res.rows[0];
	return row ? Number(row.household_id) : null;
}

async function resolveBaby(db: SqliteFacade, userId: string, name: string, gender: string, birthDate: string, targetBabyId?: number | null) {
	if (targetBabyId) {
		const res = await db.execute({
			sql: `SELECT b.id, b.household_id AS householdId
			      FROM babies b
			      JOIN user_households uh ON uh.household_id = b.household_id
			      WHERE b.id = ? AND uh.user_id = ? LIMIT 1`,
			args: [targetBabyId, userId],
		});
		const row = res.rows[0];
		if (row) return { householdId: Number(row.householdId), babyId: Number(row.id) };
		return { householdId: null, babyId: null };
	}

	const householdId = await getHouseholdId(db, userId);
	if (!householdId) return { householdId, babyId: null };

	const existing = await db.execute({
		sql: 'SELECT id FROM babies WHERE household_id = ? AND name = ? LIMIT 1',
		args: [householdId, name],
	});
	if (existing.rows.length > 0) {
		const id = existing.rows[0]?.id;
		return { householdId, babyId: id ? Number(id) : null };
	}

	const ins = await db.execute({
		sql: `INSERT INTO babies (household_id, name, birth_date, gender, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?)`,
		args: [householdId, name, birthDate || null, gender || null, isoNow(), isoNow()],
	});
	return { householdId, babyId: Number(ins.lastInsertRowid) };
}

// The import writes thousands of rows. In file mode the shared client is the
// single SQLite connection; run writes through it, counting per-row failures
// instead of letting one bad row abort the import.

importRoutes.post('/narababy', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');

	const form = await c.req.formData();
	const file = form.get('file');
	if (!file) return c.json({ error: 'Missing CSV file' }, 400);
	if (typeof file === 'string') return c.json({ error: 'Expected multipart file upload' }, 400);
	const targetBabyId = form.get('babyId') ? Number(form.get('babyId')) : null;
	const importType = String(form.get('importType') ?? 'narababy');
	const filename = typeof file === 'object' && 'name' in file ? String((file as any).name) : 'import.csv';

	let csvText: string;
	try {
		const buf = await file.arrayBuffer();
		csvText = new TextDecoder().decode(buf);
	} catch {
		return c.json({ error: 'Failed to read uploaded file' }, 400);
	}

	const parsed = parseNarababyCsv(csvText);
	if (parsed.errors.length > 0 && !parsed.baby) {
		return c.json({ error: parsed.errors.join('; '), notes: parsed.notes }, 422);
	}

	const { babyId, householdId } = await resolveBaby(
		db,
		userId,
		parsed.baby?.name ?? 'Baby',
		parsed.baby?.gender ?? 'female',
		parsed.baby?.birthDate ?? '',
		targetBabyId,
	);
	if (!babyId) {
		return c.json({ error: targetBabyId ? 'Target family member not found or not accessible' : 'No household found for this user — register completes onboarding first' }, 409);
	}

	// Resolve which activity keys already exist, in one query on the shared client.
	const all = [];
	all.push(...parsed.feedings.map((f) => f.activityKey));
	all.push(...parsed.diapers.map((d) => d.activityKey));
	all.push(...parsed.sleeps.map((s) => s.activityKey));
	all.push(...parsed.growths.map((g) => g.activityKey));
	all.push(...parsed.milestones.map((m) => m.activityKey));

	const existingKeys = new Set<string>();
	if (all.length > 0) {
		const placeholders = all.map(() => '?').join(',');
		const res = await db.execute({
			sql: `SELECT activity_key FROM import_log WHERE baby_id = ? AND activity_key IN (${placeholders})`,
			args: [babyId, ...all],
		});
		for (const r of res.rows) {
			if (r !== undefined) existingKeys.add(String(r.activity_key ?? ''));
		}
	}

	const keep = <T>(rows: T[], key: (t: T) => string) => rows.filter((r) => !existingKeys.has(key(r)));
	const feedings = keep(parsed.feedings, (f) => f.activityKey);
	const diapers = keep(parsed.diapers, (d) => d.activityKey);
	const sleeps = keep(parsed.sleeps, (s) => s.activityKey);
	const growths = keep(parsed.growths, (g) => g.activityKey);
	const milestones = keep(parsed.milestones, (m) => m.activityKey);
	const skippedDuplicate = all.length - (feedings.length + diapers.length + sleeps.length + growths.length + milestones.length);

	// All writes happen sequentially on the dedicated bulk client. Individual
	// per-row failures are counted, never allowed to kill or hang the import.
const now = isoNow();
	const created = { feedings: 0, diapers: 0, sleep: 0, growth: 0, milestones: 0 };
	const rowErrors: string[] = [];

	const insertedIds: Record<keyof typeof created, Array<{ id: number; activityKey: string }>> = {
		feedings: [], diapers: [], sleep: [], growth: [], milestones: [],
	};

	const insert = async (sql: string, args: Array<number | string | null>, kind: keyof typeof created, activityKey: string) => {
		try {
			const res = await db.execute({ sql, args });
			created[kind]++;
			insertedIds[kind].push({ id: Number(res.lastInsertRowid), activityKey });
		} catch (e) {
			rowErrors.push(`${kind} ${activityKey}: ${String(e).slice(0, 120)}`);
		}
	};

	for (const f of feedings) {
		const end = f.durationSeconds ? new Date(new Date(f.startTime).getTime() + f.durationSeconds * 1000).toISOString() : null;
		await insert(
			`INSERT INTO feedings (baby_id, start_time, end_time, duration, amount, type, side, notes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[babyId, f.startTime, end, opt(f.durationSeconds), opt(f.amount), f.type, opt(f.side), opt(f.notes), now],
			'feedings', f.activityKey,
		);
	}
	for (const d of diapers) {
		await insert(
			`INSERT INTO diapers (baby_id, change_time, type, color, consistency, notes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[babyId, d.changeTime, d.type, opt(d.color), opt(d.consistency), opt(d.notes), now],
			'diapers', d.activityKey,
		);
	}
	for (const s of sleeps) {
		const end = s.durationSeconds ? new Date(new Date(s.startTime).getTime() + s.durationSeconds * 1000).toISOString() : null;
		await insert(
			`INSERT INTO sleep (baby_id, start_time, end_time, duration, location, notes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[babyId, s.startTime, end, opt(s.durationSeconds), null, opt(s.notes), now],
			'sleep', s.activityKey,
		);
	}
	for (const g of growths) {
		await insert(
			`INSERT INTO growth (baby_id, measurement_date, weight, height, head_circumference, unit_system, notes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[babyId, g.measurementDate, opt(g.weight), opt(g.height), opt(g.headCircumference), g.unitSystem, opt(g.notes), now],
			'growth', g.activityKey,
		);
	}
	for (const m of milestones) {
		await insert(
			`INSERT INTO milestones (baby_id, title, description, achieved_date, category, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[babyId, m.title, null, m.achievedDate, m.category, now],
			'milestones', m.activityKey,
		);
	}

	const totalInserted = feedings.length + diapers.length + sleeps.length + growths.length + milestones.length;
	let runId: number | null = null;
	if (totalInserted > 0) {
		const runRes = await db.execute({
			sql: `INSERT INTO import_runs (family_id, baby_id, importer_user_id, import_type, filename, created_at, counts)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [householdId, babyId, userId, importType, filename, now, JSON.stringify({
				feedings: feedings.length, diapers: diapers.length, sleep: sleeps.length, growth: growths.length, milestones: milestones.length,
			})],
		});
		runId = Number(runRes.lastInsertRowid);
	}

	const tableForKind: Record<keyof typeof created, string> = {
		feedings: 'feeding', diapers: 'diaper', sleep: 'sleep', growth: 'growth', milestones: 'milestone',
	};

	for (const kind of Object.keys(insertedIds) as Array<keyof typeof created>) {
		for (const item of insertedIds[kind]) {
			try {
				await db.execute({
					sql: 'INSERT INTO import_log (activity_key, kind, baby_id, run_id, record_id, record_table, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
					args: [item.activityKey, tableForKind[kind], babyId, runId, item.id, kind, now],
				});
			} catch {
				// idempotency race — already recorded
			}
		}
	}

	return c.json({
		message: 'Import complete',
		runId,
		babyId,
		householdId,
		created,
		skippedDuplicate,
		parserNotes: parsed.notes,
		errors: parsed.errors.concat(rowErrors),
	});
});

importRoutes.get('/summary', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const householdId = await getHouseholdId(db, userId);
	if (!householdId) return c.json({ imported: 0, perKind: {} });

	const res = await db.execute({
		sql: `SELECT kind, COUNT(*) AS n FROM import_log
		      JOIN babies ON babies.id = import_log.baby_id
		      WHERE babies.household_id = ?
		      GROUP BY kind`,
		args: [householdId],
	});
	const perKind: Record<string, number> = {};
	for (const r of res.rows) {
		if (r !== undefined) perKind[String(r.kind)] = Number(r.n);
	}
	return c.json({ imported: res.rows.length, perKind });
});

async function familyScopeOfBaby(db: SqliteFacade, userId: string, babyId: number | null) {
	if (babyId) {
		const res = await db.execute({
			sql: `SELECT b.household_id AS family_id FROM babies b
			      JOIN user_households uh ON uh.household_id = b.household_id
			      WHERE b.id = ? AND uh.user_id = ? LIMIT 1`,
			args: [babyId, userId],
		});
		const row = res.rows[0];
		if (row) return Number(row.family_id);
		return null;
	}
	const householdId = await getHouseholdId(db, userId);
	return householdId;
}

importRoutes.get('/runs', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const babyId = c.req.query('babyId') ? Number(c.req.query('babyId')) : null;

	const familyId = await familyScopeOfBaby(db, userId, babyId);
	if (!familyId) return c.json({ error: 'Not a member of this family' }, 403);

	const res = await db.execute({
		sql: `SELECT id, family_id, baby_id, importer_user_id, import_type, filename, created_at, counts
		      FROM import_runs
		      WHERE family_id = ? ${babyId ? 'AND baby_id = ?' : ''}
		      ORDER BY created_at DESC`,
		args: babyId ? [familyId, babyId] : [familyId],
	});
	const runs = res.rows.map((r: any) => ({
		id: Number(r.id),
		babyId: r.baby_id ? Number(r.baby_id) : null,
		importerUserId: r.importer_user_id ? String(r.importer_user_id) : null,
		importType: r.import_type,
		filename: r.filename,
		createdAt: r.created_at,
		counts: r.counts ? JSON.parse(r.counts) : {},
	}));
	return c.json({ runs });
});

importRoutes.post('/runs/:runId{[0-9]+}/undo', async (c) => {
	const userId = c.get('userId');
	const db = c.get('db');
	const runId = parseInt(c.req.param('runId'));

	const runRes = await db.execute({
		sql: `SELECT id, family_id, baby_id FROM import_runs WHERE id = ? LIMIT 1`,
		args: [runId],
	});
	const run = runRes.rows[0] as any;
	if (!run) return c.json({ error: 'Import run not found' }, 404);

	const familyAccess = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ? AND household_id = ? LIMIT 1',
		args: [userId, Number(run.family_id)],
	});
	if (familyAccess.rows.length === 0) return c.json({ error: 'Not a member of this family' }, 403);

	const logRes = await db.execute({
		sql: `SELECT record_id, record_table FROM import_log WHERE run_id = ?`,
		args: [runId],
	});
	const deleted = { feedings: 0, diapers: 0, sleep: 0, growth: 0, milestones: 0 };
	const keyOf: Record<string, keyof typeof deleted> = {
		feedings: 'feedings', diapers: 'diapers', sleep: 'sleep', growth: 'growth', milestones: 'milestones',
	};
	for (const r of logRes.rows as any[]) {
		const table = String(r.record_table);
		const id = Number(r.record_id);
		const key = keyOf[table];
		if (!table || !id || !key) continue;
		await db.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] });
		deleted[key]++;
	}

	if (run.baby_id) {
		const keysRes = await db.execute({
			sql: `SELECT activity_key FROM import_log WHERE run_id = ?`,
			args: [runId],
		});
		for (const r of keysRes.rows as any[]) {
			await db.execute({ sql: 'DELETE FROM import_log WHERE activity_key = ? AND baby_id = ?', args: [String(r.activity_key), Number(run.baby_id)] });
		}
	}
	await db.execute({ sql: "UPDATE import_runs SET counts = ? WHERE id = ?", args: [JSON.stringify({ ...deleted, undone: true }), runId] });

	return c.json({ message: 'Import run undone', runId, deleted });
});

export { importRoutes };