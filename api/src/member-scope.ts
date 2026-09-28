import type { SqliteFacade } from './db-core';

export interface MemberScope {
	memberId: number;
	babyId: number;
}

// Tracking routes receive a `memberId` (a family_members row) but record tables
// are keyed by a babies row. The profile is the member's `legacy_baby_id` when
// set; older members were recorded against a babies row whose id equals the
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
			       COALESCE(fm.legacy_baby_id, aligned.id) AS baby_id
			FROM family_members fm
			JOIN households h ON fm.household_id = h.id
			JOIN user_households uh ON h.id = uh.household_id
			LEFT JOIN babies aligned ON aligned.id = fm.id AND aligned.household_id = fm.household_id
			WHERE fm.id = ?
			  AND uh.user_id = ?
			  AND COALESCE(fm.trackable, 1) = 1
			  AND COALESCE(fm.legacy_baby_id, aligned.id) IS NOT NULL
			LIMIT 1
		`,
		args: [memberId, userId],
	});
	const row = res.rows[0];
	if (!row) return null;
	return { memberId: Number(row.member_id), babyId: Number(row.baby_id) };
}
