<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { tokenExpired, currentFamilyId } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { feedingAPI, diaperAPI, sleepAPI, growthAPI, milestoneAPI, vaccinationAPI, moodAPI, journalAPI } from '$lib/api/records';
	import { importsAPI } from '$lib/api/system';
	import { assetsAPI } from '$lib/api/assets';
	import HomeForm from '$lib/components/logging/HomeForm.svelte';
	import HomePicture from '$lib/components/HomePicture.svelte';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { familyStore, familyActions } from '$lib/stores/family';
	import { loadFamilySettings } from '$lib/stores/familySettings';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { computeFeedReports } from '$lib/logging/feedStats';
	import { Home } from 'lucide-svelte';

	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	// The session context (families, active family, members, selection) lives
	// in $lib/stores/family. This page deliberately keeps its own simpler
	// list loader (getAll, no cache, no pagination, no vitals) — it is not
	// the paginated loader the tracking-lists store owns.
	$: families = $familyStore.families;
	$: activeFamily = $familyStore.activeFamily;
	$: activeFamilyId = $familyStore.activeFamilyId;
	$: profiles = $familyStore.profiles;
	$: selectedMemberId = $familyStore.selectedMemberId;
	let activeTab = 'feeds';
	// Categories enabled for the selected member.
	$: activeCategories = $familyStore.activeCategories;

	// Invite-by-email
	let invitations: any[] = [];

	// Import data (Narababy CSV)
	let importRuns: any[] = [];

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

	// The Homes card (issue #74): residences from the `homes` registry, each
	// with its assets. The residence IS the homes row — never a home asset —
	// and assets that carry no homeId stay family-wide, shown once at the
	// end rather than duplicated under every home.
	let residences: { id: number; name: string; kind: string; address: string | null; isPrimary: boolean; picture: number | null }[] = [];
	let homeAssets: any[] = [];
	// Management state (issue #76): the homes registry was read-only before.
	let showHomeForm = false;
	let editingHome: any = null;
	let homeNotice = '';
	let homeError = '';

	async function loadHomesAndAssets() {
		const familyId = currentFamilyId();
		if (!familyId) return;
		try {
			const [homesRes, assetsRes] = await Promise.all([
				familiesAPI.homes(familyId),
				assetsAPI.list(),
			]);
			residences = homesRes.data.homes ?? [];
			homeAssets = (assetsRes.data.assets ?? []).filter((a: any) => a.archivedAt === null);
		} catch {
			// The card is an index, not a gate; an empty card is honest.
			residences = [];
			homeAssets = [];
		}
	}

	function assetsAt(homeId: number | null): any[] {
		return homeAssets.filter((a) => (a.homeId ?? null) === homeId);
	}

	function onHomeSaved() {
		showHomeForm = false;
		editingHome = null;
		homeNotice = '';
		loadHomesAndAssets();
	}

	function onHomeDeleted() {
		showHomeForm = false;
		editingHome = null;
		// The API promotes a survivor when the primary goes; refresh shows it.
		loadHomesAndAssets();
	}

	/** The picture input's change: upload, then refresh the card. */
	async function onPictureChosen(event: Event, homeId: number) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		homeError = '';
		const familyId = currentFamilyId();
		if (!familyId) return;
		try {
			const form = new FormData();
			form.append('file', file);
			// familiesAPI has no FormData upload for homes; the route matches
			// the member-avatar shape, so post it directly through the client.
			const { default: client } = await import('$lib/api/client');
			await client.post(`/families/${familyId}/homes/${homeId}/picture`, form);
			await loadHomesAndAssets();
		} catch (e: any) {
			homeError = e?.response?.data?.error || 'Could not upload that picture.';
		}
	}

	// Quick feed reports over the loaded feedings (see $lib/logging/feedStats).
	$: feedReports = computeFeedReports(feedings);

	// The family/member loading core is familyActions.loadFamilies
	// ($lib/stores/family); this wrapper adds this page's post-load extras,
	// including the active-tab resync the old copy ran right after selection.
	async function loadFamilies() {
		const loaded = await familyActions.loadFamilies();
		if (!loaded) return;
		const state = get(familyStore);
		if (state.profiles.length > 0 && !state.activeCategories.includes(activeTab)) activeTab = state.activeCategories[0] || 'feeds';
		await Promise.all([
			loadFamilySettings({ applyTimezone: true }),
			refreshLists(),
			familyActions.refreshSummary(),
			loadInvitations(),
			loadImportRuns(),
		]);
	}

	function handleLogout() {
		familyActions.handleLogout();
		isAuthenticated = false;
		feedStartedAt = null;
		leftStartedAt = null;
		rightStartedAt = null;
		leftElapsed = 0;
		rightElapsed = 0;
		feedElapsed = 0;
		sleepStartedAt = null;
	}

	async function refreshLists() {
		const memberId = get(familyStore).selectedMemberId;
		if (!memberId) return;
		if (!familyActions.currentIsTrackable()) {
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
				feedingAPI.getAll(memberId),
				diaperAPI.getAll(memberId),
				sleepAPI.getAll(memberId),
				growthAPI.getAll(memberId),
				milestoneAPI.getAll(memberId),
				vaccinationAPI.getAll(memberId),
				moodAPI.getAll(memberId),
				journalAPI.getAll(memberId),
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
			// The store outlives navigations; a fresh mount while signed out
			// starts empty, like the page-local state this replaced.
			if (!isAuthenticated) familyActions.reset();
			if (isAuthenticated) {
				await Promise.all([loadFamilies(), refreshUserProfile(), loadHomesAndAssets()]);
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
					{@const fid = currentFamilyId()}
					<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 mb-6" data-testid="homes-card">
						<div class="flex items-baseline justify-between mb-3">
							<h3 class="text-xl font-display font-semibold">Homes</h3>
							<div class="flex items-center gap-3">
								<button type="button" class="text-sm font-semibold text-accent hover:underline" on:click={() => { showHomeForm = true; editingHome = null; }}>
									+ Add home
								</button>
								<a href="/assets" class="text-sm font-semibold text-accent hover:underline">Manage assets &rarr;</a>
							</div>
						</div>

						{#if showHomeForm}
							<HomeForm familyId={fid ?? ''} editing={editingHome}
								on:save={onHomeSaved} on:delete={onHomeDeleted}
								on:cancel={() => { showHomeForm = false; editingHome = null; }} />
						{/if}
						{#if homeNotice}<p class="text-sm text-ink-soft mb-3" role="status">{homeNotice}</p>{/if}
						{#if homeError}<p class="text-sm text-danger-text mb-3">{homeError}</p>{/if}

						{#if residences.length === 0}
							<div class="border border-dashed border-line rounded-md p-4 md:p-6 text-center text-ink-soft">
								<p class="text-lg font-display flex items-center justify-center gap-2"><Home class="w-5 h-5" /> Your first home will appear here</p>
								<p class="text-sm mt-2">Add a residence to start scoping assets to it.</p>
							</div>
						{:else}
							<ul class="grid gap-3">
								{#each residences as home (home.id)}
									<li class="border border-line-soft rounded-md p-3 flex gap-3" data-testid={`home-card-${home.id}`}>
										<HomePicture familyId={fid} homeId={home.id} picture={home.picture} alt={home.name} />
										<div class="min-w-0 flex-1">
											<div class="flex items-baseline justify-between gap-2">
												<p class="font-semibold text-ink">
													{home.name}{#if home.isPrimary}<span class="ml-2 text-xs font-normal text-ink-soft">primary</span>{/if}
												</p>
												<a href="/assets?homeId={home.id}" class="text-xs text-accent hover:underline">
													{assetsAt(home.id).length} asset{assetsAt(home.id).length === 1 ? '' : 's'} &rarr;
												</a>
											</div>
											{#if home.address}<p class="text-sm text-ink-soft mt-0.5">{home.address}</p>{/if}
											{#if assetsAt(home.id).length > 0}
												<p class="text-xs text-ink-soft mt-1">
													{assetsAt(home.id).map((a) => a.name).join(', ')}
												</p>
											{/if}
											<div class="flex items-center gap-3 mt-1.5 text-xs">
												<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => { showHomeForm = true; editingHome = home; }}>Edit</button>
												<label class="underline text-ink-soft hover:text-ink cursor-pointer">
													Picture
													<input type="file" accept="image/*" class="hidden" on:change={(e) => onPictureChosen(e, home.id)} />
												</label>
											</div>
										</div>
									</li>
								{/each}
								{#if assetsAt(null).length > 0}
									<li class="border border-dashed border-line-soft rounded-md p-3">
										<div class="flex items-baseline justify-between gap-2">
											<p class="font-semibold text-ink">Family-wide</p>
											<a href="/assets" class="text-xs text-accent hover:underline">
												{assetsAt(null).length} asset{assetsAt(null).length === 1 ? '' : 's'} &rarr;
											</a>
										</div>
										<p class="text-xs text-ink-soft mt-1">{assetsAt(null).map((a) => a.name).join(', ')}</p>
									</li>
								{/if}
							</ul>
						{/if}
					</div>
				{/if}

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
					<a href="/assets" class="bg-surface rounded-lg shadow p-4 md:p-6 text-center hover:shadow-md block">
						<h3 class="text-lg font-display font-semibold mb-2">Property Assets</h3>
						<p class="text-ink-soft">Track physical property and appliance inventory.</p>
					</a>
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
