<script lang="ts">
	import type { InventoryAlert, InventoryItem } from '$lib/api/types';

	/**
	 * The shape of what you hold, before any detail. Each figure answers a
	 * question you would otherwise have to hunt for: is anything low, expiring,
	 * wrong, or still too new to say anything about?
	 *
	 * Tapping any tile filters the items list below to show the exact items
	 * contributing to that number.
	 */
	export let items: InventoryItem[] = [];
	export let alerts: InventoryAlert[] = [];
	export let activeFilter = 'all';

	/** Window for the "expiring soon" figure. A stat, not an alert, so fixed. */
	const EXPIRY_WINDOW_DAYS = 30;

	$: categories = new Set(items.map((i) => i.category)).size;
	$: expiringSoon = items.filter((i) => i.daysToExpiry !== null && i.daysToExpiry <= EXPIRY_WINDOW_DAYS);
	$: drifted = items.filter((i) => i.drift !== null && i.drift !== 0);
	$: noForecast = items.filter((i) => i.quantity > 0 && i.daysOfCover === null);
	$: onCadence = items.filter((i) => i.consumeIntervalDays !== null);
	$: linked = items.filter((i) => i.eventCategory !== null);

	$: tiles = [
		{ id: 'all', label: 'Items tracked', value: items.length, tone: 'plain' as const, hint: `${categories} ${categories === 1 ? 'category' : 'categories'}` },
		{ id: 'alerts', label: 'Needs attention', value: alerts.length, tone: alerts.length ? 'bad' as const : 'plain' as const, hint: alerts.length ? 'rules are matching' : 'nothing firing' },
		{ id: 'expiring', label: 'Expiring soon', value: expiringSoon.length, tone: expiringSoon.length ? 'warn' as const : 'plain' as const, hint: `within ${EXPIRY_WINDOW_DAYS} days` },
		{ id: 'drift', label: 'Counts disagree', value: drifted.length, tone: drifted.length ? 'warn' as const : 'plain' as const, hint: drifted.length ? 'worth recounting' : 'tracking matches ledger' },
		{ id: 'no-forecast', label: 'No forecast yet', value: noForecast.length, tone: 'plain' as const, hint: 'stock, but no usage' },
		{ id: 'auto', label: 'Auto-decrementing', value: onCadence.length + linked.length, tone: 'plain' as const, hint: `${onCadence.length} on cadence, ${linked.length} from logs` },
	];

	function selectTile(id: string) {
		activeFilter = activeFilter === id ? 'all' : id;
	}
</script>

<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4" data-testid="inventory-stats">
	{#each tiles as tile (tile.id)}
		{@const isActive = activeFilter === tile.id}
		{@const isBad = tile.tone === 'bad'}
		<button
			type="button"
			on:click={() => selectTile(tile.id)}
			aria-pressed={isActive}
			class="rounded-lg border text-left p-3 transition-all flex flex-col justify-between min-h-[76px] cursor-pointer
				{isActive
					? (isBad ? 'border-danger ring-2 ring-danger/30 bg-danger/10 shadow-sm' : 'border-accent ring-2 ring-accent/30 bg-accent-soft/30 shadow-sm')
					: (isBad && tile.value > 0 ? 'border-danger-line bg-danger/5 hover:border-danger' : tile.tone === 'warn' && tile.value > 0 ? 'border-line-soft bg-surface2 hover:border-accent' : 'border-line-soft bg-surface hover:border-line')}"
		>
			<p class="text-xs text-ink-soft leading-tight flex items-center justify-between">
				<span>{tile.label}</span>
				{#if isActive}
					<span class="text-[9px] font-bold uppercase tracking-wider text-accent">Active</span>
				{/if}
			</p>
			<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5 tabular-nums
				{isBad && tile.value > 0 ? 'text-danger-text' : ''}">{tile.value}</p>
			<p class="text-[11px] text-ink-soft leading-tight mt-0.5 truncate">{tile.hint}</p>
		</button>
	{/each}
</div>
