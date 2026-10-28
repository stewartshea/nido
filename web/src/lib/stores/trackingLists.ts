// src/lib/stores/trackingLists.ts — the selected member's nine history lists
// (feeds, diapers, sleep, growth, milestones, vaccinations, moods, journal,
// vitals), their server-side totals, and the cache-first paginated loaders.
//
// Extracted verbatim from the family and dashboard pages, whose copies
// differed only by a comment and a loop-variable name (see the report). The
// selected member comes from the family store — read with get() inside the
// actions so selectMember() → refreshLists() still sees the member that was
// just selected synchronously.
import { writable, get } from 'svelte/store';
import { loadListsCache, saveListsCache } from '$lib/cache';
import { notify, fail } from '$lib/stores/feedback';
import { familyStore, familyActions } from '$lib/stores/family';
import { feedingAPI, diaperAPI, sleepAPI, growthAPI, milestoneAPI, vaccinationAPI, moodAPI, journalAPI, vitalsAPI } from '$lib/api/records';
import type { PageOptions } from '$lib/api/types';

type ListKey = 'feedings' | 'diapers' | 'sleeps' | 'growths' | 'milestones' | 'vaccinations' | 'moods' | 'journalEntries' | 'vitals';

interface TrackingListsState {
	feedings: any[];
	diapers: any[];
	sleeps: any[];
	growths: any[];
	milestones: any[];
	vaccinations: any[];
	moods: any[];
	journalEntries: any[];
	vitals: any[];
	// Server-side row count per list, used to offer "Load older records" only
	// when the server actually holds more than what is loaded.
	listTotals: Record<string, number>;
	loadingMore: boolean;
}

const EMPTY_LISTS: Record<ListKey, any[]> = {
	feedings: [],
	diapers: [],
	sleeps: [],
	growths: [],
	milestones: [],
	vaccinations: [],
	moods: [],
	journalEntries: [],
	vitals: [],
};

export const trackingListsStore = writable<TrackingListsState>({
	...EMPTY_LISTS,
	listTotals: {},
	loadingMore: false,
});

const HISTORY_PAGE_SIZE = 200;

const LIST_SOURCES = [
	{ key: 'feedings', field: 'feedings', page: (id: number, o: PageOptions) => feedingAPI.getPage(id, o) },
	{ key: 'diapers', field: 'diapers', page: (id: number, o: PageOptions) => diaperAPI.getPage(id, o) },
	{ key: 'sleeps', field: 'sleep', page: (id: number, o: PageOptions) => sleepAPI.getPage(id, o) },
	{ key: 'growths', field: 'growth', page: (id: number, o: PageOptions) => growthAPI.getPage(id, o) },
	{ key: 'milestones', field: 'milestones', page: (id: number, o: PageOptions) => milestoneAPI.getPage(id, o) },
	{ key: 'vaccinations', field: 'vaccinations', page: (id: number, o: PageOptions) => vaccinationAPI.getPage(id, o) },
	{ key: 'moods', field: 'moods', page: (id: number, o: PageOptions) => moodAPI.getPage(id, o) },
	{ key: 'journalEntries', field: 'entries', page: (id: number, o: PageOptions) => journalAPI.getPage(id, o) },
	{ key: 'vitals', field: 'vitals', page: (id: number, o: PageOptions) => vitalsAPI.getPage(id, o) },
] as const;

function currentLists(state: TrackingListsState): Record<ListKey, any[]> {
	return {
		feedings: state.feedings,
		diapers: state.diapers,
		sleeps: state.sleeps,
		growths: state.growths,
		milestones: state.milestones,
		vaccinations: state.vaccinations,
		moods: state.moods,
		journalEntries: state.journalEntries,
		vitals: state.vitals,
	};
}

function setList(key: ListKey, value: any[]): void {
	trackingListsStore.update((state) => ({ ...state, [key]: value }));
}

async function refreshLists(): Promise<void> {
	const memberId = get(familyStore).selectedMemberId;
	if (!memberId) return;
	if (!familyActions.currentIsTrackable()) {
		// Baby tracking only. The person who created the household is an adult
		// member of it, so a household with no child yet would otherwise fire
		// requests that are refused.
		trackingListsStore.update((s) => ({ ...s, ...EMPTY_LISTS }));
		return;
	}

	// Paint instantly from the local cache so history survives reloads,
	// expired sessions, and offline use; the network response replaces it.
	const cached = loadListsCache(memberId);
	if (cached) {
		trackingListsStore.update((s) => ({
			...s,
			feedings: cached.feedings,
			diapers: cached.diapers,
			sleeps: cached.sleeps,
			growths: cached.growths,
			milestones: cached.milestones,
			vaccinations: cached.vaccinations,
			moods: cached.moods,
			journalEntries: cached.journalEntries,
			vitals: cached.vitals,
		}));
	}
	try {
		const [f, d, s, g, m, v, mo, j, vi] = await Promise.all([
			feedingAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			diaperAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			sleepAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			growthAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			milestoneAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			vaccinationAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			moodAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			journalAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
			vitalsAPI.getPage(memberId, { limit: HISTORY_PAGE_SIZE }),
		]);
		const next = {
			feedings: f.data.feedings,
			diapers: d.data.diapers,
			sleeps: s.data.sleep,
			growths: g.data.growth,
			milestones: m.data.milestones,
			vaccinations: v.data.vaccinations,
			moods: mo.data.moods ?? [],
			journalEntries: j.data.entries ?? [],
			vitals: vi.data.vitals ?? [],
		};
		trackingListsStore.update((state) => ({
			...state,
			...next,
			listTotals: {
				feedings: f.data.total ?? next.feedings.length,
				diapers: d.data.total ?? next.diapers.length,
				sleeps: s.data.total ?? next.sleeps.length,
				growths: g.data.total ?? next.growths.length,
				milestones: m.data.total ?? next.milestones.length,
				vaccinations: v.data.total ?? next.vaccinations.length,
				moods: mo.data.total ?? next.moods.length,
				journalEntries: j.data.total ?? next.journalEntries.length,
				vitals: vi.data.total ?? next.vitals.length,
			},
		}));
		saveListsCache(memberId, next);
	} catch (e: any) {
		if (!cached) {
			fail(e.response?.data?.error || 'Failed to load tracking data.');
		} else {
			notify('Showing cached activities — will refresh when connected.');
		}
		console.error(e);
	}
}

async function loadMoreLists(): Promise<void> {
	const memberId = get(familyStore).selectedMemberId;
	const state = get(trackingListsStore);
	if (!memberId || state.loadingMore) return;
	const loaded = currentLists(state);
	const pending = LIST_SOURCES.filter((src) => loaded[src.key].length < (state.listTotals[src.key] ?? 0));
	if (pending.length === 0) return;

	trackingListsStore.update((s) => ({ ...s, loadingMore: true }));
	try {
		await Promise.all(pending.map(async (src) => {
			const res = await src.page(memberId, { limit: HISTORY_PAGE_SIZE, offset: loaded[src.key].length });
			const items = res.data?.[src.field] ?? [];
			if (items.length === 0) return;
			setList(src.key, [...loaded[src.key], ...items]);
			if (typeof res.data?.total === 'number') trackingListsStore.update((s) => ({ ...s, listTotals: { ...s.listTotals, [src.key]: res.data.total } }));
		}));
		const next = currentLists(get(trackingListsStore));
		saveListsCache(memberId, {
			feedings: next.feedings, diapers: next.diapers, sleeps: next.sleeps, growths: next.growths,
			milestones: next.milestones, vaccinations: next.vaccinations, moods: next.moods,
			journalEntries: next.journalEntries, vitals: next.vitals,
		});
	} catch (e: any) {
		notify(e.response?.data?.error || 'Could not load older records.');
	} finally {
		trackingListsStore.update((s) => ({ ...s, loadingMore: false }));
	}
}

export const trackingListsActions = {
	refreshLists,
	loadMoreLists,
};
