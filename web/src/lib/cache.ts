// Local cache of a member's tracking lists so history stays visible when the
// session expires or the network is down. Names use the 'nido.' prefix — see
// note in lib/theme.ts: browser-persisted keys are never migrated.

export type ListsCache = {
	feedings: any[];
	diapers: any[];
	sleeps: any[];
	growths: any[];
	milestones: any[];
	vaccinations: any[];
	moods: any[];
	journalEntries: any[];
	savedAt: string;
};

function listsKey(memberId: number): string {
	return `nido.cache.lists.${memberId}`;
}

export function saveListsCache(
	memberId: number,
	data: Omit<ListsCache, 'savedAt'>
): void {
	try {
		localStorage.setItem(
			listsKey(memberId),
			JSON.stringify({ ...data, savedAt: new Date().toISOString() })
		);
	} catch {}
}

export function loadListsCache(memberId: number): ListsCache | null {
	try {
		const raw = localStorage.getItem(listsKey(memberId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		return {
			feedings: parsed.feedings ?? [],
			diapers: parsed.diapers ?? [],
			sleeps: parsed.sleeps ?? [],
			growths: parsed.growths ?? [],
			milestones: parsed.milestones ?? [],
			vaccinations: parsed.vaccinations ?? [],
			moods: parsed.moods ?? [],
			journalEntries: parsed.journalEntries ?? [],
			savedAt: parsed.savedAt ?? '',
		};
	} catch {
		return null;
	}
}

export function clearListsCache(memberId: number): void {
	try {
		localStorage.removeItem(listsKey(memberId));
	} catch {}
}
