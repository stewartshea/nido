<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Plus, ChevronDown } from 'lucide-svelte';
	import { CATEGORIES } from '$lib/shared';

	/** Category ids pinned as quick tiles; everything else sits under "Other". */
	export let quickLinks: string[] = [];

	const dispatch = createEventDispatcher<{ log: { kind: string } }>();

	let allOpen = false;
	let otherOpen = false;

	$: quick = CATEGORIES.filter((c) => quickLinks.includes(c.id));
	$: other = CATEGORIES.filter((c) => !quickLinks.includes(c.id));

	function pick(kind: string) {
		allOpen = false;
		otherOpen = false;
		dispatch('log', { kind });
	}
</script>

<div class="mb-6">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-lg font-display font-semibold">Quick Actions</h3>
		<button type="button" on:click={() => (allOpen = !allOpen)} aria-expanded={allOpen} class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-primary text-on-primary text-sm font-semibold hover:opacity-90">
			<Plus class="w-4 h-4" aria-hidden="true" /> Log activity
		</button>
	</div>
	{#if allOpen}
		<div class="mb-2.5 bg-surface rounded-xl shadow-card border border-line-soft p-3">
			<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
				{#each CATEGORIES as cat}
					<button type="button" on:click={() => pick(cat.id)} class="min-h-[4.5rem] px-2 py-3 rounded-lg bg-surface2 flex flex-col items-center justify-center gap-1.5 hover:bg-accent-soft active:scale-95 transition">
						<svelte:component this={cat.icon} class="w-4 h-4 text-ink-soft" />
						<span class="text-xs font-semibold text-ink-soft text-center leading-tight">{cat.label}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
		{#each quick as cat}
			<button type="button" on:click={() => pick(cat.id)} class="min-h-[5.5rem] px-2 py-3 bg-surface rounded-xl shadow-sm border border-line-soft flex flex-col items-center justify-center gap-1.5 hover:border-accent hover:bg-accent-soft/30 active:scale-95 transition">
				<svelte:component this={cat.icon} class="w-5 h-5 text-accent" />
				<span class="text-xs font-semibold text-ink text-center leading-tight">{cat.label}</span>
			</button>
		{/each}
		<button type="button" on:click={() => (otherOpen = !otherOpen)} aria-expanded={otherOpen} class="min-h-[5.5rem] px-2 py-3 bg-surface rounded-xl shadow-sm border border-dashed border-line-soft flex flex-col items-center justify-center gap-1.5 hover:border-accent active:scale-95 transition">
			{#if otherOpen}
				<ChevronDown class="w-5 h-5 text-accent" />
			{:else}
				<Plus class="w-5 h-5 text-accent" />
			{/if}
			<span class="text-xs font-semibold text-ink text-center leading-tight">Other</span>
		</button>
	</div>
	{#if otherOpen}
		<div class="mt-2.5 bg-surface rounded-xl shadow-card border border-line-soft p-3">
			<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
				{#each other as cat}
					<button type="button" on:click={() => pick(cat.id)} class="min-h-[4.5rem] px-2 py-3 rounded-lg bg-surface2 flex flex-col items-center justify-center gap-1.5 hover:bg-accent-soft active:scale-95 transition">
						<svelte:component this={cat.icon} class="w-4 h-4 text-ink-soft" />
						<span class="text-xs font-semibold text-ink-soft text-center leading-tight">{cat.label}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
