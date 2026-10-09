<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { authAPI, userAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired, remindersAPI, type PageOptions, type Reminder } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { loadListsCache, saveListsCache } from '$lib/cache';
	import { flushOutbox } from '$lib/logging/outbox';
	import MemberActivity from '$lib/components/logging/MemberActivity.svelte';
	import GrowthChart from '$lib/components/logging/GrowthChart.svelte';
	import LogDrawer from '$lib/components/logging/LogDrawer.svelte';
	import StockGlance from '$lib/components/logging/StockGlance.svelte';
		import { CATEGORIES, defaultMemberId } from '$lib/shared';
	import { reminderNoun, reminderPhrase } from '$lib/shared';
	import { Baby, Star, Users, Trash2, Mail, AlertCircle, Activity, Check } from 'lucide-svelte';


  let familyView: 'dashboard' | 'detail' = 'dashboard';
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



	let loading = false;

	let profiles: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedMemberId: number | null = null;
		// Which logger the sheet is showing. Deliberately its own state: it was once
	// shared with the activity tab and reset by a category-availability guard, so
	// a background load finishing while the sheet was open would change the kind
	// mid-entry and the form would vanish under the person typing into it.
	let logKind = 'feeds';
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

	// ----- Reminders (family-scoped; shared by every caregiver) -----
	let reminderRules: Reminder[] = [];

	async function loadReminders() {
		try {
			reminderRules = (await remindersAPI.list()).data.reminders ?? [];
		} catch { reminderRules = []; }
	}

	$: overdueReminders = reminderRules.filter((r) => r.enabled && r.overdue);

	// Tracking categories — a member enables a subset; tabs render from it.
	let activeCategories: string[] = [];
	$: selectedMember = profiles.find((b) => Number(b.id) === selectedMemberId) ?? null;

	// Family-scoped tracking settings (categories + per-category option lists).
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>> } | null = null;

	let editingMember: any = null;
	let editMemberName = '';
	let editMemberBirthDate = '';
	let editMemberGender = '';
	let editMemberEmail = '';

	// Family onboarding
	let familyName = '';
	let memberType = 'child';
	let newMemberName = '';
	let newBabyBirthDate = '';
	let newBabyGender = 'female';
	let creatingBaby = false;

	// Invite-by-email
	let invitations: any[] = [];

	// Import data (Narababy CSV)
	let importRuns: any[] = [];

	// Account

	let feedings: any[] = [];
	let diapers: any[] = [];
	let sleeps: any[] = [];
	let growths: any[] = [];
	let milestones: any[] = [];
	let vaccinations: any[] = [];
	let moods: any[] = [];
	let journalEntries: any[] = [];

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

	function formatElapsed(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		return `${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
	}




	async function refreshSummary() {
		if (!selectedMemberId) return;
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
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
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
			// Baby tracking only. The person who created the household is an adult
			// member of it, so a household with no child yet would otherwise fire
			// requests that are refused.
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

	// Edit modal state — the shared RecordEditModal owns the fields.

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
			activeFamilyId = activeFamily?.familyId ?? null;

			const membersRes = await familiesAPI.members(activeFamilyId);
			const members = membersRes.data.members;
			// Members are the profiles the tracker operates on (child/adult; "newborn"
			// is a child with newborn categories enabled).
			profiles = members.map((m) => ({
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

	function setActiveFamily(familyId: string) {
		activeFamilyId = familyId;
		if (browser) localStorage.setItem('nido.familyId', familyId);
		loadFamilies();
	}

	function setDefaultProfile(memberId: number) {
		defaultProfileId = memberId;
		selectedMemberId = memberId;
		if (browser) localStorage.setItem('nido.defaultProfile', String(memberId));
		notice = 'Default profile updated.';
		error = '';
	}




	function handleLogout() {
		authActions.logout();
		isAuthenticated = false;
		profiles = [];
		selectedMemberId = null;
	}

	async function buildFamily(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!familyName.trim()) {
			error = 'Give your family a name (e.g. "The Hollybrooks").';
			return;
		}
		creatingBaby = true;
		try {
			const payload: any = { name: familyName.trim() };
			if (newMemberName) {
				payload.member = {
					type: memberType,
					name: newMemberName.trim(),
					birthDate: newBabyBirthDate ? new Date(newBabyBirthDate).toISOString() : undefined,
					gender: newBabyGender,
				};
			}
			const res = await familiesAPI.create(payload);
			const fam = res.data.family;
			notice = `${fam.name} created — your family code is ${fam.familyCode}`;
			familyName = '';
			newMemberName = '';
			newBabyBirthDate = '';
			if (browser) localStorage.setItem('nido.familyId', fam.familyId);
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to create your family.';
			console.error(err);
		} finally {
			creatingBaby = false;
		}
	}

	async function addFamilyMember(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!newMemberName) {
			error = 'Member name is required.';
			return;
		}
		if (!activeFamilyId) return;
		creatingBaby = true;
		try {
			const res = await familiesAPI.addMember(activeFamilyId, {
				type: memberType,
				name: newMemberName.trim(),
				birthDate: newBabyBirthDate ? new Date(newBabyBirthDate).toISOString() : undefined,
				gender: newBabyGender,
			});
			notice = `${res.data.member.name} added to the family.`;
			newMemberName = '';
			newBabyBirthDate = '';
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to add family member.';
			console.error(err);
		} finally {
			creatingBaby = false;
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
		const selected = profiles.find((b) => Number(b.id) === memberId);
		// The API resolves this to the member's own set, constrained by their
				// stage. An empty list is a real answer, not a prompt to show everything.
				activeCategories = selected?.categories ?? [];
		await refreshLists();
		await refreshSummary();
	}

	/** Pin or unpin a tile for the selected person; stored on the member. */
	async function setQuickLink(kind: string, pin: boolean) {
		if (!activeFamilyId || !selectedMember) return;
		const current: string[] = selectedMember.quickLinks?.length ? selectedMember.quickLinks : activeCategories.slice(0, 4);
		const next = pin
			? current.includes(kind) ? current : [...current, kind]
			: current.filter((k) => k !== kind);
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(selectedMember.id), { quickLinks: next });
			selectedMember.quickLinks = next;
			profiles = profiles;
		} catch (err: any) {
			console.error('Failed to update quick links', err);
		}
	}

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			// Deliberately does NOT touch activeCategories. Those are the selected
			// member's own categories; the family-level list is a different thing
			// that used to overwrite them here.
		} catch (err: any) {
			console.error('Failed to load family settings:', err);
		}
	}







	function openEditMember(baby: any) {
		editingMember = baby;
		editMemberName = baby.name || '';
		editMemberBirthDate = baby.birth_date ? baby.birth_date.slice(0, 10) : '';
		editMemberGender = baby.gender || '';
		editMemberEmail = baby.email || '';
		error = '';
	}

	function closeEditMember() {
		editingMember = null;
	}

	async function deleteEditMember() {
		if (!editingMember || !activeFamilyId) return;
		if (!confirm(`Delete "${editMemberName.trim() || editingMember.name}" and ALL of their records? This cannot be undone.`)) return;
		try {
			await familiesAPI.removeMember(activeFamilyId, Number(editingMember.id));
			notice = 'Member deleted.';
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to delete member.';
		}
	}

	async function saveEditMember(event: SubmitEvent) {
		event.preventDefault();
		if (!editingMember || !activeFamilyId) return;
		try {
			const birthDate = editMemberBirthDate ? new Date(editMemberBirthDate + 'T00:00:00Z').toISOString() : null;
			await familiesAPI.updateMember(activeFamilyId, Number(editingMember.id), {
				name: editMemberName.trim(),
				birthDate,
				gender: editMemberGender || null,
				email: editMemberEmail.trim() || null,
			});
			notice = 'Member updated.';
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update member.';
		}
	}

	async function inviteMemberEmail(email: string) {
		if (!email || !activeFamilyId) return;
		try {
			await familiesAPI.invite(activeFamilyId, email);
			notice = `Invite sent to ${email}.`;
			await loadInvitations();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send invite.';
		}
	}

	async function onMemberAvatarSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.uploadAvatar(activeFamilyId, Number(editingMember.id), file);
			notice = 'Profile photo updated.';
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to upload photo.';
		}
	}


	

	let outboxTimer: number | undefined;

	function openLog(kind: string) {
		logKind = kind;
		sheetOpen = true;
	}

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

	async function loadMoreLists() {
		if (!selectedMemberId || loadingMore) return;
		const memberId = selectedMemberId;
		const loaded = currentLists();
		const pending = LIST_SOURCES.filter((src) => loaded[src.key].length < (listTotals[src.key] ?? 0));
		if (pending.length === 0) return;

		loadingMore = true;
		try {
			await Promise.all(pending.map(async (src) => {
				const res = await src.page(memberId, { limit: HISTORY_PAGE_SIZE, offset: loaded[src.key].length });
				const items = res.data?.[src.field] ?? [];
				if (items.length === 0) return;
				setList(src.key, [...loaded[src.key], ...items]);
				if (typeof res.data?.total === 'number') listTotals = { ...listTotals, [src.key]: res.data.total };
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
		{#if families.length === 0}
			<!-- FAMILY ONBOARDING: build your family first -->
			<div class="flex justify-end mb-4">
				<button type="button" class="px-3 py-1 text-sm bg-surface2 text-ink-soft rounded-md hover:bg-line-soft" on:click={handleLogout}>Sign Out</button>
			</div>
			<div class="max-w-2xl mx-auto bg-surface rounded-lg shadow-card p-4 md:p-6">
				<h2 class="text-2xl font-display font-semibold mb-2">Build your family</h2>
				<p class="text-ink-soft mb-4">Nido is family-first. Start by naming your family — anyone you invite joins it.</p>
				<form on:submit={buildFamily}>
					<div class="mb-4">
						<label for="family-name" class="block text-sm font-medium text-ink-soft mb-1">Family Name</label>
						<input id="family-name" bind:value={familyName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="The Hollybrooks" />
					</div>

					<fieldset class="border border-line-soft rounded-lg p-4 mb-4">
						<legend class="text-sm text-ink-soft px-2">Add your first family member (optional)</legend>
						<div class="mb-3">
							<label for="member-type" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
							<select id="member-type" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
								<option value="child" selected>Child</option>
								<option value="adult">Adult</option>
							</select>
						</div>
						<div class="mb-3">
							<label for="member-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
							<input id="member-name" bind:value={newMemberName} class="w-full px-3 py-2 border border-line rounded-md" placeholder="Aiden" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label for="member-dob" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
								<input id="member-dob" type="date" bind:value={newBabyBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="member-gender" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
								<select id="member-gender" bind:value={newBabyGender} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="female" selected>Female</option>
									<option value="male">Male</option>
									<option value="other">Other</option>
								</select>
							</div>
						</div>
					</fieldset>

					<button type="submit" disabled={creatingBaby} class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary disabled:opacity-50">
						{creatingBaby ? 'Creating...' : 'Build Family'}
					</button>
				</form>
			</div>
		{:else if profiles.length === 0}
			<!-- DASHBOARD (family exists, no members yet): add a member first -->
			<div class="flex items-center justify-between mb-6">
				<div>
					<h2 class="text-2xl font-display font-semibold">{activeFamily?.name}
						<span class="text-accent font-mono text-sm">({activeFamily?.familyCode})</span>
					</h2>
				</div>
				<button type="button" class="px-4 py-2 bg-primary text-on-primary rounded-md hover:bg-primary" on:click={handleLogout}>Sign Out</button>
			</div>

			<div class="max-w-2xl mx-auto bg-surface rounded-lg shadow-card p-4 md:p-6">
				<h3 class="text-xl font-display font-semibold mb-2">Add your first family member</h3>
				<p class="text-ink-soft mb-4">Adding a Baby is the first supported member type.</p>
				<form on:submit={addFamilyMember}>
					<div class="mb-3">
						<label for="member-type-2" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
						<select id="member-type-2" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="child" selected>Child</option>
							<option value="adult">Adult</option>
						</select>
					</div>
					<div class="mb-3">
						<label for="member-name-2" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
						<input id="member-name-2" bind:value={newMemberName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Aiden" />
					</div>
					<div class="grid grid-cols-2 gap-3 mb-3">
						<div>
							<label for="member-dob-2" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
							<input id="member-dob-2" type="date" bind:value={newBabyBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div>
							<label for="member-gender-2" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
							<select id="member-gender-2" bind:value={newBabyGender} class="w-full px-3 py-2 border border-line rounded-md">
								<option value="female" selected>Female</option>
								<option value="male">Male</option>
								<option value="other">Other</option>
							</select>
						</div>
					</div>
					<button type="submit" disabled={creatingBaby} class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary disabled:opacity-50">
						{creatingBaby ? 'Adding...' : 'Add Family Member'}
					</button>
				</form>
			</div>
		{:else}
			<!-- DASHBOARD (family + members) -->
			{#if familyView === 'dashboard'}
			<div class="flex flex-col mb-6 gap-4">
				<div class="flex flex-col gap-3">
					{#if families.length > 1}
						<div class="flex overflow-x-auto no-scrollbar">
							<div class="flex gap-2">
								{#each families as fam}
									<button type="button" on:click={() => setActiveFamily(fam.familyId)} class="{activeFamilyId === fam.familyId ? 'bg-surface2 text-ink border-line' : 'bg-surface text-ink-soft border-line-soft'} h-9 px-3 rounded-full text-xs border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors">
										<Users class="w-3 h-3" />
										{fam.name}
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<span class="text-sm font-semibold text-ink-soft flex items-center gap-1"><Users class="w-4 h-4" /> {activeFamily?.name}</span>
					{/if}

					<div class="flex items-center gap-3">
						{#if profiles.length > 1}
							<div class="flex-1 overflow-x-auto no-scrollbar">
								<div class="flex gap-2">
									{#each profiles as baby}
										<button type="button" on:click={() => selectMember(Number(baby.id))} class="{selectedMemberId === Number(baby.id) ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors">
											<Avatar familyId={activeFamilyId} memberId={baby.id} avatar={baby.avatar} alt={baby.name} class="w-5 h-5 rounded-full object-cover">
												<Baby class="w-4 h-4" />
											</Avatar>
											{baby.name}
										</button>
									{/each}
								</div>
							</div>
							<button
								type="button"
								title="Set as default profile"
								class="px-2 py-1 rounded-md text-ink-soft hover:text-accent text-xs shrink-0"
								on:click={() => { if (selectedMemberId) setDefaultProfile(selectedMemberId); }}
							>
								<Star class="w-5 h-5 {defaultProfileId === selectedMemberId ? 'text-accent' : 'text-ink-soft opacity-50'}" aria-hidden="true" />
							</button>
						{:else if profiles.length === 1}
							<h2 class="text-xl md:text-2xl font-display font-semibold text-ink flex items-center gap-2">
								<Avatar familyId={activeFamilyId} memberId={profiles[0].id} avatar={profiles[0].avatar} alt={profiles[0].name} class="w-8 h-8 rounded-full object-cover" />
								{profiles[0].name}
							</h2>
						{/if}
					</div>
				</div>
<div class="flex flex-wrap items-center gap-2">
				</div>
			</div>
			{/if}

			{#if overdueReminders.length > 0}
				<div class="bg-danger border border-danger text-danger-text rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
					<div>
						<p class="text-sm font-semibold">Reminders</p>
						<p class="text-xs">
							{#each overdueReminders as o}
								{#if o.kind === 'inactivity'}
									{@const what = o.conditions?.length ? reminderPhrase(o.conditions, o.match) : reminderNoun(o.category)}
									<span class="capitalize">no {what} in {o.hours}h{o.since ? ` (since ${new Date(o.since).toLocaleString()})` : ' (never recorded)'}</span>
								{:else}
									<span>{o.label || o.category} — every {o.intervalDays}d{o.since ? ` (last {new Date(o.since).toLocaleString()})` : ' (never done)'}</span>
								{/if}{o !== overdueReminders[overdueReminders.length - 1] ? ' · ' : ''}
							{/each}
						</p>
					</div>
					<a href="/notifications" class="bg-danger text-danger-text px-3 py-2 rounded-md text-sm font-semibold shrink-0">View</a>
				</div>
			{/if}

			{#if familyView === 'dashboard'}
				<div class="mb-8">
					<h2 class="text-2xl font-display font-semibold mb-4">Family Overview</h2>
					
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
						{#each profiles as baby}
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
								<div class="flex items-center gap-2">
								{#if baby.email}
									<button type="button" on:click={() => inviteMemberEmail(baby.email)} title="Re-send invite" class="px-2 py-2 text-xs text-accent hover:underline"><Mail class="w-4 h-4 inline mr-1" /> Invite</button>
								{/if}
								<button type="button" on:click={() => openEditMember(baby)} class="px-3 py-2 text-xs bg-surface2 text-ink-soft hover:text-ink rounded-md">Edit</button>
								<button type="button" on:click={() => { selectMember(baby.id); familyView = 'detail'; }} class="px-4 py-2 bg-surface2 text-ink-soft hover:text-ink rounded-md text-sm font-semibold">
									Log Activity
								</button>
							</div>
							</div>
						{/each}
					</div>

					<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft mb-8">
						<button type="button" on:click={() => { familyView = 'detail'; }} class="w-full text-left hover:bg-surface2 transition-colors rounded-md">
							<h3 class="text-lg font-display font-semibold mb-1">Quick reports <span class="text-xs text-ink-soft">· feeds →</span></h3>
						</button>
						<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Feeds (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.count1d}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg size (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgSize1d != null ? `${feedReports.avgSize1d.toFixed(1)}oz` : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg size (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgSize30d != null ? `${feedReports.avgSize30d.toFixed(1)}oz` : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Feeds (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.count30d}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg length (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgDur1d != null ? formatElapsed(feedReports.avgDur1d) : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg length (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgDur30d != null ? formatElapsed(feedReports.avgDur30d) : '—'}</p>
							</div>
						</div>
					</div>

					<StockGlance />

					<MemberActivity
						memberName={selectedMember?.name || 'Selected'}
						{summary}
						{activeCategories}
						quickLinks={selectedMember?.quickLinks ?? null}
						stage={selectedMember?.stage ?? null}
						{feedings} {diapers} {sleeps} {growths}
						{milestones} {vaccinations} {moods} {journalEntries}
						totals={listTotals}
						{loadingMore}
						on:log={(e) => openLog(e.detail.kind)}
						on:loadmore={loadMoreLists}
						on:refresh={async () => { await refreshLists(); await refreshSummary(); }}
						on:pin={(e) => setQuickLink(e.detail.kind, true)}
						on:unpin={(e) => setQuickLink(e.detail.kind, false)}
					/>

					<!-- The selected person's own reports. WHO percentiles are child
					     reference data, so this is a child who tracks growth. -->
					{#if selectedMember && (selectedMember.stage === 'infant' || selectedMember.stage === 'child') && activeCategories.includes('growth')}
						<GrowthChart memberId={Number(selectedMember.id)} memberName={selectedMember.name} />
					{/if}
				</div>
			{:else}
				<button type="button" on:click={() => (familyView = 'dashboard')} class="mb-2 text-ink-soft hover:text-ink flex items-center gap-1 text-sm font-semibold">
					<span aria-hidden="true">‹</span> {activeFamily?.name || 'Family'} <span class="text-ink-soft" aria-hidden="true">/</span> <span class="text-ink">{profiles.find((b) => Number(b.id) === selectedMemberId)?.name || 'Baby'}</span>
				</button>

				<MemberActivity
					memberName={selectedMember?.name || 'Selected'}
					{summary}
					{activeCategories}
					quickLinks={selectedMember?.quickLinks ?? null}
					stage={selectedMember?.stage ?? null}
					{feedings} {diapers} {sleeps} {growths}
					{milestones} {vaccinations} {moods} {journalEntries}
					totals={listTotals}
					{loadingMore}
					on:log={(e) => openLog(e.detail.kind)}
					on:loadmore={loadMoreLists}
					on:refresh={async () => { await refreshLists(); await refreshSummary(); }}
					on:pin={(e) => setQuickLink(e.detail.kind, true)}
					on:unpin={(e) => setQuickLink(e.detail.kind, false)}
				/>

				<!--
					Growth percentiles are WHO child reference data, so this only makes
					sense for a child who tracks growth — not an adult, and not a pet.
				-->
				{#if selectedMember && (selectedMember.stage === 'infant' || selectedMember.stage === 'child') && activeCategories.includes('growth')}
					<GrowthChart memberId={Number(selectedMember.id)} memberName={selectedMember.name} />
				{/if}
			{/if}
		{/if}

		{#if editingMember}
			<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
				<button type="button" class="absolute inset-0 bg-ink/40" aria-label="Close dialog" on:click={() => (editingMember = null)}></button>
				<div class="relative bg-surface rounded-lg shadow-card p-4 md:p-6 w-full max-w-md">
					<h3 class="text-xl font-display font-semibold mb-4">Edit family member</h3>
					<div class="flex items-center gap-3 mb-4">
						<div class="w-16 h-16 rounded-full bg-accent text-on-accent flex items-center justify-center font-display text-2xl overflow-hidden">
							<Avatar familyId={activeFamilyId} memberId={editingMember?.id} avatar={editingMember?.avatar} alt={editingMember?.name} class="w-full h-full object-cover">
								{editMemberName[0] || '?'}
							</Avatar>
						</div>
						<div>
							<label for="member-avatar" class="block text-sm font-medium text-ink-soft mb-1">Profile photo</label>
							<input id="member-avatar" type="file" accept="image/*" on:change={onMemberAvatarSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
						</div>
					</div>
					<form on:submit={saveEditMember} class="space-y-3">
						<div>
						<label for="edit-member-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
						<input id="edit-member-name" type="text" bind:value={editMemberName} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
							<label for="edit-member-birth" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
							<input id="edit-member-birth" type="date" bind:value={editMemberBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
							<label for="edit-member-sex" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
							<select id="edit-member-sex" bind:value={editMemberGender} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="female">Female</option>
									<option value="male">Male</option>
									<option value="other">Other</option>
								</select>
							</div>
						</div>
						<div>
						<label for="edit-member-email" class="block text-sm font-medium text-ink-soft mb-1">Email (for invites)</label>
						<div class="flex gap-2">
							<input id="edit-member-email" type="email" bind:value={editMemberEmail} class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="person@email.com" />
								<button type="button" on:click={() => inviteMemberEmail(editMemberEmail)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:text-ink"><Mail class="w-4 h-4 inline mr-1" /> Invite</button>
							</div>
						</div>
						<div class="flex justify-end gap-2">
							<button type="button" on:click={deleteEditMember} class="px-4 py-2 bg-danger text-danger-text rounded-md"><Trash2 class="w-4 h-4 inline mr-1" /> Delete</button>
							<button type="button" on:click={closeEditMember} class="px-4 py-2 bg-surface2 text-ink-soft rounded-md">Cancel</button>
							<button type="submit" class="px-4 py-2 bg-primary text-on-primary rounded-md">Save</button>
						</div>
					</form>
				</div>
			</div>
		{/if}


<LogDrawer
	bind:open={sheetOpen}
	kind={logKind}
	familyId={activeFamilyId}
	memberId={selectedMemberId}
	members={profiles}
	on:saved={onLogged}
	on:error={(e) => (error = e.detail.message)}
	on:notice={(e) => (notice = e.detail.message)}
/>
