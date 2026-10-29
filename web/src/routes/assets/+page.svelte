<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api/client';
	import { userAPI } from '$lib/api/family';
	import { assetsAPI } from '$lib/api/assets';
	import { authActions } from '$lib/stores/authStore';
	import type { Asset, AssetCategoryId } from '$lib/api/types';
	import AssetForm from '$lib/components/logging/AssetForm.svelte';

	// The home asset registry (HOME module 1, issue #65): the car, the
	// furnace, the house itself. Its own surface, like inventory — assets
	// answer "what do we own and what does it need", inventory answers "what
	// do we have and how much is left".

	let notice = '';
	let error = '';
	let loaded = false;
	let assets: Asset[] = [];
	let showArchived = false;
	let showForm = false;
	let editing: Asset | null = null;
	// Fallback so the category picker renders before the fetch lands; the API
	// is the source of truth once it does.
	let categories: { id: AssetCategoryId; label: string }[] = [
		{ id: 'vehicle', label: 'Vehicle' }, { id: 'appliance', label: 'Appliance' },
		{ id: 'hvac', label: 'Heating & cooling' }, { id: 'structure', label: 'Home & structure' },
		{ id: 'outdoor', label: 'Yard & outdoor' }, { id: 'other', label: 'Other' },
	];

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
			const res = await assetsAPI.list(showArchived);
			assets = res.data.assets ?? [];
		} catch (e: any) {
			if (e?.response?.status === 401) await goto('/login');
			else error = e?.response?.data?.error || 'Could not load your assets.';
		} finally {
			loaded = true;
		}
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
	});
</script>

<svelte:head><title>Home assets · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="mb-4">
		<h1 class="text-2xl font-display font-semibold text-ink">Home assets</h1>
		<p class="text-sm text-ink-soft mt-1">
			The things you own and keep: the car, the furnace, the house itself. Add an
			asset here; maintenance, schedules, and manuals hang off it.
		</p>
	</div>

	{#if notice}<p class="text-sm text-ink-soft mb-3" role="status">{notice}</p>{/if}
	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

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
			<AssetForm {editing} on:save={onSaved} on:cancel={() => { showForm = false; editing = null; }} />
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
							<div class="min-w-0">
								<p class="font-semibold text-ink truncate">{asset.name}{#if asset.archivedAt}<span class="ml-2 text-xs font-normal text-ink-soft">archived</span>{/if}</p>
								<p class="text-sm text-ink-soft">{identityLine(asset)}</p>
								{#if asset.purchasePrice !== null}
									<p class="text-xs text-ink-soft mt-1">Bought {formatPrice(asset.purchasePrice)}{#if asset.acquiredAt}&nbsp;on {asset.acquiredAt}{/if}</p>
								{:else if asset.acquiredAt}
									<p class="text-xs text-ink-soft mt-1">Since {asset.acquiredAt}</p>
								{/if}
								{#if asset.notes}<p class="text-xs text-ink-soft mt-1 whitespace-pre-wrap">{asset.notes}</p>{/if}
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