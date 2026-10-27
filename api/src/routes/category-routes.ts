// category-routes.ts
//
// The ONE implementation of the five category handlers (list, get, create,
// update, delete). Every per-category route file in this directory is the
// same five handlers with different nouns — the variation is data, so it is
// declared in a CategorySheet and this factory stamps it out. Adding a
// category is a sheet, not a 300-line file.
//
// Shapes preserved exactly from the handwritten routes this replaces
// (diapers, moods, journal — the thin trio of the event-model review):
//
//   responseMode 'raw'   (diapers): rows pass through snake_case, create
//                          re-selects the row, member resolution fails 404,
//                          an empty update is a 200 message, GET /:id exists.
//   responseMode 'camel' (moods, journal): rows map through rowToResponse,
//                          create returns a synthesized 201, member
//                          resolution fails 403, an empty update is a 400,
//                          no GET /:id (the sheets don't ask for one).
//
// The consumption wiring lives HERE, once: create goes through the one
// funnel after the row is stored, warn-don't-fail — the invariant each
// handwritten route restated in its own words.
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import { type AuthEnv } from '../auth';
import { resolveTrackableMember, attachCreatedBy } from '../member-scope';
import { parsePaging, countMatching } from '../paging';
import { emitActivity } from '../inventory-consume';

/** Everything the factory needs to stamp out one category's routes. */
export interface CategorySheet {
	/** The table records land in today (registry: storage.table). */
	table: string;
	/** ORDER BY expression over the time column, e.g. 'change_time' or 'COALESCE(entry_date, created_at)'. */
	orderExpr: string;
	/** SELECT list for list/get/re-select. */
	selectColumns: string[];
	/** Which of the five handlers to mount — preserves each category's exact surface. */
	handlers: ReadonlyArray<'list' | 'get' | 'create' | 'update' | 'delete'>;
	createSchema: z.ZodObject<z.ZodRawShape>;
	updateSchema: z.ZodObject<z.ZodRawShape>;
	/** camelCase body key -> snake_case SET column, for the dynamic update ladder. */
	columns: Record<string, string>;
	insert: {
		columns: string[];
		values: (data: Record<string, unknown>, subjectId: number, now: string, userId: string) => unknown[];
	};
	responseMode: 'raw' | 'camel';
	/** camel mode: map a raw row to the response shape. */
	rowToResponse?: (row: Record<string, unknown>) => unknown;
	/** camel mode: the synthesized create response body (no re-select). */
	createResponse?: (id: number, subjectId: number, data: Record<string, unknown>, now: string) => unknown;
	/** List response key ('diapers', 'entries') and item key ('diaper', 'entry'). */
	listKey: string;
	itemKey: string;
	/** The category's nouns, for the messages. */
	nouns: { singular: string; article: string };
	messages: {
		memberRequired: string;
		memberDenied: string;
		notFound: string;
		accessDenied: string;
		listFailed: string;
		getFailed: string;
		createFailed: string;
		updateFailed: string;
		deleteFailed: string;
		created: string;
		updated: string;
		deleted: string;
		createdStatus: 200 | 201;
	};
	/** Consumption: category id + how the body's attrs are derived, or null to not bill. */
	emit: { category: string; attrs: (data: Record<string, unknown>) => Record<string, string | null> } | null;
}

const ID_PATTERN = '/:id{[0-9]+}';

/** The canonical row-to-user access predicate, shared by every raw-mode handler. */
async function rowAccessible(db: any, table: string, id: number, userId: string): Promise<boolean> {
	const res = await db.execute({
		sql: `
      SELECT 1
      FROM ${table} t
      JOIN subjects b ON t.subject_id = b.id
      JOIN households h ON b.household_id = h.id
      JOIN user_households uh ON h.id = uh.household_id
      WHERE t.id = ? AND uh.user_id = ?
      LIMIT 1`,
		args: [id, userId],
	});
	return res.rows.length > 0;
}

/** camel mode: fetch the row's subject, then check household membership (404/403 split). */
async function subjectOf(db: any, table: string, id: number): Promise<number | null> {
	const res = await db.execute({
		sql: `SELECT subject_id FROM ${table} WHERE id = ? LIMIT 1`,
		args: [id],
	});
	return res.rows.length ? Number((res.rows[0] as Record<string, unknown>).subject_id) : null;
}

async function memberHasSubject(db: any, subjectId: number, userId: string): Promise<boolean> {
	const res = await db.execute({
		sql: `SELECT 1 FROM subjects b JOIN user_households uh ON uh.household_id = b.household_id WHERE b.id = ? AND uh.user_id = ? LIMIT 1`,
		args: [subjectId, userId],
	});
	return res.rows.length > 0;
}

export function categoryRoutes(sheet: CategorySheet): Hono<AuthEnv> {
	const routes = new Hono<AuthEnv>();
	const camel = sheet.responseMode === 'camel';
	const selectSql = sheet.selectColumns.join(', ');

	// List
	if (sheet.handlers.includes('list')) {
		routes.get('/', async (c) => {
			try {
				const userId = c.get('userId');
				const db = c.get('db');
				const memberId = parseInt(c.req.query('memberId') || '0');
				if (!memberId) return c.json({ error: sheet.messages.memberRequired }, 400);

				const scope = await resolveTrackableMember(db, userId, memberId);
				if (!scope) {
					return c.json({ error: sheet.messages.memberDenied }, camel ? 403 : 404);
				}
				const subjectId = scope.subjectId;

				const { limit, offset } = parsePaging((k) => c.req.query(k));
				const res = await db.execute({
					sql: `SELECT ${selectSql} FROM ${sheet.table} WHERE subject_id = ? ORDER BY ${sheet.orderExpr} DESC, id DESC LIMIT ? OFFSET ?`,
					args: [subjectId, limit, offset],
				});
				const total = await countMatching(db, sheet.table, [subjectId]);
				const rows = res.rows as Record<string, unknown>[];
				await attachCreatedBy(db, rows);
				const items = camel ? rows.map((r) => sheet.rowToResponse!(r)) : rows;
				return c.json({ [sheet.listKey]: items, total });
			} catch (error) {
				c.get('log').error(`list ${sheet.listKey} failed`, { err: error });
				return c.json({ error: sheet.messages.listFailed }, 500);
			}
		});
	}

	// Get one (raw mode only — the camel trio never had it, and the sheet does not ask)
	if (sheet.handlers.includes('get') && !camel) {
		routes.get(ID_PATTERN, async (c) => {
			try {
				const id = parseInt(c.req.param('id'));
				const userId = c.get('userId');
				const db = c.get('db');
				const res = await db.execute({
					sql: `
          SELECT t.${selectSql.replace(/, /g, ', t.')}
          FROM ${sheet.table} t
          JOIN subjects b ON t.subject_id = b.id
          JOIN households h ON b.household_id = h.id
          JOIN user_households uh ON h.id = uh.household_id
          WHERE t.id = ? AND uh.user_id = ?`,
					args: [id, userId],
				});
				if (res.rows.length === 0) return c.json({ error: sheet.messages.notFound }, 404);
				return c.json({ [sheet.itemKey]: res.rows[0] });
			} catch (error) {
				c.get('log').error(`get ${sheet.nouns.article} ${sheet.nouns.singular} failed`, { err: error });
				return c.json({ error: sheet.messages.getFailed }, 500);
			}
		});
	}

	// Create
	if (sheet.handlers.includes('create')) {
		routes.post('/', zValidator('json', sheet.createSchema), async (c) => {
			try {
				const data = c.req.valid('json') as Record<string, unknown>;
				const userId = c.get('userId');
				const db = c.get('db');
				const scope = await resolveTrackableMember(db, userId, Number(data.memberId));
				if (!scope) return c.json({ error: sheet.messages.memberDenied }, camel ? 403 : 404);
				const subjectId = scope.subjectId;

				const now = new Date().toISOString();
				const cols = sheet.insert.columns;
				const vals = sheet.insert.values(data, subjectId, now, userId);
				const result = await db.execute({
					sql: `INSERT INTO ${sheet.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
					args: vals,
				});
				const id = Number(result.lastInsertRowid);

				// A logged record is also a unit consumed. Every category bills
				// through the one funnel; it is idempotent per rule and record id,
				// so a retry cannot count the same record twice. The record is
				// already stored — a consumption failure must not lose it.
				if (sheet.emit) {
					try {
						await emitActivity(db, {
							category: sheet.emit.category,
							refTable: sheet.table,
							refId: id,
							subjectId,
							attrs: sheet.emit.attrs(data),
							createdBy: userId,
						});
					} catch (err: unknown) {
						c.get('log').warn('inventory decrement failed', { err });
					}
				}

				if (camel) {
					return c.json(
						{ message: sheet.messages.created, [sheet.itemKey]: sheet.createResponse!(id, subjectId, data, now) },
						sheet.messages.createdStatus,
					);
				}
				const re = await db.execute({
					sql: `SELECT ${selectSql} FROM ${sheet.table} WHERE id = ?`,
					args: [id],
				});
				return c.json({ message: sheet.messages.created, [sheet.itemKey]: re.rows[0] }, sheet.messages.createdStatus);
			} catch (error) {
				c.get('log').error(`create ${sheet.nouns.article} ${sheet.nouns.singular} failed`, { err: error });
				return c.json({ error: sheet.messages.createFailed }, 500);
			}
		});
	}

	// Update
	if (sheet.handlers.includes('update')) {
		routes.put(ID_PATTERN, zValidator('json', sheet.updateSchema), async (c) => {
			try {
				const id = parseInt(c.req.param('id'));
				const data = c.req.valid('json') as Record<string, unknown>;
				const userId = c.get('userId');
				const db = c.get('db');

				if (camel) {
					const subjectId = await subjectOf(db, sheet.table, id);
					if (subjectId === null) return c.json({ error: sheet.messages.notFound }, 404);
					if (!(await memberHasSubject(db, subjectId, userId))) return c.json({ error: sheet.messages.accessDenied }, 403);
				} else if (!(await rowAccessible(db, sheet.table, id, userId))) {
					return c.json({ error: sheet.messages.notFound }, 404);
				}

				const updates: string[] = [];
				const params: unknown[] = [];
				for (const [key, col] of Object.entries(sheet.columns)) {
					if (data[key] !== undefined) {
						updates.push(`${col} = ?`);
						params.push(data[key]);
					}
				}
				if (updates.length === 0) {
					// raw mode answered a 200 message; camel mode a 400 error.
					return camel
						? c.json({ error: 'Nothing to update' }, 400)
						: c.json({ message: 'No updates provided' });
				}
				params.push(id);
				await db.execute({
					sql: `UPDATE ${sheet.table} SET ${updates.join(', ')} WHERE id = ?`,
					args: params,
				});

				if (camel) return c.json({ message: sheet.messages.updated });
				const re = await db.execute({
					sql: `SELECT ${selectSql} FROM ${sheet.table} WHERE id = ?`,
					args: [id],
				});
				return c.json({ message: sheet.messages.updated, [sheet.itemKey]: re.rows[0] });
			} catch (error) {
				c.get('log').error(`update ${sheet.nouns.article} ${sheet.nouns.singular} failed`, { err: error });
				return c.json({ error: sheet.messages.updateFailed }, 500);
			}
		});
	}

	// Delete
	if (sheet.handlers.includes('delete')) {
		routes.delete(ID_PATTERN, async (c) => {
			try {
				const id = parseInt(c.req.param('id'));
				const userId = c.get('userId');
				const db = c.get('db');
				if (camel) {
					const subjectId = await subjectOf(db, sheet.table, id);
					if (subjectId === null) return c.json({ error: sheet.messages.notFound }, 404);
					if (!(await memberHasSubject(db, subjectId, userId))) return c.json({ error: sheet.messages.accessDenied }, 403);
				} else if (!(await rowAccessible(db, sheet.table, id, userId))) {
					return c.json({ error: sheet.messages.notFound }, 404);
				}
				await db.execute({ sql: `DELETE FROM ${sheet.table} WHERE id = ?`, args: [id] });
				return c.json({ message: sheet.messages.deleted });
			} catch (error) {
				c.get('log').error(`delete ${sheet.nouns.article} ${sheet.nouns.singular} failed`, { err: error });
				return c.json({ error: sheet.messages.deleteFailed }, 500);
			}
		});
	}

	return routes;
}