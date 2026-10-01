import { feedingAPI } from '$lib/api';

/** Newest feedings (all types) for a member, straight from the server. */
export async function loadRecentFeedings(memberId: number, limit = 80): Promise<any[]> {
	try {
		const res = await feedingAPI.getPage(memberId, { limit });
		return res.data.feedings ?? [];
	} catch {
		return [];
	}
}

export function apiError(err: any, fallback: string): string {
	return err?.response?.data?.error || fallback;
}
