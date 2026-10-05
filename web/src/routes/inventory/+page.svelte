<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { familiesAPI, inventoryAPI, tokenExpired, type InventoryAlert, type InventoryItem } from '$lib/api';
	import InventoryStats from '$lib/components/logging/InventoryStats.svelte';
		import InventoryPanel from '$lib/components/logging/InventoryPanel.svelte';

	// Inventory is its own surface: the dashboard shows a glance and Settings
	// holds the configuration, so the editing UI needs somewhere to live that is
	// neither of those.

	let notice = '';
	let error = '';
	let members: { id: number; name: string; trackable?: boolean }[] = [];
	let loaded = false;
	// Alerts belong here as much as on the dashboard: this is the page where you
	// would come to act on one, so it should not be somewhere else entirely.
	let alerts: InventoryAlert[] = [];
	let items: InventoryItem[] = [];

	async function loadAlerts() {
		try {
			const res = await inventoryAPI.list();
			alerts = res.data.alerts ?? [];
			items = res.data.items ?? [];
		} catch {
			alerts = [];
			items = [];
		}
	}

	async function load() {
		try {
			const token = localStorage.getItem('token');
			if (!token || tokenExpired()) {
				await goto('/login');
				return;
			}
			const res = await familiesAPI.list();
			const families = res.data.families ?? [];
			const familyId = localStorage.getItem('nido.defaultFamily') ?? families[0]?.familyId;
			if (!familyId) { loaded = true; return; }
			const babies = await familiesAPI.members(familyId);
			members = (babies.data.babies ?? babies.data.members ?? []).map((b: any) => ({ id: Number(b.id), name: b.name, trackable: b.trackable !== false }));
			await loadAlerts();
		} catch (e: any) {
			if (e?.response?.status === 401) await goto('/login');
			else error = e?.response?.data?.error || 'Could not load your family.';
		} finally {
			loaded = true;
		}
	}

	onMount(load);
</script>

<svelte:head><title>Inventory · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="mb-4">
		<h1 class="text-2xl font-display font-semibold text-ink">Inventory</h1>
		<p class="text-sm text-ink-soft mt-1">
			What you have on hand, what it is used up by, and when you will run out.
			This is the whole family's stock, not one person's. Rules for when to be told
			live on the <a href="/notifications" class="underline">notifications page</a>.
		</p>
	</div>

	{#if notice}<p class="text-sm text-ink-soft mb-3" role="status">{notice}</p>{/if}
	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

	{#if loaded}
		<InventoryStats {items} {alerts} />

		{#if alerts.length > 0}
			<div class="bg-surface border border-line-soft rounded-lg px-4 py-3 mb-4" role="status" data-testid="page-alerts">
				<p class="text-sm font-semibold text-ink mb-1">Needs attention</p>
				<ul class="text-xs text-ink-soft">
					{#each alerts as alert (alert.ruleId + '-' + alert.itemId)}
						<li>{alert.itemName} — {alert.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<InventoryPanel {members} on:refresh={() => { notice = ''; loadAlerts(); }} />
	{/if}
</div>
