<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, milestoneAPI, vaccinationAPI, moodAPI, journalAPI } from '$lib/api/records';
	import { importsAPI } from '$lib/api/system';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { applyTimezone } from '$lib/stores/timezoneStore';
	import { notify, fail } from '$lib/stores/feedback';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { defaultMemberId } from '$lib/shared';
	import { computeFeedReports } from '$lib/logging/feedStats';
	import { Home } from 'lucide-svelte';

	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	let profiles: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedMemberId: number | null = null;
	let activeTab = 'feeds';
	let defaultProfileId: number | null = null;
	let summary: any = null;
	// Feeds, sleep, diapers and the rest only exist for a trackable profile.
	/**
	 * Whether the selected person can be logged against.
	 *
	 * Computed here rather than from a `$:` flag: reactive statements are
	 * scheduled, not synchronous, so selectMember() would call refreshLists()
	 * before the flag had recomputed and fetch the baby endpoints for whoever was
	 * selected previously.
	 */
	function currentIsTrackable(): boolean {
		const m = profiles.find((b) => Number(b.id) === selectedMemberId);
		return !!m && m.trackable !== false;
	}

	// Tracking categories now live in $lib/shared.ts (single source of truth).
	// Categories enabled for the selected member.
	let activeCategories: string[] = [];

	// Family-scoped tracking settings (categories + per-category option lists).
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>> } | null = null;

	// Family onboarding

	// Invite-by-email
	let invitations: any[] = [];

	// Import data (Narababy CSV)
	let importRuns: any[] = [];

	// Formula catalog
	// Manual feed entry (backdated) + repeat-last
	// Diaper detail form
	// Sleep + growth backdated
	// Milestone + vaccine manual forms
	// Account

	let feedStartedAt: number | null = null;
	let feedElapsed = 0;
	let leftStartedAt: number | null = null;
	let leftElapsed = 0;
	let rightStartedAt: number | null = null;
	let rightElapsed = 0;

	let sleepStartedAt: number | null = null;

	let feedings: any[] = [];
	let diapers: any[] = [];
	let sleeps: any[] = [];
	let growths: any[] = [];
	let milestones: any[] = [];
	let vaccinations: any[] = [];
	let moods: any[] = [];
	let journalEntries: any[] = [];

	// Quick feed reports over the loaded feedings (see $lib/logging/feedStats).
	$: feedReports = computeFeedReports(feedings);

	async function refreshSummary() {
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
			// Baby tracking only. The person who created the household is an adult
			// member of it, so a household with no child yet would otherwise fire a
			// request that is refused.
			summary = null;
			return;
		}
		try {
			const res = await healthAPI.getSummary(selectedMemberId);
			summary = res.data.summary;
		} catch {
			summary = null;
		}
	}

	async function refreshLists() {
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
			// Feeds, sleep, diapers, growth, moods and the rest belong to a baby
			// profile, and the endpoints reject an adult one.
			feedings = [];
			diapers = [];
			sleeps = [];
			growths = [];
			milestones = [];
			vaccinations = [];
			moods = [];
			journalEntries = [];
			return;
		}
		try {
			const [f, d, s, g, m, v, mo, j] = await Promise.all([
				feedingAPI.getAll(selectedMemberId),
				diaperAPI.getAll(selectedMemberId),
				sleepAPI.getAll(selectedMemberId),
				growthAPI.getAll(selectedMemberId),
				milestoneAPI.getAll(selectedMemberId),
				vaccinationAPI.getAll(selectedMemberId),
				moodAPI.getAll(selectedMemberId),
				journalAPI.getAll(selectedMemberId),
			]);
			feedings = f.data.feedings;
			diapers = d.data.diapers;
			sleeps = s.data.sleep;
			growths = g.data.growth;
			milestones = m.data.milestones;
			vaccinations = v.data.vaccinations;
			moods = mo.data.moods ?? [];
			journalEntries = j.data.entries ?? [];
		} catch (e: any) {
			fail(e.response?.data?.error || 'Failed to load tracking data.');
			console.error(e);
		}
	}

	// Edit modal state

	async function loadFamilies() {
		try {
			const res = await familiesAPI.list();
			families = res.data.families;
			if (families.length === 0) {
				selectedMemberId = null;
				profiles = [];
				return;
			}
			// Prefer the saved default family, else the first.
			const savedFamily = localStorage.getItem('nido.familyId');
			activeFamily = families.find((f) => f.familyId === savedFamily) ?? families[0];
			activeFamilyId = activeFamily.familyId;

			if (!activeFamilyId) {
				profiles = [];
				selectedMemberId = null;
				return;
			}
			const membersRes = await familiesAPI.members(activeFamilyId);
			const members = membersRes.data.members;
			// Members are the profiles the tracker operates on (child/adult; "newborn"
			// is a child with newborn categories enabled).
			profiles = members.map((m: any) => ({
				id: m.id,
				name: m.name,
				birth_date: m.birthDate ?? '',
				gender: m.gender ?? '',
				type: m.type ?? 'child',
				email: m.email ?? null,
				avatar: m.avatar ?? null,
				categories: Array.isArray(m.categories) ? m.categories : [],
				trackable: m.trackable !== false,
				legacySubjectId: m.legacySubjectId ?? null,
			}));

			if (profiles.length > 0) {
				const savedDefault = defaultProfileId ?? null;
				const match = savedDefault ? profiles.find((b) => Number(b.id) === savedDefault) : null;
				selectedMemberId = match ? Number(match.id) : defaultMemberId(profiles);
				const selected = profiles.find((b) => Number(b.id) === selectedMemberId);
				// The API resolves this to the member's own set, constrained by their
				// stage. An empty list is a real answer, not a prompt to show everything.
				activeCategories = selected?.categories ?? [];
				if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
			} else {
				selectedMemberId = null;
				activeCategories = [];
			}
			await Promise.all([loadFamilySettings(), refreshLists(), refreshSummary(), loadInvitations(), loadImportRuns()]);
		} catch (e: any) {
			const status = e.response?.status;
			if (status === 401 || status === 403) {
				handleLogout();
				fail('Your session has expired. Please sign in again.');
				return;
			}
			fail(e.response?.data?.error || 'Failed to load your families.');
			console.error(e);
		}
	}

	function handleLogout() {
		authActions.logout();
		isAuthenticated = false;
		profiles = [];
		selectedMemberId = null;
		feedStartedAt = null;
		leftStartedAt = null;
		rightStartedAt = null;
		leftElapsed = 0;
		rightElapsed = 0;
		feedElapsed = 0;
		sleepStartedAt = null;
	}

	async function loadInvitations() {
		if (!activeFamilyId) {
			invitations = [];
			return;
		}
		try {
			const res = await familiesAPI.listInvites(activeFamilyId);
			invitations = res.data.invitations || [];
		} catch {
			invitations = [];
		}
	}

	async function loadImportRuns() {
		try {
			const res = await importsAPI.runs();
			importRuns = res.data.runs || [];
		} catch {
			importRuns = [];
		}
	}

	async function refreshUserProfile() {
		try {
			const res = await userAPI.getMe();
			const u = res.data.user;
			if (u) {
				authActions.setUser({
					id: Number(u.id),
					email: u.email,
					firstName: u.first_name ?? u.firstName ?? '',
					lastName: u.last_name ?? u.lastName ?? '',
					createdAt: u.created_at ?? u.createdAt ?? '',
				});
			}
		} catch {
			// getMe failing is not worth a toast; the header keeps the stored profile.
		}
	}

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			// The family's clock, from the settings already fetched here, so the
			// times on this page are right on first paint rather than a tick later.
			const tz = res.data.settings?.timezone;
			if (typeof tz === 'string' && tz) applyTimezone(tz);
			// Deliberately does NOT touch activeCategories. Those are the selected
			// member's own categories; the family-level list is a different thing
			// that used to overwrite them here.
		} catch (err: any) {
			console.error('Failed to load family settings:', err);
		}
	}

	// Live per-side elapsed (ms) = frozen total + live running time.

	// ----- Connection-resilience: persisted timers + offline outbox -----
	// Timer state is written to localStorage on every mutation so a reload or a
	// dropped connection mid-session does not lose accumulated time. The outbox

	

	onMount(async () => {
		if (browser) {
			const params = new URLSearchParams(window.location.search);
			const verifyParam = params.get('verify');
			const resetParam = params.get('reset');
			if (verifyParam) {
				try {
					const res = await authAPI.verifyEmail(verifyParam);
					notify(res.data.message || 'Email verified.');
				} catch (err: any) {
					fail(err.response?.data?.error || 'Verification failed.');
				}
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			if (resetParam) {
				notify('Enter a new password to complete your password reset.');
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			const token = localStorage.getItem('token');
			isAuthenticated = !!token && !tokenExpired();
			const savedDefault = localStorage.getItem('nido.defaultProfile');
			if (savedDefault) {
				defaultProfileId = Number(savedDefault);
			}
			if (isAuthenticated) {
				await Promise.all([loadFamilies(), refreshUserProfile()]);
			}
		}
	});

</script>
 			<FeedbackToasts />
 			<!-- HOME — future household/property tracking -->
			<div class="max-w-4xl mx-auto">
				<div class="flex items-center gap-3 mb-6">
					<span class="w-12 h-12 rounded-full border-2 border-accent text-accent flex items-center justify-center" aria-hidden="true"><Home class="w-6 h-6" /></span>
					<div>
						<h2 class="text-2xl font-display font-semibold">Home</h2>
						<p class="text-ink-soft text-sm">Tend to every place you call home.</p>
					</div>
				</div>

				{#if profiles.length > 0}
					<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 mb-6">
						<h3 class="text-xl font-display font-semibold mb-3">Homes</h3>
						<p class="text-ink-soft mb-4">
							Multi-home tracking is coming in a future module — manage property assets, seasonal maintenance,
							appliance manuals, and household routines for multiple homes.
						</p>
						<div class="border border-dashed border-line rounded-md p-4 md:p-6 text-center text-ink-soft">
							<p class="text-lg font-display flex items-center justify-center gap-2"><Home class="w-5 h-5" /> Your first home will appear here</p>
							<p class="text-sm mt-2">Home tracking arrives with the Home module.</p>
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
					<div class="bg-surface rounded-lg shadow p-4 md:p-6 text-center">
						<h3 class="text-lg font-display font-semibold mb-2">Property Assets</h3>
						<p class="text-ink-soft">Track physical property and appliance inventory.</p>
					</div>
					<div class="bg-surface rounded-lg shadow p-4 md:p-6 text-center">
						<h3 class="text-lg font-display font-semibold mb-2">Maintenance</h3>
						<p class="text-ink-soft">Seasonal upkeep schedules and service reminders.</p>
					</div>
					<div class="bg-surface rounded-lg shadow p-4 md:p-6 text-center">
						<h3 class="text-lg font-display font-semibold mb-2">Manuals &amp; Routines</h3>
						<p class="text-ink-soft">Store appliance manuals and household routines.</p>
					</div>
				</div>
			</div>
