<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { tokenExpired, currentFamilyId } from '$lib/api/client';
	import { userAPI, familiesAPI } from '$lib/api/family';
	import { importsAPI } from '$lib/api/system';
	import { assetsAPI } from '$lib/api/assets';
	import type { DueItem } from '$lib/api/types';
	import HouseholdNav from '$lib/components/HouseholdNav.svelte';
	import HomeForm from '$lib/components/logging/HomeForm.svelte';
	import HomePicture from '$lib/components/HomePicture.svelte';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { familyStore, familyActions } from '$lib/stores/family';
	import { loadFamilySettings } from '$lib/stores/familySettings';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { Home } from 'lucide-svelte';

	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update((s) => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	$: families = $familyStore.families;
	$: activeFamily = $familyStore.activeFamily;
	$: activeFamilyId = $familyStore.activeFamilyId;
	$: profiles = $familyStore.profiles;

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

	// "What's due" (HOME module 3, issue #67): one list across every asset,
	// overdue first. It is the same evaluation the asset page shows — one API,
	// so the dashboard and the detail page cannot disagree.
	let dueItems: DueItem[] = [];

	async function loadHomesAndAssets() {
		const familyId = currentFamilyId();
		if (!familyId) return;
		try {
			const [homesRes, assetsRes, dueRes] = await Promise.all([
				familiesAPI.homes(familyId),
				assetsAPI.list(),
				assetsAPI.due(),
			]);
			residences = homesRes.data.homes ?? [];
			homeAssets = (assetsRes.data.assets ?? []).filter((a: any) => a.archivedAt === null);
			dueItems = dueRes.data.items ?? [];
		} catch {
			residences = [];
			homeAssets = [];
			dueItems = [];
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
			await familiesAPI.uploadHomePicture(familyId, homeId, file);
			await loadHomesAndAssets();
		} catch (e: any) {
			homeError = e?.response?.data?.error || 'Could not upload that picture.';
		}
	}

	async function loadFamilies() {
		const loaded = await familyActions.loadFamilies();
		if (!loaded) return;
		await Promise.all([
			loadFamilySettings({ applyTimezone: true }),
			familyActions.refreshSummary(),
		]);
	}

	function handleLogout() {
		familyActions.handleLogout();
		isAuthenticated = false;
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
			// getMe failing is not worth a toast
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
			if (!isAuthenticated) familyActions.reset();
			if (isAuthenticated) {
				await Promise.all([loadFamilies(), refreshUserProfile(), loadHomesAndAssets()]);
			}
		}
	});
</script>

<svelte:head><title>Household · Nido</title></svelte:head>

<FeedbackToasts />

<div class="max-w-4xl mx-auto px-4 py-4 md:py-6">
	<HouseholdNav current="home" />

	{#if profiles.length > 0}
		{@const fid = currentFamilyId()}

		<!-- What's due card: elevated above residences when items are overdue/due -->
		{#if dueItems.length > 0}
			<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 mb-6" data-testid="due-card">
				<div class="flex items-baseline justify-between mb-3">
					<h3 class="text-xl font-display font-semibold">What's due</h3>
					<a href="/assets" class="text-sm font-semibold text-accent hover:underline">All assets &rarr;</a>
				</div>
				<ul class="grid gap-2">
					{#each dueItems.slice(0, 6) as item (item.scheduleId)}
						<li class="flex items-start justify-between gap-3 border border-line-soft rounded-md p-3" data-testid={`due-${item.scheduleId}`}>
							<div class="min-w-0">
								<p class="text-sm font-semibold text-ink">{item.task}</p>
								<p class="text-xs text-ink-soft">{item.assetName} · {item.detail}</p>
							</div>
							<a href={`/assets/${item.assetId}`} class="text-xs font-semibold shrink-0 {item.state === 'overdue' ? 'text-danger-text' : 'text-accent'}">
								{item.state === 'overdue' ? 'Overdue' : 'Due'} &rarr;
							</a>
						</li>
					{/each}
				</ul>
				{#if dueItems.length > 6}
					<p class="text-xs text-ink-soft mt-2">and {dueItems.length - 6} more</p>
				{/if}
			</div>
		{/if}

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

		<!-- When there are no due items, render the empty/calm state below the homes card -->
		{#if dueItems.length === 0}
			<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 mb-6" data-testid="due-card">
				<div class="flex items-baseline justify-between mb-3">
					<h3 class="text-xl font-display font-semibold">What's due</h3>
					<a href="/assets" class="text-sm font-semibold text-accent hover:underline">All assets &rarr;</a>
				</div>
				<p class="text-sm text-ink-soft">Nothing overdue or coming up. Give an asset a schedule and Nido will remind you.</p>
			</div>
		{/if}
	{/if}
</div>
