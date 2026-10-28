// src/lib/stores/family.ts — the session context shared by all four god pages
// (family/dashboard/home/settings). Each page used to carry a near-identical
// copy of this loading/selection core; family/+page.svelte was the source of
// truth. The store owns the family list, the active family, its members and
// the selection. Pages keep their post-load extras (their refresh lists and
// tab-specific queries) and chain them after loadFamilies() resolves.
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { familiesAPI } from '$lib/api/family';
import { healthAPI } from '$lib/api/records';
import { authActions } from '$lib/stores/authStore';
import { notify, fail } from '$lib/stores/feedback';
import { defaultMemberId } from '$lib/shared';

interface FamilyState {
	families: any[];
	activeFamily: any;
	activeFamilyId: string | null;
	profiles: any[];
	selectedMemberId: number | null;
	defaultProfileId: number | null;
	summary: any;
	// The selected member's own tracking categories (member list, or empty).
	// Belongs with the selection, not with the family-level settings load —
	// the two were once conflated and a family setting could clobber them.
	activeCategories: string[];
}

const initialFamilyState: FamilyState = {
	families: [],
	activeFamily: null,
	activeFamilyId: null,
	profiles: [],
	selectedMemberId: null,
	defaultProfileId: null,
	summary: null,
	activeCategories: [],
};

// The saved default profile, read once here instead of in every page's
// onMount — all four pages did the identical read (authStore idiom).
if (browser) {
	const savedDefault = localStorage.getItem('nido.defaultProfile');
	if (savedDefault) {
		initialFamilyState.defaultProfileId = Number(savedDefault);
	}
}

export const familyStore = writable<FamilyState>(initialFamilyState);

/**
 * Whether the selected person can be logged against.
 *
 * Computed here rather than from a `$:` flag: reactive statements are
 * scheduled, not synchronous, so selectMember() would call refreshLists()
 * before the flag had recomputed and fetch the baby endpoints for whoever was
 * selected previously. Must stay a synchronous function reading the store's
 * current value — selectMember() and the tracking-lists store rely on it
 * answering for the member that was just selected.
 */
function currentIsTrackable(): boolean {
	const state = get(familyStore);
	const m = state.profiles.find((b) => Number(b.id) === state.selectedMemberId);
	return !!m && m.trackable !== false;
}

/**
 * The god-loader: the shared family/member core.
 *
 * Resolves the saved (or first) family, loads its members as profiles, and
 * picks the member to open on. Returns whether the load got far enough that
 * the caller should run its page-specific extras — every page's old copy ran
 * its Promise.all of refreshes only on the paths that fell through to the
 * end of the try block, and skipped them on every early return and error.
 *
 * `preferred` is dashboard's starred-member hook: it is invoked right after
 * the active family is resolved (so a per-family localStorage key can be
 * read) and its answer wins over the saved default. The other pages don't
 * pass one.
 */
async function loadFamilies(preferred?: (familyId: string | null) => number | null): Promise<boolean> {
	try {
		const res = await familiesAPI.list();
		const families: any[] = res.data.families;
		if (families.length === 0) {
			familyStore.update((s) => ({ ...s, families, selectedMemberId: null, profiles: [] }));
			return false;
		}
		// Prefer the saved default family, else the first.
		const savedFamily = localStorage.getItem('nido.familyId');
		const activeFamily = families.find((f) => f.familyId === savedFamily) ?? families[0];
		const activeFamilyId = activeFamily?.familyId ?? null;
		familyStore.update((s) => ({ ...s, families, activeFamily, activeFamilyId }));
		// Dashboard reads its starred member here — keyed by the family that
		// was just resolved, so it has to happen before the members land.
		const preferredId = preferred ? preferred(activeFamilyId) : null;
		if (!activeFamilyId) {
			familyStore.update((s) => ({ ...s, profiles: [], selectedMemberId: null }));
			return false;
		}

		const membersRes = await familiesAPI.members(activeFamilyId);
		const members = membersRes.data.members;
		// Members are the profiles the tracker operates on (child/adult; "newborn"
		// is a child with newborn categories enabled).
		const profiles: any[] = members.map((m: any) => ({
			id: m.id,
			name: m.name,
			birth_date: m.birthDate ?? '',
			gender: m.gender ?? '',
			type: m.type ?? 'child',
			email: m.email ?? null,
			avatar: m.avatar ?? null,
			categories: Array.isArray(m.categories) ? m.categories : [],
			trackable: m.trackable !== false,
			stage: m.stage ?? null,
			quickLinks: Array.isArray(m.quickLinks) ? m.quickLinks : null,
			dashboardTiles: Array.isArray(m.dashboardTiles) ? m.dashboardTiles : null,
			legacySubjectId: m.legacySubjectId ?? null,
			// The settings Members tab badge reads this, and it was never carried
			// across from the API, so every profile claimed to have no account.
			linkedAccount: m.linkedAccount === true,
		}));

		if (profiles.length > 0) {
			// Starred first (dashboard): it is the person this household records
			// against most, so the page should open there rather than on whoever
			// happens to sort first.
			const starred = preferredId ? profiles.find((b) => Number(b.id) === preferredId) : null;
			const savedDefault = get(familyStore).defaultProfileId ?? null;
			const match = savedDefault ? profiles.find((b) => Number(b.id) === savedDefault) : null;
			const selectedMemberId = starred ? Number(starred.id) : match ? Number(match.id) : defaultMemberId(profiles);
			const selected = profiles.find((b) => Number(b.id) === selectedMemberId);
			// The API resolves this to the member's own set, constrained by their
			// stage. An empty list is a real answer, not a prompt to show everything.
			const activeCategories = selected?.categories ?? [];
			familyStore.update((s) => ({ ...s, profiles, selectedMemberId, activeCategories }));
		} else {
			familyStore.update((s) => ({ ...s, profiles, selectedMemberId: null, activeCategories: [] }));
		}
		return true;
	} catch (e: any) {
		const status = e.response?.status;
		if (status === 401 || status === 403) {
			handleLogout();
			fail('Your session has expired. Please sign in again.');
			return false;
		}
		fail(e.response?.data?.error || 'Failed to load your families.');
		console.error(e);
		return false;
	}
}

/**
 * Switch families. Persists the choice; the page chains its own reload
 * (loadFamilies + its extras) after this, exactly like the old page function.
 */
function setActiveFamily(familyId: string): void {
	familyStore.update((s) => ({ ...s, activeFamilyId: familyId }));
	if (browser) localStorage.setItem('nido.familyId', familyId);
}

function setDefaultProfile(memberId: number): void {
	familyStore.update((s) => ({ ...s, defaultProfileId: memberId, selectedMemberId: memberId }));
	if (browser) localStorage.setItem('nido.defaultProfile', String(memberId));
	notify('Default profile updated.');
}

/**
 * Select a member. Synchronous on purpose, and deliberately NOT followed by
 * the refreshes here: the selection must be a plain store write that callers
 * can read back immediately (see currentIsTrackable). Pages own the refresh
 * order after this — refreshLists() then refreshSummary(), nothing between.
 */
function selectMember(memberId: number): void {
	familyStore.update((s) => {
		const selected = s.profiles.find((b) => Number(b.id) === memberId);
		// The API resolves this to the member's own set, constrained by their
		// stage. An empty list is a real answer, not a prompt to show everything.
		return { ...s, selectedMemberId: memberId, activeCategories: selected?.categories ?? [] };
	});
}

async function refreshSummary(): Promise<void> {
	const memberId = get(familyStore).selectedMemberId;
	if (!memberId) return;
	if (!currentIsTrackable()) {
		familyStore.update((s) => ({ ...s, summary: null }));
		return;
	}

	try {
		const res = await healthAPI.getSummary(memberId);
		familyStore.update((s) => ({ ...s, summary: res.data.summary }));
	} catch {
		familyStore.update((s) => ({ ...s, summary: null }));
	}
}

/**
 * Reassign, don't mutate: selectedMember is derived from profiles on every
 * page, and mutating the object in place never re-runs the reactive
 * statement, so the panel kept showing the old layout until a hard reload.
 * The shared idiom behind the quick-links and dashboard-tiles savers.
 */
function patchProfile(memberId: number, patch: Record<string, any>): void {
	familyStore.update((s) => ({
		...s,
		profiles: s.profiles.map((p) => (Number(p.id) === Number(memberId) ? { ...p, ...patch } : p)),
	}));
}

/** The pages' handleLogout: drop the session, keep the family list alone. */
function handleLogout(): void {
	authActions.logout();
	familyStore.update((s) => ({ ...s, profiles: [], selectedMemberId: null }));
}

/**
 * Back to a blank session. The pre-store pages started every mount empty;
 * this store outlives page navigations, so a page mounting while signed out
 * resets it rather than rendering the previous session's families.
 */
function reset(): void {
	familyStore.update((s) => ({ ...initialFamilyState, defaultProfileId: s.defaultProfileId }));
}

export const familyActions = {
	loadFamilies,
	setActiveFamily,
	setDefaultProfile,
	selectMember,
	refreshSummary,
	currentIsTrackable,
	patchProfile,
	handleLogout,
	reset,
};
