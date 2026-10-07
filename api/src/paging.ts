export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

export interface Paging {
  limit: number;
  offset: number;
}

/**
 * Reads `?limit=` and `?offset=`, clamped to `MAX_PAGE_SIZE`.
 *
 * List routes pair this with `ORDER BY <time> DESC`. That ordering is load
 * bearing: an unordered `LIMIT` returns rows in rowid order, so once a member
 * has more records than one page the newest ones fall outside it and a
 * just-saved record appears to vanish.
 */
export function parsePaging(query: (key: string) => string | undefined): Paging {
  const rawLimit = Number.parseInt(query('limit') ?? '', 10);
  const rawOffset = Number.parseInt(query('offset') ?? '', 10);

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  return { limit, offset };
}

/** Total rows matching a filter, for honest "showing X of Y" counts. */
export async function countMatching(
  db: { execute: (q: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }> },
  table: string,
  args: unknown[],
): Promise<number> {
  const res = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE subject_id = ?`, args });
  const row = res.rows[0] as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}
