<script lang="ts">
	import { ArrowLeft, ArrowRight } from 'lucide-svelte';
	import { oppositeSide } from '$lib/breast';
	import type { Side } from '$lib/logging/timers';

	export let side: 'left' | 'right' | 'both' = 'left';
	export let endsOn: Side = 'right';
	export let leftMin = '';
	export let rightMin = '';
	export let lastSide: Side | null = null;
	export let label = 'Breast';

	const SIDES: ('left' | 'right' | 'both')[] = ['left', 'right', 'both'];
	$: usesLeft = side === 'left' || side === 'both';
	$: usesRight = side === 'right' || side === 'both';
</script>

<div>
	<div class="flex items-center justify-between mb-1">
		<div class="block text-sm font-medium text-ink-soft">{label}</div>
		{#if lastSide}
			<span class="text-xs text-ink-soft">
				last: {#if lastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}
				· try {oppositeSide(lastSide)} next
			</span>
		{/if}
	</div>
	<div class="grid grid-cols-3 gap-2">
		{#each SIDES as s}
			<button type="button" on:click={() => (side = s)} class="{side === s ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line'} border rounded-md px-3 py-2 text-sm font-semibold capitalize">{s}</button>
		{/each}
	</div>
</div>
<div class="grid grid-cols-2 gap-3">
	{#if usesLeft}
		<div>
			<label for="left-min" class="block text-sm font-medium text-ink-soft mb-1">Left (minutes)</label>
			<input id="left-min" type="number" min="0" step="1" bind:value={leftMin} class="w-full px-3 py-2 border border-line rounded-md" placeholder="optional" />
		</div>
	{/if}
	{#if usesRight}
		<div>
			<label for="right-min" class="block text-sm font-medium text-ink-soft mb-1">Right (minutes)</label>
			<input id="right-min" type="number" min="0" step="1" bind:value={rightMin} class="w-full px-3 py-2 border border-line rounded-md" placeholder="optional" />
		</div>
	{/if}
</div>
{#if side === 'both'}
	<div>
		<div class="block text-sm font-medium text-ink-soft mb-1">Finished on</div>
		<div class="grid grid-cols-2 gap-2">
			{#each ['left', 'right'] as s}
				<button type="button" on:click={() => (endsOn = s === 'left' ? 'left' : 'right')} class="{endsOn === s ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line'} border rounded-md px-3 py-2 text-sm font-semibold capitalize">{s}</button>
			{/each}
		</div>
	</div>
{/if}
