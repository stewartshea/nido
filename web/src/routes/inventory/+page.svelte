<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api/client';
	import { familiesAPI } from '$lib/api/family';
	import { inventoryAPI } from '$lib/api/inventory';
	import type { InventoryAlert, InventoryItem } from '$lib/api/types';
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
	let activeFilter = 'all';

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
			const membersRes = await familiesAPI.members(familyId);
			members = (membersRes.data.members ?? []).map((m: any) => ({ id: Number(m.id), name: m.name, trackable: m.trackable !== false }));
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

<div class="max-w-4xl mx-auto px-4 py-4 md:py-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3 mb-4">
		<div>
			<h1 class="text-2xl font-display font-semibold text-ink">Inventory</h1>
			<p class="text-sm text-ink-soft mt-1">
				What you have on hand, what it is used up by, and when you will run out.
			</p>
		</div>
		<div class="flex items-center gap-3">
			<a href="/reports" class="text-sm font-semibold text-accent hover:underline">Usage reports &rarr;</a>
			<a href="/notifications" class="text-sm font-semibold text-accent hover:underline">Notification rules &rarr;</a>
		</div>
	</div>

	{#if notice}<p class="text-sm text-ink-soft mb-3" role="status">{notice}</p>{/if}
	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

	{#if loaded}
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

		<InventoryStats {items} {alerts} bind:activeFilter />

		<InventoryPanel {members} bind:activeFilter on:refresh={() => { notice = ''; loadAlerts(); }} />
	{/if}
</div>
