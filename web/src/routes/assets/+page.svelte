<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { tokenExpired, currentFamilyId } from '$lib/api/client';
	import { userAPI, familiesAPI } from '$lib/api/family';
	import { assetsAPI } from '$lib/api/assets';
	import { authActions } from '$lib/stores/authStore';
	import type { Asset, AssetCategoryId } from '$lib/api/types';
	import AssetForm from '$lib/components/logging/AssetForm.svelte';
	import AssetPicture from '$lib/components/AssetPicture.svelte';

	// The home asset registry (HOME module 1, issue #65): the car, the
	// furnace, the house itself. Its own surface, like inventory — assets
	// answer "what do we own and what does it need", inventory answers "what
	// do we have and how much is left". Assets may name a home they live at
	// (issue #74) — null is family-wide, the default.

	let notice = '';
	let error = '';
	let loaded = false;
	let assets: Asset[] = [];
	let homes: { id: number; name: string }[] = [];
	let showArchived = false;
	let showForm = false;
	let editing: Asset | null = null;
	// A `?homeId=` deep link (the Homes card on /home) scopes the list to one
	// residence; null = the whole registry.
	let filterHomeId: number | null = null;
	// How many schedules are overdue/due per asset, for the card badge. One
	// cross-asset call, not one per asset.
	let dueCounts: Record<number, number> = {};
	// Fallback so the category picker renders before the fetch lands; the API
	// is the source of truth once it does.
	let categories: { id: AssetCategoryId; label: string }[] = [
		{ id: 'vehicle', label: 'Vehicle' }, { id: 'appliance', label: 'Appliance' },
		{ id: 'hvac', label: 'Heating & cooling' }, { id: 'structure', label: 'Structures & improvements' },
		{ id: 'outdoor', label: 'Yard & outdoor' }, { id: 'other', label: 'Other' },
	];

	$: homeName = (id: number | null) => (id === null ? '' : homes.find((h) => h.id === id)?.name ?? '');

	function identityLine(asset: Asset): string {
		const i = asset.identity;
		const parts = [i.manufacturer, i.model].filter(Boolean);
		if (i.modelYear) parts.push(String(i.modelYear));
		if (!parts.length && i.serial) return `Serial ${i.serial}`;
		return parts.join(' ');
	}

	function formatPrice(cents: number | null): string {
		if (cents === null || cents === undefined) return '';
		return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
	}

	async function load() {
		try {
			const token = localStorage.getItem('token');
			if (!token || tokenExpired()) {
				await goto('/login');
				return;
			}
			const [res, due] = await Promise.all([
				assetsAPI.list(showArchived, filterHomeId),
				assetsAPI.due(),
			]);
			assets = res.data.assets ?? [];
			dueCounts = {};
			for (const item of due.data.items ?? []) {
				dueCounts[item.assetId] = (dueCounts[item.assetId] ?? 0) + 1;
			}
		} catch (e: any) {
			if (e?.response?.status === 401) await goto('/login');
			else error = e?.response?.data?.error || 'Could not load your assets.';
		} finally {
			loaded = true;
		}
	}

	/** Drop the home filter and show the whole registry. */
	async function clearHomeFilter() {
		filterHomeId = null;
		loaded = false;
		await load();
	}

	async function archive(asset: Asset) {
		error = '';
		try {
			await assetsAPI.archive(asset.id);
			notice = `${asset.name} archived — its history stays.`;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not archive.';
		}
	}

	async function unarchive(asset: Asset) {
		error = '';
		try {
			await assetsAPI.unarchive(asset.id);
			notice = `${asset.name} is back.`;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not unarchive.';
		}
	}

	function onSaved() {
		showForm = false;
		editing = null;
		notice = '';
		load();
	}

	// The select's value is a plain string; the API validates against the enum.
	function onCategoryPicked(asset: Asset, category: string) {
		if (category === asset.category) return;
		assetsAPI.update(asset.id, { category: category as AssetCategoryId }).then(load).catch(() => {
			error = 'Could not change category.';
		});
	}

	// Toggle reloads the list with archived included or hidden.
	async function toggleArchived() {
		showArchived = !showArchived;
		await load();
	}

	onMount(() => {
		// The Homes card deep link (?homeId=) scopes this list to one residence.
		const param = new URLSearchParams(window.location.search).get('homeId');
		if (param && Number.isFinite(Number(param))) filterHomeId = Number(param);
		load();
		// The same rehydrate every authenticated page runs: the account menu
		// reads $authStore.user, which a full navigation resets (only the
		// token survives), so the avatar would fall back to 'U' without it.
		userAPI.getMe().then((res) => {
			const u = (res.data as any).user;
			if (u) {
				authActions.setUser({
					id: Number(u.id),
					email: u.email,
					firstName: u.first_name ?? u.firstName ?? '',
					lastName: u.last_name ?? u.lastName ?? '',
					createdAt: u.created_at ?? u.createdAt ?? '',
				});
			}
		}).catch(() => {});
		assetsAPI.categories().then((r) => { categories = r.data.categories; }).catch(() => {});
		const familyId = currentFamilyId();
		if (familyId) {
			familiesAPI.homes(familyId).then((r) => { homes = r.data.homes ?? []; }).catch(() => {});
		}
	});
</script>

<svelte:head><title>Home assets · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="mb-4">
		<h1 class="text-2xl font-display font-semibold text-ink">Home assets</h1>
		<p class="text-sm text-ink-soft mt-1">
			The things you own and keep: the car, the furnace, the shed. Add an
			asset here; maintenance, schedules, and manuals hang off it. The home
			itself is on the <a href="/home" class="underline">Homes card</a>.
		</p>
	</div>

	{#if notice}<p class="text-sm text-ink-soft mb-3" role="status">{notice}</p>{/if}
	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

	{#if filterHomeId !== null}
		<div class="mb-3 text-sm text-ink-soft">
			Showing assets at <span class="font-semibold text-ink">{homeName(filterHomeId) || 'one home'}</span>
			<button type="button" class="ml-2 underline text-accent" on:click={clearHomeFilter}>Show all</button>
		</div>
	{/if}

	{#if loaded}
		<div class="flex items-center justify-between mb-4 gap-2">
			<button type="button" class="bg-primary text-on-primary font-semibold text-sm rounded-md px-4 py-2" on:click={() => { showForm = true; editing = null; }}>
				+ Add asset
			</button>
			<label class="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
				<input type="checkbox" class="accent-primary" checked={showArchived} on:change={toggleArchived} />
				Show archived
			</label>
		</div>

		{#if showForm}
			<AssetForm {editing} {homes} on:save={onSaved} on:cancel={() => { showForm = false; editing = null; }} />
		{/if}

		{#if assets.length === 0}
			<div class="bg-surface border border-line-soft rounded-xl p-6 text-center">
				<p class="text-ink font-semibold">No assets yet</p>
				<p class="text-sm text-ink-soft mt-1">Start with the car, or the furnace, or the house itself.</p>
			</div>
		{:else}
			<ul class="grid gap-3">
				{#each assets as asset (asset.id)}
					<li class="bg-surface border border-line-soft rounded-xl shadow-sm p-4" data-testid={`asset-${asset.id}`}>
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-start gap-3 min-w-0">
								{#if asset.picture}
									<AssetPicture assetId={asset.id} picture={asset.picture} alt={asset.name} size="w-12 h-12 shrink-0" />
								{/if}
							<div class="min-w-0">
								<p class="font-semibold text-ink truncate">
									<a href={`/assets/${asset.id}`} class="hover:underline">{asset.name}</a>
									{#if asset.archivedAt}<span class="ml-2 text-xs font-normal text-ink-soft">archived</span>{/if}
									{#if dueCounts[asset.id]}
										<span class="ml-2 text-xs font-semibold border border-accent text-accent rounded-full px-2 py-0.5">{dueCounts[asset.id]} due</span>
									{/if}
								</p>
								<p class="text-sm text-ink-soft">{identityLine(asset)}</p>
								{#if asset.homeId !== null && homeName(asset.homeId)}
									<p class="text-xs text-ink-soft mt-0.5">Lives at {homeName(asset.homeId)}</p>
								{/if}
								{#if asset.purchasePrice !== null}
									<p class="text-xs text-ink-soft mt-1">Bought {formatPrice(asset.purchasePrice)}{#if asset.acquiredAt}&nbsp;on {asset.acquiredAt}{/if}</p>
								{:else if asset.acquiredAt}
									<p class="text-xs text-ink-soft mt-1">Since {asset.acquiredAt}</p>
								{/if}
								{#if asset.notes}<p class="text-xs text-ink-soft mt-1 whitespace-pre-wrap">{asset.notes}</p>{/if}
							</div>
							</div>
							<select
								class="w-32 px-3 py-1.5 border border-line rounded-md text-sm text-ink bg-surface"
								aria-label={`Category for ${asset.name}`}
								value={asset.category}
								on:change={(e) => onCategoryPicked(asset, e.currentTarget.value)}
							>
								{#each categories as c (c.id)}
									<option value={c.id}>{c.label}</option>
								{/each}
							</select>
						</div>
						<div class="flex gap-2 mt-3 text-sm">
							<a href={`/assets/${asset.id}`} class="underline text-accent">Care &amp; history</a>
							<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => { showForm = true; editing = asset; }}>Edit</button>
							{#if asset.archivedAt}
								<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => unarchive(asset)}>Unarchive</button>
							{:else}
								<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => archive(asset)}>Archive</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>