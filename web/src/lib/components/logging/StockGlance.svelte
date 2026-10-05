<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { inventoryAPI, type InventoryAlert, type InventoryItem } from '$lib/api';
	import { formatMinutes } from '$lib/logging/format';

	/**
	 * Read-only glance at stock. Deliberately not the management UI: this answers
	 * "is anything running out" on the dashboard without turning it into a
	 * configurator. Editing lives in /inventory.
	 */
	export let limit = 4;

	let items: InventoryItem[] = [];
	let alerts: InventoryAlert[] = [];
	let loaded = false;

	$: atRisk = items
		.filter((i) => i.daysOfCover !== null)
		.sort((a, b) => (a.daysOfCover ?? 1e9) - (b.daysOfCover ?? 1e9));
	$: unknown = items.filter((i) => i.daysOfCover === null && i.quantity > 0);

	async function load() {
		try {
			const res = await inventoryAPI.list();
			items = res.data.items ?? [];
			alerts = res.data.alerts ?? [];
		} catch {
			items = [];
			alerts = [];
		} finally {
			loaded = true;
		}
	}

	onMount(load);
</script>

<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft" data-testid="stock-glance">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-lg font-display font-semibold">Stock</h3>
		<div class="flex items-center gap-3">
			<a href="/notifications" class="text-sm font-semibold text-link hover:underline">Notifications &rarr;</a>
			<button type="button" on:click={() => goto('/inventory')} class="text-sm font-semibold text-link hover:underline">
				Manage inventory &rarr;
			</button>
		</div>
	</div>

	{#if !loaded}
		<p class="text-sm text-ink-soft">Checking stock…</p>
	{:else if items.length === 0}
		<p class="text-sm text-ink-soft">Nothing tracked yet. Add stock from the inventory page.</p>
	{:else if alerts.length === 0 && atRisk.length === 0}
		<p class="text-sm text-ink-soft">Nothing is running low.</p>
	{:else}
		<div class="grid grid-cols-2 md:grid-cols-3 gap-2">
			{#each alerts.slice(0, limit) as alert (alert.ruleId + '-' + alert.itemId)}
				<button
					type="button"
					on:click={() => goto('/inventory')}
					class="text-left rounded-lg border border-line-soft bg-surface2 p-3 hover:border-accent transition-colors"
					data-testid="alert-card"
				>
					<p class="text-xs font-semibold text-ink truncate">{alert.itemName}</p>
					<p class="text-lg font-display font-semibold text-danger-text leading-tight mt-0.5">
						{Math.round(alert.value * 10) / 10}{alert.unit === 'days' ? 'd' : ''}
					</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">
						{alert.signalLabel} {alert.comparator === 'lte' || alert.comparator === 'lt' ? 'at or under' : 'at or over'} {alert.threshold}
					</p>
				</button>
			{/each}
			{#if alerts.length === 0}
				{#each atRisk.slice(0, limit) as item (item.id)}
					<button
						type="button"
						on:click={() => goto('/inventory')}
						class="text-left rounded-lg border border-line-soft bg-surface2 p-3 hover:border-accent transition-colors"
						data-testid="alert-card"
					>
						<p class="text-xs font-semibold text-ink truncate">{item.name}{item.variant ? ` · ${item.variant}` : ''}</p>
						<p class="text-lg font-display font-semibold text-ink leading-tight mt-0.5">
							{Math.round((item.daysOfCover ?? 0) * 10) / 10}d
						</p>
						<p class="text-[11px] text-ink-soft leading-tight mt-0.5">
							{item.quantity} {item.unit} left
						</p>
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if unknown.length > 0 && alerts.length > 0}
		<p class="text-xs text-ink-soft mt-2">
			{unknown.length} item{unknown.length === 1 ? '' : 's'} have stock but no recorded use yet, so they have no forecast.
		</p>
	{/if}
</div>
