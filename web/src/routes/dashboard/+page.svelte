<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authAPI, userAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired, remindersAPI, type PageOptions } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import PhotoStrip from '$lib/components/PhotoStrip.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { loadListsCache, saveListsCache } from '$lib/cache';
	import { flushOutbox } from '$lib/logging/outbox';
	import MemberActivity from '$lib/components/logging/MemberActivity.svelte';
	import LogDrawer from '$lib/components/logging/LogDrawer.svelte';
	import { Users, Home, AlertCircle, Check } from 'lucide-svelte';


	import { CATEGORIES, loadQuickLinks as loadSharedQuickLinks, saveQuickLinks as saveSharedQuickLinks } from '$lib/shared';





	let sheetOpen = false;

	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;
	let error = '';
	let notice = '';
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	function dismissFeedback() {
		notice = '';
		error = '';
		if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = undefined; }
	}
	$: if (notice || error) {
		if (feedbackTimer) clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => { feedbackTimer = undefined; notice = ''; error = ''; }, 6000);
	}

	let email = '';
	let password = '';
	let showForgot = false;
	let pendingResetToken = '';
	// Per-user mobile quick links (category ids), persisted in localStorage.
	let quickLinks: string[] = [];

	function loadQuickLinks() {
		quickLinks = loadSharedQuickLinks($authStore.user?.id ?? null);
	}

	function saveQuickLinks(next: string[]) {
		quickLinks = next;
		saveSharedQuickLinks($authStore.user?.id ?? null, next);
	}


	// "Other" picker: every category the quick pills do not already cover, so
	// no log target is ever more than one tap from the dashboard.
	let otherOpen = false;
	let allOpen = false;




	function openLog(catId: string) {
		activeTab = catId;
		otherOpen = false;
		allOpen = false;
		sheetOpen = true;
	}

	let loading = false;

	let babies: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedMemberId: number | null = null;
	let activeTab = 'feeds';
	let defaultProfileId: number | null = null;
	let summary: any = null;

	// ----- Reminders (server-backed, family-scoped) -----
	type ReminderRule = { id: number; kind: 'inactivity' | 'interval'; category: string; targetType: 'member' | 'home'; targetId: number | null; label: string | null; hours: number | null; intervalDays: number | null; overdue: boolean; since: string | null; enabled: boolean };
	let reminderRules: ReminderRule[] = [];

	async function loadReminders() {
		try {
			const res = await remindersAPI.list();
			reminderRules = res.data.reminders ?? [];
		} catch { reminderRules = []; }
	}



	$: overdueReminders = reminderRules.filter((r) => r.enabled && r.overdue);



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
	// Photos (toggle state only — the PhotoStrip component handles loading)
	// Account




	let feedings: any[] = [];
	let diapers: any[] = [];
	let sleeps: any[] = [];
	let growths: any[] = [];
	let milestones: any[] = [];
	let vaccinations: any[] = [];
	let moods: any[] = [];
	let journalEntries: any[] = [];

	// Server-side row count per list, used to offer "Load older records" only
	// when the server actually holds more than what is loaded.
	let listTotals: Record<string, number> = {};
	let loadingMore = false;

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
	] as const;

	function currentLists(): Record<string, any[]> {
		return { feedings, diapers, sleeps, growths, milestones, vaccinations, moods, journalEntries };
	}

	function setList(key: string, value: any[]) {
		if (key === 'feedings') feedings = value;
		else if (key === 'diapers') diapers = value;
		else if (key === 'sleeps') sleeps = value;
		else if (key === 'growths') growths = value;
		else if (key === 'milestones') milestones = value;
		else if (key === 'vaccinations') vaccinations = value;
		else if (key === 'moods') moods = value;
		else if (key === 'journalEntries') journalEntries = value;
	}

	async function loadMoreLists() {
		if (!selectedMemberId || loadingMore) return;
		const memberId = selectedMemberId;
		const loaded = currentLists();
		const pending = LIST_SOURCES.filter((s) => loaded[s.key].length < (listTotals[s.key] ?? 0));
		if (pending.length === 0) return;

		loadingMore = true;
		try {
			await Promise.all(pending.map(async (s) => {
				const res = await s.page(memberId, {
					limit: HISTORY_PAGE_SIZE,
					offset: loaded[s.key].length,
				});
				const items = res.data?.[s.field] ?? [];
				if (items.length === 0) return;
				setList(s.key, [...loaded[s.key], ...items]);
				if (typeof res.data?.total === 'number') listTotals = { ...listTotals, [s.key]: res.data.total };
			}));
			const next = currentLists();
			saveListsCache(memberId, {
				feedings: next.feedings, diapers: next.diapers, sleeps: next.sleeps, growths: next.growths,
				milestones: next.milestones, vaccinations: next.vaccinations, moods: next.moods,
				journalEntries: next.journalEntries,
			});
		} catch (e: any) {
			notice = e.response?.data?.error || 'Could not load older records.';
		} finally {
			loadingMore = false;
		}
	}

	// Breast-feeding totals + last side, derived from loaded feedings.


	function avg(a: number[]): number | null {
		if (a.length === 0) return null;
		return a.reduce((s, x) => s + x, 0) / a.length;
	}

	$: feedReports = (() => {
		const now = Date.now();
		const dayAgo = now - 24 * 3600 * 1000;
		const monthAgo = now - 30 * 24 * 3600 * 1000;
		const f = feedings.filter((x) => x.type === 'breast' || x.type === 'bottle' || x.type === 'formula');
		const withDuration = f.filter((x) => x.duration && x.duration > 0);
		const sizes1d = f.filter((x) => new Date(x.start_time).getTime() >= dayAgo && x.amount).map((x) => Number(x.amount));
		const sizes30d = f.filter((x) => new Date(x.start_time).getTime() >= monthAgo && x.amount).map((x) => Number(x.amount));
		const dur1d = withDuration.filter((x) => new Date(x.start_time).getTime() >= dayAgo).map((x) => Number(x.duration));
		const dur30d = withDuration.filter((x) => new Date(x.start_time).getTime() >= monthAgo).map((x) => Number(x.duration));
		return {
			count1d: f.filter((x) => new Date(x.start_time).getTime() >= dayAgo).length,
			count30d: f.length,
			avgSize1d: avg(sizes1d),
			avgSize30d: avg(sizes30d),
			avgDur1d: avg(dur1d),
			avgDur30d: avg(dur30d),
		};
	})();





	async function refreshSummary() {
		if (!selectedMemberId) return;
		try {
			const res = await healthAPI.getSummary(selectedMemberId);
			summary = res.data.summary;
		} catch {
			summary = null;
		}
	}

	async function refreshLists() {
		if (!selectedMemberId) return;
		// Paint instantly from the local cache so history survives reloads,
		// expired sessions, and offline use; the network response replaces it.
		const cached = loadListsCache(selectedMemberId);
		if (cached) {
			feedings = cached.feedings;
			diapers = cached.diapers;
			sleeps = cached.sleeps;
			growths = cached.growths;
			milestones = cached.milestones;
			vaccinations = cached.vaccinations;
			moods = cached.moods;
			journalEntries = cached.journalEntries;
		}
		try {
			const [f, d, s, g, m, v, mo, j] = await Promise.all([
				feedingAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				diaperAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				sleepAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				growthAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				milestoneAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				vaccinationAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				moodAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
				journalAPI.getPage(selectedMemberId, { limit: HISTORY_PAGE_SIZE }),
			]);
			feedings = f.data.feedings;
			diapers = d.data.diapers;
			sleeps = s.data.sleep;
			growths = g.data.growth;
			milestones = m.data.milestones;
			vaccinations = v.data.vaccinations;
			moods = mo.data.moods ?? [];
			journalEntries = j.data.entries ?? [];
			listTotals = {
				feedings: f.data.total ?? feedings.length,
				diapers: d.data.total ?? diapers.length,
				sleeps: s.data.total ?? sleeps.length,
				growths: g.data.total ?? growths.length,
				milestones: m.data.total ?? milestones.length,
				vaccinations: v.data.total ?? vaccinations.length,
				moods: mo.data.total ?? moods.length,
				journalEntries: j.data.total ?? journalEntries.length,
			};
			saveListsCache(selectedMemberId, {
				feedings, diapers, sleeps, growths,
				milestones, vaccinations, moods, journalEntries,
			});
		} catch (e: any) {
			if (!cached) {
				error = e.response?.data?.error || 'Failed to load tracking data.';
			} else {
				notice = 'Showing cached activities — will refresh when connected.';
			}
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
				babies = [];
				return;
			}
			// Prefer the saved default family, else the first.
			const savedFamily = localStorage.getItem('nido.familyId');
			activeFamily = families.find((f) => f.familyId === savedFamily) ?? families[0];
				activeFamilyId = activeFamily?.familyId ?? null;

			const membersRes = await familiesAPI.members(activeFamilyId);
			const members = membersRes.data.members;
			// Members are the profiles the tracker operates on (child/adult; "newborn"
			// is a child with newborn categories enabled).
			babies = members.map((m) => ({
				id: m.id,
				name: m.name,
				birth_date: m.birthDate ?? '',
				gender: m.gender ?? '',
				type: m.type ?? 'child',
				email: m.email ?? null,
				avatar: m.avatar ?? null,
				categories: Array.isArray(m.categories) ? m.categories : [],
				trackable: m.trackable !== false,
				legacyBabyId: m.legacyBabyId ?? null,
			}));

			if (babies.length > 0) {
				const savedDefault = defaultProfileId ?? null;
				const match = savedDefault ? babies.find((b) => Number(b.id) === savedDefault) : null;
				selectedMemberId = match ? Number(match.id) : Number(babies[0].id);
				const selected = babies.find((b) => Number(b.id) === selectedMemberId);
				activeCategories = selected?.categories?.length ? selected.categories : CATEGORIES.map((c) => c.id);
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
				error = 'Your session has expired. Please sign in again.';
				return;
			}
			error = e.response?.data?.error || 'Failed to load your families.';
			console.error(e);
		}
	}






	function handleLogout() {
		authActions.logout();
		isAuthenticated = false;
		babies = [];
		selectedMemberId = null;
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






	// Instance settings (Admin tab)
	let appSettings: any = null;
	let isPanelAdmin = false;
	let smtpHost = '';
	let smtpPort = 587;
	let smtpUser = '';
	let smtpFrom = '';
	let signupEnabled = true;
	let signupEnvLocked = false;
	let emailVerificationSetting = false;

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
				isPanelAdmin = Number(u.is_platform_admin ?? 0) === 1;
			}
			loadQuickLinks();
			loadReminders();
		} catch {
			isPanelAdmin = false;
		}
	}

	async function loadAppSettings() {
		try {
			const res = await settingsAPI.get();
			appSettings = res.data.settings;
			smtpHost = appSettings.smtpHost || '';
			smtpPort = appSettings.smtpPort || 587;
			smtpUser = appSettings.smtpUser || '';
			smtpFrom = appSettings.smtpFrom || '';
			signupEnabled = appSettings.signupEnabled;
			signupEnvLocked = appSettings.signupEnvLocked === true;
			emailVerificationSetting = appSettings.emailVerification;
		} catch {
			appSettings = null;
		}
	}






	async function selectMember(memberId: number) {
		selectedMemberId = memberId;
		const selected = babies.find((b) => Number(b.id) === memberId);
		activeCategories = selected?.categories?.length ? selected.categories : CATEGORIES.map((c) => c.id);
		if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
		await refreshLists();
		await refreshSummary();
	}

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings ?? null;
			const cats = familySettings?.categories;
			if (cats && cats.length) {
				activeCategories = cats;
			}
		} catch (err: any) {
			console.error('Failed to load family settings:', err);
		}
	}














	

	let outboxTimer: number | undefined;

	async function syncOutbox() {
		const synced = await flushOutbox({
			feeding: (payload) => feedingAPI.create(payload),
			sleep: (payload) => sleepAPI.create(payload),
		});
		if (synced > 0) {
			notice = `${synced} offline record(s) synced.`;
			await refreshLists();
			await refreshSummary();
		}
	}

	async function onLogged(e: CustomEvent<{ message: string }>) {
		notice = e.detail.message;
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
					notice = res.data.message || 'Email verified.';
				} catch (err: any) {
					error = err.response?.data?.error || 'Verification failed.';
				}
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			if (resetParam) {
				pendingResetToken = resetParam;
				showForgot = true;
				notice = 'Enter a new password to complete your password reset.';
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
				if (isPanelAdmin) await loadAppSettings();
				// Reconnect resilience: push anything queued while offline.
				await syncOutbox();
				outboxTimer = window.setInterval(() => syncOutbox(), 60 * 1000);
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
		if (browser && outboxTimer) window.clearInterval(outboxTimer);
	});
</script>
				{#if notice || error}
					<div class="fixed top-4 right-4 z-[70] w-full max-w-sm space-y-2" role="status" aria-live="polite">
						{#if notice}
							<div class="bg-surface border border-line-soft text-ink shadow-card px-4 py-3 rounded-md text-sm">
								<span class="inline-flex items-center gap-2"><Check class="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
								{notice}<button type="button" on:click={dismissFeedback} class="ml-auto text-ink-soft hover:text-ink shrink-0" aria-label="Dismiss">&times;</button></span>
							</div>
						{/if}
						{#if error}
							<div class="bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm">
								<span class="inline-flex items-center gap-2"><AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
								{error}<button type="button" on:click={dismissFeedback} class="ml-auto hover:opacity-70 shrink-0" aria-label="Dismiss">&times;</button></span>
							</div>
						{/if}
					</div>
				{/if}
				<div class="max-w-4xl mx-auto space-y-6 md:space-y-4 md:space-y-6">
					<section>
						<div class="flex items-center justify-between mb-6">
							<div class="flex items-center gap-3">
								<span class="w-10 h-10 rounded-full border-2 border-primary text-primary flex items-center justify-center" aria-hidden="true"><Users class="w-5 h-5" /></span>
								<h2 class="text-2xl font-display font-semibold">Family</h2>
							</div>
							<button type="button" on:click={() => goto('/family')} class="text-sm font-semibold text-primary hover:underline">Go to Family &rarr;</button>
						</div>
						
						{#if families.length === 0}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 text-center border border-line-soft">
								<p class="text-ink-soft mb-4">You haven't set up a family yet.</p>
								<button type="button" on:click={() => goto('/family')} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary">Build your family</button>
							</div>
						{:else if babies.length === 0}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 text-center border border-line-soft">
								<p class="text-ink-soft mb-4">Your family has no members yet.</p>
								<button type="button" on:click={() => goto('/family')} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary">Add a member</button>
							</div>
						{:else}
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
								{#each babies as baby}
									<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft flex items-center justify-between">
										<div class="flex items-center gap-4">
											<div class="w-12 h-12 rounded-full bg-accent text-on-accent flex items-center justify-center font-display text-xl overflow-hidden">
												<Avatar familyId={activeFamilyId} memberId={baby.id} avatar={baby.avatar} alt={baby.name} class="w-full h-full object-cover">
													{baby.name[0]}
												</Avatar>
											</div>
											<div>
												<h3 class="font-display font-semibold text-lg">{baby.name}</h3>
												<p class="text-sm text-ink-soft">Born {baby.birth_date.slice(0, 10)}</p>
											</div>
										</div>
										<button type="button" on:click={() => { selectMember(baby.id); document.getElementById('activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} class="px-4 py-2 bg-surface2 text-ink-soft hover:text-ink rounded-md text-sm font-semibold">
											Activities &rarr;
										</button>
									</div>
								{/each}
							</div>

							<MemberActivity
								memberName={babies.find((b) => b.id === selectedMemberId)?.name || 'Selected'}
								{quickLinks}
								{summary}
								{activeCategories}
								{feedings} {diapers} {sleeps} {growths}
								{milestones} {vaccinations} {moods} {journalEntries}
								totals={listTotals}
								{loadingMore}
								on:log={(e) => openLog(e.detail.kind)}
								on:loadmore={loadMoreLists}
								on:refresh={async () => { await refreshLists(); await refreshSummary(); }}
							/>
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

						{#if babies.length > 0}
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
	kind={activeTab}
	familyId={activeFamilyId}
	memberId={selectedMemberId}
	members={babies}
	on:saved={onLogged}
	on:error={(e) => (error = e.detail.message)}
	on:notice={(e) => (notice = e.detail.message)}
/>
