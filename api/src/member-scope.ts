import type { SqliteFacade } from './db-core';

export interface MemberScope {
	memberId: number;
	babyId: number;
}

// Tracking routes receive a `memberId` (a family_members row) but every record
// table is keyed by a babies row. This resolves the caller's member to that
// profile, enforcing family access and the member's trackable flag. Returns
// null when the member is not in the caller's family or is not trackable.
export async function resolveTrackableMember(
	db: SqliteFacade,
	userId: string,
	memberId: number,
): Promise<MemberScope | null> {
	if (!memberId) return null;
	const res = await db.execute({
		sql: `
			SELECT fm.id AS member_id, fm.legacy_baby_id AS baby_id
			FROM family_members fm
			JOIN households h ON fm.household_id = h.id
			JOIN user_households uh ON h.id = uh.household_id
			WHERE fm.id = ?
			  AND uh.user_id = ?
			  AND fm.trackable = 1
			  AND fm.legacy_baby_id IS NOT NULL
			LIMIT 1
		`,
		args: [memberId, userId],
	});
	const row = res.rows[0];
	if (!row) return null;
	return { memberId: Number(row.member_id), babyId: Number(row.baby_id) };
}
