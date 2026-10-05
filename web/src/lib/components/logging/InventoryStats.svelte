<script lang="ts">
	import type { InventoryAlert, InventoryItem } from '$lib/api';

	/**
	 * The shape of what you hold, before any detail. Each figure answers a
	 * question you would otherwise have to hunt for: is anything low, expiring,
	 * wrong, or still too new to say anything about?
	 */
	export let items: InventoryItem[] = [];
	export let alerts: InventoryAlert[] = [];

	/** Window for the "expiring soon" figure. A stat, not an alert, so fixed. */
	const EXPIRY_WINDOW_DAYS = 30;

	$: categories = new Set(items.map((i) => i.category)).size;
	$: expiringSoon = items.filter((i) => i.daysToExpiry !== null && i.daysToExpiry <= EXPIRY_WINDOW_DAYS);
	$: drifted = items.filter((i) => i.drift !== null && i.drift !== 0);
	$: noForecast = items.filter((i) => i.quantity > 0 && i.daysOfCover === null);
	$: onCadence = items.filter((i) => i.consumeIntervalDays !== null);
	$: linked = items.filter((i) => i.eventCategory !== null);

	const tiles = () => [
		{ label: 'Items tracked', value: items.length, tone: 'plain' as const, hint: `${categories} ${categories === 1 ? 'category' : 'categories'}` },
		{ label: 'Needs attention', value: alerts.length, tone: alerts.length ? 'bad' as const : 'plain' as const, hint: alerts.length ? 'rules are matching' : 'nothing firing' },
		{ label: 'Expiring soon', value: expiringSoon.length, tone: expiringSoon.length ? 'warn' as const : 'plain' as const, hint: `within ${EXPIRY_WINDOW_DAYS} days` },
		{ label: 'Counts disagree', value: drifted.length, tone: drifted.length ? 'warn' as const : 'plain' as const, hint: drifted.length ? 'worth recounting' : 'tracking matches ledger' },
		{ label: 'No forecast yet', value: noForecast.length, tone: 'plain' as const, hint: 'stock, but no usage' },
		{ label: 'Auto-decrementing', value: onCadence.length + linked.length, tone: 'plain' as const, hint: `${onCadence.length} on a cadence, ${linked.length} from logs` },
	];
</script>

<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4" data-testid="inventory-stats">
	{#each tiles() as tile (tile.label)}
		<div
			class="rounded-lg border bg-surface px-3 py-2.5
				{tile.tone === 'bad' ? 'border-danger bg-danger/5' : tile.tone === 'warn' ? 'border-line-soft bg-surface2' : 'border-line-soft bg-surface'}"
		>
			<p class="text-xs text-ink-soft leading-tight">{tile.label}</p>
			<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{tile.value}</p>
			<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{tile.hint}</p>
		</div>
	{/each}
</div>
