<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { importsAPI } from '$lib/api/system';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { familyStore, familyActions } from '$lib/stores/family';
	import { trackingListsStore, trackingListsActions } from '$lib/stores/trackingLists';
	import { loadFamilySettings } from '$lib/stores/familySettings';
	import Avatar from '$lib/components/Avatar.svelte';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { startOutboxSync } from '$lib/logging/outbox';
	import { computeFeedReports } from '$lib/logging/feedStats';
	import MemberActivity from '$lib/components/logging/MemberActivity.svelte';
	import MemberSwitcher from '$lib/components/logging/MemberSwitcher.svelte';
	import StockGlance from '$lib/components/logging/StockGlance.svelte';
	import LogDrawer from '$lib/components/logging/LogDrawer.svelte';
	import Trends from '$lib/components/logging/Trends.svelte';
	import { Users, Home } from 'lucide-svelte';


	let sheetOpen = false;

	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	// "Other" picker: every category the quick pills do not already cover, so
	// no log target is ever more than one tap from the dashboard.
	let otherOpen = false;
	let allOpen = false;

	function openLog(catId: string) {
		logKind = catId;
		otherOpen = false;
		allOpen = false;
		sheetOpen = true;
	}

	// The session context (families, active family, members, selection,
	// summary) lives in $lib/stores/family; the tracking lists in
	// $lib/stores/trackingLists. Aliases keep the template reading the names
	// the page always used; writes go through the stores' actions.
	$: families = $familyStore.families;
	$: activeFamily = $familyStore.activeFamily;
	$: activeFamilyId = $familyStore.activeFamilyId;
	$: profiles = $familyStore.profiles;
	$: selectedMemberId = $familyStore.selectedMemberId;
	$: summary = $familyStore.summary;
	// The selected member's own pins and stage, so every surface agrees on what
	// this person can log.
	$: selectedMember = profiles.find((b) => Number(b.id) === selectedMemberId) ?? null;
	$: selectedQuickLinks = selectedMember?.quickLinks ?? null;
	$: selectedStage = selectedMember?.stage ?? null;
	// Categories enabled for the selected member.
	$: activeCategories = $familyStore.activeCategories;
	// The person the page opens on. Stored per family, because a household that
	// mostly records against one child should not have to re-pick them each visit.
	let starredMemberId: number | null = null;
		// Which logger the sheet is showing. Deliberately its own state: it was once
	// shared with the activity tab and reset by a category-availability guard, so
	// a background load finishing while the sheet was open would change the kind
	// mid-entry and the form would vanish under the person typing into it.
	let logKind = 'feeds';

	$: feedings = $trackingListsStore.feedings;
	$: diapers = $trackingListsStore.diapers;
	$: sleeps = $trackingListsStore.sleeps;
	$: growths = $trackingListsStore.growths;
	$: milestones = $trackingListsStore.milestones;
	$: vaccinations = $trackingListsStore.vaccinations;
	$: moods = $trackingListsStore.moods;
	$: journalEntries = $trackingListsStore.journalEntries;
	$: vitals = $trackingListsStore.vitals;
	$: listTotals = $trackingListsStore.listTotals;
	$: loadingMore = $trackingListsStore.loadingMore;

	// The page's refresh entry points, straight from the stores.
	const refreshLists = trackingListsActions.refreshLists;
	const loadMoreLists = trackingListsActions.loadMoreLists;
	const refreshSummary = familyActions.refreshSummary;

	// Quick feed reports over the loaded feedings (see $lib/logging/feedStats).
	$: feedReports = computeFeedReports(feedings);

	// The family/member loading core is familyActions.loadFamilies
	// ($lib/stores/family). The starred hook runs at the exact point the old
	// page copy read it — after the active family resolves, before the
	// members land — and its answer wins over the saved default. Extras are
	// skipped when the core load bails, as the old early returns did.
	async function loadFamilies() {
		const loaded = await familyActions.loadFamilies(() => {
			loadStarred();
			return starredMemberId;
		});
		if (!loaded) return;
		await Promise.all([
			loadFamilySettings({ applyTimezone: true }),
			refreshLists(),
			refreshSummary(),
			loadInvitations(),
			loadImportRuns(),
		]);
	}

	function handleLogout() {
		familyActions.handleLogout();
		isAuthenticated = false;
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

	/**
	 * Selection itself is synchronous in the store, so the refreshes below
	 * read the just-selected member immediately (reactive statements are
	 * scheduled — see currentIsTrackable in $lib/stores/family). The refresh
	 * order is this page's, and must stay lists first, then summary.
	 */
	async function selectMember(memberId: number) {
		familyActions.selectMember(memberId);
		await refreshLists();
		await refreshSummary();
	}

	function starredKey(): string {
		return `nido.starred.${get(familyStore).activeFamilyId ?? 'none'}`;
	}

	function loadStarred() {
		try {
			const raw = localStorage.getItem(starredKey());
			starredMemberId = raw ? Number(raw) : null;
		} catch {
			starredMemberId = null;
		}
	}

	function setStarred(memberId: number) {
		starredMemberId = memberId;
		try { localStorage.setItem(starredKey(), String(memberId)); } catch { /* private mode */ }
	}

	/**
	 * Pin or unpin a tile for the selected person.
	 *
	 * Stored on the member so it follows them between devices, and so switching
	 * to yourself brings back what *you* log rather than the baby's tiles.
	 */
	async function setQuickLink(kind: string, pin: boolean) {
		if (!activeFamilyId || !selectedMember) return;
		// The implicit set is the member's leading categories, which is what the
		// tiles show before anything has been pinned — pinning must extend that
		// rather than replace it with a single tile.
		const current: string[] = selectedMember.quickLinks?.length ? selectedMember.quickLinks : activeCategories.slice(0, 4);
		const next = pin
			? current.includes(kind) ? current : [...current, kind]
			: current.filter((k) => k !== kind);
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(selectedMember.id), { quickLinks: next });
			// Reassign, don't mutate: selectedMember is derived from profiles, and
			// mutating the object in place does not re-run the reactive statement,
			// so the panel kept showing the old layout until a hard reload.
			familyActions.patchProfile(Number(selectedMember.id), { quickLinks: next });
		} catch (err: any) {
			console.error('Failed to update quick links', err);
		}
	}

	async function saveDashboardTiles(tiles: string[] | null) {
		if (!activeFamilyId || !selectedMember) return;
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(selectedMember.id), { dashboardTiles: tiles });
			// Reassign, don't mutate: selectedMember is derived from profiles, and
			// mutating the object in place does not re-run the reactive statement,
			// so the panel kept showing the old layout until a hard reload.
			familyActions.patchProfile(Number(selectedMember.id), { dashboardTiles: tiles });
			notify('Dashboard panel saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update dashboard tiles');
		}
	}

	// Invite-by-email
	let invitations: any[] = [];

	// Import data (Narababy CSV)
	let importRuns: any[] = [];

	let stopOutboxSync: (() => void) | undefined;

	async function onLogged(e: CustomEvent<{ message: string }>) {
		notify(e.detail.message);
		await refreshLists();
		await refreshSummary();
	}

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
			// The store outlives navigations; a fresh mount while signed out
			// starts empty, like the page-local state this replaced.
			if (!isAuthenticated) familyActions.reset();
			if (isAuthenticated) {
				await Promise.all([loadFamilies(), refreshUserProfile()]);
				// Reconnect resilience: push anything queued while offline, then
				// keep replaying every 60s until the page goes away.
				stopOutboxSync = startOutboxSync(async () => {
					await refreshLists();
					await refreshSummary();
				});
			}
			// Older builds kept one never-expiring timer blob per member; it is what
			// made finished feeds reappear, so drop any that are still around.
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const k = localStorage.key(i);
				if (k && /^nido\.timer\.\d+$/.test(k)) localStorage.removeItem(k);
			}
		}
	});

	onDestroy(() => {
		if (stopOutboxSync) stopOutboxSync();
	});
</script>
				<FeedbackToasts />
				<div class="max-w-4xl mx-auto space-y-6 md:space-y-4 md:space-y-6">
					<section>
						<div class="flex items-center justify-between mb-6">
							<div class="flex items-center gap-3">
								<span class="w-10 h-10 rounded-full border-2 border-link text-link flex items-center justify-center" aria-hidden="true"><Users class="w-5 h-5" /></span>
								<h2 class="text-2xl font-display font-semibold">Family</h2>
							</div>
							<button type="button" on:click={() => goto('/family')} class="text-sm font-semibold text-link hover:underline">Go to Family &rarr;</button>
						</div>
						
						{#if families.length === 0}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 text-center border border-line-soft">
								<p class="text-ink-soft mb-4">You haven't set up a family yet.</p>
								<button type="button" on:click={() => goto('/family')} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary">Build your family</button>
							</div>
						{:else if profiles.length === 0}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 text-center border border-line-soft">
								<p class="text-ink-soft mb-4">Your family has no members yet.</p>
								<button type="button" on:click={() => goto('/family')} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary">Add a member</button>
							</div>
						{:else}
							<div class="mb-6">
								<MemberSwitcher
									members={profiles.map((b) => ({ id: Number(b.id), name: b.name, avatar: b.avatar, stage: b.stage }))}
									selectedId={selectedMemberId}
									starredId={starredMemberId}
									familyId={activeFamilyId}
									on:select={(e) => selectMember(e.detail.memberId)}
									on:star={(e) => { setStarred(e.detail.memberId); selectMember(e.detail.memberId); }}
								/>
							</div>

							<MemberActivity
								memberName={selectedMember?.name || 'Selected'}
								memberId={selectedMemberId}
								{summary}
								{activeCategories}
								quickLinks={selectedQuickLinks}
								dashboardTiles={selectedMember?.dashboardTiles ?? null}
								stage={selectedStage}
								{feedings} {diapers} {sleeps} {growths}
								{milestones} {vaccinations} {moods} {journalEntries} {vitals}
								totals={listTotals}
								{loadingMore}
								on:log={(e) => openLog(e.detail.kind)}
								on:loadmore={loadMoreLists}
								on:refresh={async () => { await refreshLists(); await refreshSummary(); }}
								on:pin={(e) => setQuickLink(e.detail.kind, true)}
								on:unpin={(e) => setQuickLink(e.detail.kind, false)}
								on:saveTiles={(e) => saveDashboardTiles(e.detail.tiles)}
							>
								<!-- Rates over the last week, next to the last-seen tiles: the
								     tiles say "how long ago", this says "how often". -->
								{#if selectedMember}
									<div class="mt-6">
										<Trends memberId={Number(selectedMember.id)} memberName={selectedMember.name} categories={activeCategories} />
									</div>
								{/if}

								<div class="mt-6">
									<StockGlance />
								</div>
							</MemberActivity>
						{/if}
					</section>

					<section>
						<div class="flex items-center justify-between mb-6">
							<div class="flex items-center gap-3">
								<span class="w-10 h-10 rounded-full border-2 border-accent text-accent flex items-center justify-center" aria-hidden="true"><Home class="w-5 h-5" /></span>
								<h2 class="text-2xl font-display font-semibold">Home</h2>
							</div>
							<button type="button" on:click={() => goto('/home')} class="text-sm font-semibold text-accent hover:underline">Go to Home &rarr;</button>
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
					</section>
				</div>

<LogDrawer
	bind:open={sheetOpen}
	kind={logKind}
	familyId={activeFamilyId}
	memberId={selectedMemberId}
	members={profiles}
	on:saved={onLogged}
	on:error={(e) => fail(e.detail.message)}
	on:notice={(e) => notify(e.detail.message)}
/>
