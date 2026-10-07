<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Plus, ChevronDown } from 'lucide-svelte';
	import { CATEGORIES } from '$lib/shared';

	/**
	 * The selected member's enabled categories, in their own order.
	 *
	 * These are the member's, not the account's: switching from a child to an
	 * adult has to change what can be logged, because an adult has no feeds or
	 * nappies and an infant has no medication.
	 */
	export let categories: string[] = [];
	/**
	 * The tiles this member has pinned, or null to fall back to their first few
	 * categories. Pinned per member because the point is that they follow the
	 * person: selecting yourself should surface what *you* log, not what the baby
	 * does.
	 */
	export let quickLinks: string[] | null = null;

	const dispatch = createEventDispatcher<{ log: { kind: string }; pin: { kind: string }; unpin: { kind: string } }>();

	let allOpen = false;
	let otherOpen = false;

	type Cat = (typeof CATEGORIES)[number];
	const byId = (id: string): Cat | undefined => CATEGORIES.find((c) => c.id === id);

	/** Only what this member actually tracks, in the member's own order. */
	$: enabled = categories.map(byId).filter((c): c is Cat => !!c);

	/** Pinned tiles win; otherwise the template's leading categories stand in. */
	$: pinnedIds = quickLinks && quickLinks.length ? quickLinks : enabled.slice(0, 4).map((c) => c.id);
	$: quick = pinnedIds.map(byId).filter((c): c is Cat => !!c && enabled.some((e) => e.id === c.id));
	$: other = enabled.filter((c) => !pinnedIds.includes(c.id));

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
				{#each enabled as c}
					<button type="button" on:click={() => pick(c.id)} class="min-h-[4.5rem] px-2 py-3 rounded-lg bg-surface2 flex flex-col items-center justify-center gap-1.5 hover:bg-accent-soft active:scale-95 transition">
						<svelte:component this={c.icon} class="w-4 h-4 text-ink-soft" />
						<span class="text-xs font-semibold text-ink-soft text-center leading-tight">{c.label}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
		{#each quick as c}
			<div class="relative">
				<button type="button" on:click={() => pick(c.id)} class="w-full min-h-[5.5rem] px-2 py-3 bg-surface rounded-xl shadow-sm border border-line-soft flex flex-col items-center justify-center gap-1.5 hover:border-accent hover:bg-accent-soft/30 active:scale-95 transition">
					<svelte:component this={c.icon} class="w-5 h-5 text-accent" />
					<span class="text-xs font-semibold text-ink text-center leading-tight">{c.label}</span>
				</button>
				{#if quick.length > 1}
					<button
						type="button"
						on:click={() => dispatch('unpin', { kind: c.id })}
						aria-label={`Unpin ${c.label}`}
						title="Remove from Quick Actions"
						class="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface2 text-ink-soft hover:text-danger-text text-xs leading-none"
					>&minus;</button>
				{/if}
			</div>
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
				{#each other as c}
					<div class="relative">
						<button type="button" on:click={() => pick(c.id)} class="w-full min-h-[4.5rem] px-2 py-3 rounded-lg bg-surface2 flex flex-col items-center justify-center gap-1.5 hover:bg-accent-soft active:scale-95 transition">
							<svelte:component this={c.icon} class="w-4 h-4 text-ink-soft" />
							<span class="text-xs font-semibold text-ink-soft text-center leading-tight">{c.label}</span>
						</button>
						<button
							type="button"
							on:click={() => dispatch('pin', { kind: c.id })}
							aria-label={`Pin ${c.label} to Quick Actions`}
							title="Add to Quick Actions"
							class="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface text-ink-soft hover:text-accent text-xs leading-none"
						>&#43;</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
