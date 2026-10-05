<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { authAPI, userAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import PhotoStrip from '$lib/components/PhotoStrip.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { CATEGORIES, defaultMemberId } from '$lib/shared';
	import { Home, Timer, AlertCircle, Check } from 'lucide-svelte';

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
	const QUICK_LINK_DEFAULT = ['feeds', 'diapers', 'sleep'];

	function quickLinksKey(userId: number | null) {
		return `nido.quicklinks.${userId ?? $authStore.user?.id}`;
	}

	function loadQuickLinks() {
		const key = quickLinksKey($authStore.user?.id ?? null);
		try {
			const raw = localStorage.getItem(key);
			const parsed = raw ? JSON.parse(raw) : null;
			if (Array.isArray(parsed) && parsed.length > 0) quickLinks = parsed;
			else quickLinks = [...QUICK_LINK_DEFAULT];
		} catch {
			quickLinks = [...QUICK_LINK_DEFAULT];
		}
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
	// Feeds, sleep, diapers and the rest only exist for a trackable profile.
	let selectedIsTrackable = true;

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
	// Photos (toggle state only — the PhotoStrip component handles loading)
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
		if (!selectedIsTrackable) {
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
		if (!selectedIsTrackable) {
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
			error = e.response?.data?.error || 'Failed to load tracking data.';
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
			activeFamilyId = activeFamily.familyId;

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
				selectedMemberId = match ? Number(match.id) : defaultMemberId(babies);
				const selected = babies.find((b) => Number(b.id) === selectedMemberId);
				selectedIsTrackable = selected ? selected.trackable !== false : false;
				activeCategories = selected?.categories?.length ? selected.categories : CATEGORIES.map((c) => c.id);
				if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
			} else {
				selectedMemberId = null;
				selectedIsTrackable = false;
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

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			const cats = familySettings.categories;
			if (cats && cats.length) {
				activeCategories = cats;
			}
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
			}
		}
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
 			<!-- HOME — future household/property tracking -->
			<div class="max-w-4xl mx-auto">
				<div class="flex items-center gap-3 mb-6">
					<span class="w-12 h-12 rounded-full border-2 border-accent text-accent flex items-center justify-center" aria-hidden="true"><Home class="w-6 h-6" /></span>
					<div>
						<h2 class="text-2xl font-display font-semibold">Home</h2>
						<p class="text-ink-soft text-sm">Tend to every place you call home.</p>
					</div>
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
			</div>
