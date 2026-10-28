<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { familyStore, familyActions } from '$lib/stores/family';
	import { trackingListsStore, trackingListsActions } from '$lib/stores/trackingLists';
	import { loadFamilySettings } from '$lib/stores/familySettings';
	import Avatar from '$lib/components/Avatar.svelte';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import EditMemberModal from '$lib/components/EditMemberModal.svelte';
	import { startOutboxSync } from '$lib/logging/outbox';
	import { loadReminders, loadUpcomingAppointments, overdueReminders, upcomingAppointments } from '$lib/stores/reminders';
	import MemberActivity from '$lib/components/logging/MemberActivity.svelte';
	import GrowthChart from '$lib/components/logging/GrowthChart.svelte';
	import LogDrawer from '$lib/components/logging/LogDrawer.svelte';
	import StockGlance from '$lib/components/logging/StockGlance.svelte';
	import { reminderNoun, reminderPhrase } from '$lib/shared';
	import { zonedOptions } from '$lib/logging/format';
	import { computeFeedReports, formatElapsed } from '$lib/logging/feedStats';
	import { Baby, Star, Users, Mail, CalendarClock } from 'lucide-svelte';


  let familyView: 'dashboard' | 'detail' = 'dashboard';
  let sheetOpen = false;

  $: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	// The session context — families, the active family, its members, the
	// selection and the summary — lives in $lib/stores/family; the nine
	// tracking lists in $lib/stores/trackingLists. These aliases keep the
	// template reading the names the page always used; every write goes
	// through the stores' actions.
	$: families = $familyStore.families;
	$: activeFamily = $familyStore.activeFamily;
	$: activeFamilyId = $familyStore.activeFamilyId;
	$: profiles = $familyStore.profiles;
	$: selectedMemberId = $familyStore.selectedMemberId;
	$: defaultProfileId = $familyStore.defaultProfileId;
	$: summary = $familyStore.summary;
	// Tracking categories — a member enables a subset; tabs render from it.
	$: activeCategories = $familyStore.activeCategories;
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

		// Which logger the sheet is showing. Deliberately its own state: it was once
	// shared with the activity tab and reset by a category-availability guard, so
	// a background load finishing while the sheet was open would change the kind
	// mid-entry and the form would vanish under the person typing into it.
	let logKind = 'feeds';

	$: selectedMember = profiles.find((b) => Number(b.id) === selectedMemberId) ?? null;

	// The page's refresh entry points, straight from the stores.
	const refreshLists = trackingListsActions.refreshLists;
	const loadMoreLists = trackingListsActions.loadMoreLists;
	const refreshSummary = familyActions.refreshSummary;

	$: feedReports = computeFeedReports(feedings);

	// Reminders and what the family has booked ahead live in
	// $lib/stores/reminders: the store owns the DATA_CHANGED refresh, so the
	// page only triggers the initial loads (refreshUserProfile and
	// loadFamilies) and renders from the stores.

	// The family/member loading core is familyActions.loadFamilies
	// ($lib/stores/family); this wrapper runs this page's post-load extras in
	// the order the page always ran them. Extras are skipped when the core
	// load bails (the pre-store copies returned early on every error path).
	async function loadFamilies() {
		const loaded = await familyActions.loadFamilies();
		if (!loaded) return;
		await Promise.all([
			loadFamilySettings({ applyTimezone: true }),
			refreshLists(),
			refreshSummary(),
			loadUpcomingAppointments(),
		]);
	}

	function setActiveFamily(familyId: string) {
		familyActions.setActiveFamily(familyId);
		loadFamilies();
	}

	function setDefaultProfile(memberId: number) {
		familyActions.setDefaultProfile(memberId);
	}

	function handleLogout() {
		familyActions.handleLogout();
		isAuthenticated = false;
	}



	async function buildFamily(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		if (!familyName.trim()) {
			fail('Give your family a name (e.g. "The Hollybrooks").');
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
			notify(`${fam.name} created — your family code is ${fam.familyCode}`);
			familyName = '';
			newMemberName = '';
			newBabyBirthDate = '';
			if (browser) localStorage.setItem('nido.familyId', fam.familyId);
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to create your family.');
			console.error(err);
		} finally {
			creatingBaby = false;
		}
	}

	async function addFamilyMember(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		if (!newMemberName) {
			fail('Member name is required.');
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
			notify(`${res.data.member.name} added to the family.`);
			newMemberName = '';
			newBabyBirthDate = '';
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to add family member.');
			console.error(err);
		} finally {
			creatingBaby = false;
		}
	}


	// The signed-in user's own profile, and the entry point that loads the
	// family's reminders; the DATA_CHANGED listener covers later refreshes.
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
			loadReminders();
		} catch {
			// getMe failing is not worth a toast; reminders still refresh via
			// the DATA_CHANGED listener on the next successful mutation.
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

	/** Pin or unpin a tile for the selected person; stored on the member. */
	async function setQuickLink(kind: string, pin: boolean) {
		if (!activeFamilyId || !selectedMember) return;
		const current: string[] = selectedMember.quickLinks?.length ? selectedMember.quickLinks : activeCategories.slice(0, 4);
		const next = pin
			? current.includes(kind) ? current : [...current, kind]
			: current.filter((k) => k !== kind);
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(selectedMember.id), { quickLinks: next });
			// Reassign, don't mutate: selectedMember is derived from profiles, and
			// mutating the object in place never re-runs the reactive statement, so
			// the pinned set kept showing the old layout until a hard reload.
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
			// mutating the object in place never re-runs the reactive statement, so
			// the panel kept showing the old layout until a hard reload.
			familyActions.patchProfile(Number(selectedMember.id), { dashboardTiles: tiles });
			notify('Dashboard panel saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update dashboard tiles');
		}
	}


	// Edit modal state — the shared EditMemberModal owns the form fields.

	let editingMember: any = null;

	// Family onboarding
	let familyName = '';
	let memberType = 'child';
	let newMemberName = '';
	let newBabyBirthDate = '';
	let newBabyGender = 'female';
	let creatingBaby = false;

	function openEditMember(baby: any) {
		editingMember = baby;
		fail('');
	}

	function closeEditMember() {
		editingMember = null;
	}

	async function deleteEditMember(e: CustomEvent<{ name: string }>) {
		if (!editingMember || !activeFamilyId) return;
		if (!confirm(`Delete "${e.detail.name}" and ALL of their records? This cannot be undone.`)) return;
		try {
			await familiesAPI.removeMember(activeFamilyId, Number(editingMember.id));
			notify('Member deleted.');
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to delete member.');
		}
	}

	async function saveEditMember(e: CustomEvent<Record<string, any>>) {
		if (!editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(editingMember.id), e.detail);
			notify('Member updated.');
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update member.');
		}
	}

	async function inviteMemberEmail(email: string) {
		if (!email || !activeFamilyId) return;
		try {
			await familiesAPI.invite(activeFamilyId, email);
			notify(`Invite sent to ${email}.`);
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to send invite.');
		}
	}

	async function onMemberAvatarSelected(e: CustomEvent<{ file: File }>) {
		const file = e.detail.file;
		if (!file || !editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.uploadAvatar(activeFamilyId, Number(editingMember.id), file);
			notify('Profile photo updated.');
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to upload photo.');
		}
	}


	let stopOutboxSync: (() => void) | undefined;

	function openLog(kind: string) {
		logKind = kind;
		sheetOpen = true;
	}

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

			{#if $overdueReminders.length > 0}
				<div class="bg-danger border border-danger text-danger-text rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3" data-testid="reminders-banner">
					<div>
						<p class="text-sm font-semibold">Reminders</p>
						<p class="text-xs">
							{#each $overdueReminders as o}
								{#if o.kind === 'inactivity'}
									{@const what = o.conditions?.length ? reminderPhrase(o.conditions, o.match) : reminderNoun(o.category)}
									<span class="capitalize">no {what} in {o.hours}h{o.since ? ` (since ${new Date(o.since).toLocaleString(undefined, zonedOptions())})` : ' (never recorded)'}</span>
								{:else}
									<span>{o.label || o.category} — every {o.intervalDays}d{o.since ? ` (last {new Date(o.since).toLocaleString(undefined, zonedOptions())})` : ' (never done)'}</span>
								{/if}{o !== $overdueReminders[$overdueReminders.length - 1] ? ' · ' : ''}
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
							<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft flex items-center justify-between" data-testid="member-card">
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

					<!-- What the whole family has booked, alongside the member grid:
					     family-level information belongs here, not on the dashboard. -->
					<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft mb-8" data-testid="upcoming-appointments-card">
						<div class="flex items-center justify-between mb-3">
							<h3 class="text-lg font-display font-semibold flex items-center gap-2">
								<CalendarClock class="w-5 h-5 text-accent" aria-hidden="true" />
								Upcoming
							</h3>
							<a href="/appointments" class="text-sm font-semibold text-link hover:underline">See all &rarr;</a>
						</div>
						{#if $upcomingAppointments.length === 0}
							<p class="text-sm text-ink-soft">
								Nothing booked in the next 30 days. Log any activity with a future date and it appears here.
							</p>
						{:else}
							<ul class="space-y-2">
								{#each $upcomingAppointments as a (a.id)}
									<li class="flex items-baseline gap-3 text-sm">
										<span class="tabular-nums text-ink-soft shrink-0 w-28">
											{new Date(a.date).toLocaleDateString(undefined, zonedOptions({ weekday: 'short', month: 'short', day: 'numeric' }))}
										</span>
										<span class="text-ink min-w-0">
											{#if a.memberName}<span class="font-semibold">{a.memberName}</span> · {/if}{a.title}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
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
						memberId={selectedMemberId}
						{summary}
						{activeCategories}
						quickLinks={selectedMember?.quickLinks ?? null}
						dashboardTiles={selectedMember?.dashboardTiles ?? null}
						stage={selectedMember?.stage ?? null}
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
					/>

					<!-- The selected person's own reports. WHO percentiles are child
					     reference data — and a "child" includes legacy members created
					     before stages existed, whose stage is null. Test the type, not
					     the stage. -->
					{#if selectedMember && selectedMember.type === 'child' && activeCategories.includes('growth')}
						<GrowthChart memberId={Number(selectedMember.id)} memberName={selectedMember.name} />
					{/if}
				</div>
			{:else}
				<button type="button" on:click={() => (familyView = 'dashboard')} class="mb-2 text-ink-soft hover:text-ink flex items-center gap-1 text-sm font-semibold">
					<span aria-hidden="true">‹</span> {activeFamily?.name || 'Family'} <span class="text-ink-soft" aria-hidden="true">/</span> <span class="text-ink">{profiles.find((b) => Number(b.id) === selectedMemberId)?.name || 'Baby'}</span>
				</button>

				<MemberActivity
					memberName={selectedMember?.name || 'Selected'}
					memberId={selectedMemberId}
					{summary}
					{activeCategories}
					quickLinks={selectedMember?.quickLinks ?? null}
					dashboardTiles={selectedMember?.dashboardTiles ?? null}
					stage={selectedMember?.stage ?? null}
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
				/>

				<!--
					Growth percentiles are WHO child reference data, so this only makes
					sense for a child who tracks growth — not an adult, and not a pet.
					Test the type: a legacy child created before stages exists has a null
					stage, and must still see the chart.
				-->
				{#if selectedMember && selectedMember.type === 'child' && activeCategories.includes('growth')}
					<GrowthChart memberId={Number(selectedMember.id)} memberName={selectedMember.name} />
				{/if}
			{/if}
		{/if}

		{#if editingMember}
			<EditMemberModal
				member={editingMember}
				mode="stage"
				familyId={activeFamilyId}
				on:save={saveEditMember}
				on:delete={deleteEditMember}
				on:invite={(e) => inviteMemberEmail(e.detail.email)}
				on:avatar={onMemberAvatarSelected}
				on:close={closeEditMember}
			/>
		{/if}


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
