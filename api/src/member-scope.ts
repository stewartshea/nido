import type { SqliteFacade } from './db-core';

export interface MemberScope {
	memberId: number;
	subjectId: number;
}

// Tracking routes receive a `memberId` (a family_members row) but record tables
// are keyed by a subjects row. The profile is the member's `legacy_subject_id` when
// set; older members were recorded against a subjects row whose id equals the
// member id, so that aligned profile is the fallback. Returns null when the
// member is not in the caller's family, is flagged non-trackable, or has no
// profile at all.
export async function resolveTrackableMember(
	db: SqliteFacade,
	userId: string,
	memberId: number,
): Promise<MemberScope | null> {
	if (!memberId) return null;
	const res = await db.execute({
		sql: `
			SELECT fm.id AS member_id,
			       COALESCE(fm.legacy_subject_id, aligned.id) AS subject_id
			FROM family_members fm
			JOIN households h ON fm.household_id = h.id
			JOIN user_households uh ON h.id = uh.household_id
			LEFT JOIN subjects aligned ON aligned.id = fm.id AND aligned.household_id = fm.household_id
			WHERE fm.id = ?
			  AND uh.user_id = ?
			  AND COALESCE(fm.trackable, 1) = 1
			  AND COALESCE(fm.legacy_subject_id, aligned.id) IS NOT NULL
			LIMIT 1
		`,
		args: [memberId, userId],
	});
	const row = res.rows[0];
	if (!row) return null;
	return { memberId: Number(row.member_id), subjectId: Number(row.subject_id) };
}

// Records store the UUID of the user who logged them (`created_by`); the
// family DB's users table holds the display name. One lookup per response
// decorates every row with `created_by_name`.
export async function attachCreatedBy(
	db: SqliteFacade,
	rows: any[],
): Promise<void> {
	const ids = [...new Set(
		rows.map((r) => (r?.created_by ? String(r.created_by) : null)).filter((v): v is string => !!v),
	)];
	if (ids.length === 0) return;
	const res = await db.execute({
		sql: `SELECT id, first_name, last_name FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`,
		args: ids,
	});
	const names = new Map<string, string>();
	for (const u of res.rows) {
		const name = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
		names.set(String(u?.id), name || 'Unknown');
	}
	for (const r of rows) {
		if (r && r.created_by) r.created_by_name = names.get(String(r.created_by)) ?? 'Unknown';
	}
}
