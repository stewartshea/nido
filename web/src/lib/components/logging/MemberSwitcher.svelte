<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { ChevronDown, Star } from 'lucide-svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	/**
	 * The compact people switcher.
	 *
	 * A card per family member takes a lot of room to say very little: most
	 * families record against one person almost all the time and drop into
	 * another occasionally. So the primary person is starred, shown inline, and
	 * everyone else is one dropdown away. Selecting a different person changes
	 * what the page is about — including which Quick Actions are offered, since
	 * those come from the selected member's own categories.
	 */
	export let members: { id: number; name: string; avatar?: string | null; stage?: string | null }[] = [];
	export let selectedId: number | null = null;
	/** The default person, and the one the page opens on. */
	export let starredId: number | null = null;
	export let familyId: string | null = null;

	const dispatch = createEventDispatcher<{ select: { memberId: number; name: string }; star: { memberId: number } }>();

	let open = false;

	$: selected = members.find((m) => m.id === selectedId) ?? members[0] ?? null;
	$: starred = members.find((m) => m.id === starredId) ?? null;

	function choose(id: number, name: string) {
		open = false;
		dispatch('select', { memberId: id, name });
	}
</script>

<div class="relative inline-block">
	<div class="inline-flex items-center gap-2 bg-surface rounded-full shadow-card border border-line-soft pl-1.5 pr-1.5 py-1.5">
		{#if selected}
			<Avatar {familyId} memberId={selected.id} avatar={selected.avatar} alt={selected.name} class="w-8 h-8 rounded-full object-cover">
				{selected.name[0]}
			</Avatar>
			<span class="font-display font-semibold text-ink">{selected.name}</span>
			{#if selected.stage}<span class="text-xs text-ink-soft">{selected.stage}</span>{/if}
			<button
				type="button"
				on:click={() => dispatch('star', { memberId: selected.id })}
				aria-label={selected.id === starredId ? `${selected.name} is the default` : `Make ${selected.name} the default`}
				title={selected.id === starredId ? 'Default person' : 'Make this the default person'}
				class="p-1.5 rounded-full {selected.id === starredId ? 'text-accent' : 'text-ink-soft hover:text-ink'}"
			>
				<Star class="w-4 h-4" fill={selected.id === starredId ? 'currentColor' : 'none'} aria-hidden="true" />
			</button>
		{/if}
		<button
			type="button"
			on:click={() => (open = !open)}
			aria-expanded={open}
			aria-haspopup="listbox"
			aria-label="Switch person"
			class="p-1.5 rounded-full text-ink-soft hover:text-ink"
		>
			<ChevronDown class="w-4 h-4" aria-hidden="true" />
		</button>
	</div>

	{#if open}
		<ul role="listbox" class="absolute z-20 mt-1 min-w-[14rem] bg-surface rounded-lg shadow-card border border-line-soft py-1">
			{#each members as m (m.id)}
				<li role="option" aria-selected={m.id === selectedId}>
					<div class="flex items-center gap-2 px-2 py-1">
						<button
							type="button"
							on:click={() => dispatch('star', { memberId: m.id })}
							aria-label={m.id === starredId ? `${m.name} is the default` : `Make ${m.name} the default`}
							class="p-1 rounded-full {m.id === starredId ? 'text-accent' : 'text-ink-soft hover:text-ink'}"
						>
							<Star class="w-3.5 h-3.5" fill={m.id === starredId ? 'currentColor' : 'none'} aria-hidden="true" />
						</button>
						<button
							type="button"
							on:click={() => choose(m.id, m.name)}
							class="flex-1 text-left px-2 py-1 rounded-md text-sm {m.id === selectedId ? 'font-semibold text-ink' : 'text-ink-soft hover:bg-surface2'}"
						>
							{m.name}{#if m.stage}<span class="text-xs text-ink-soft"> · {m.stage}</span>{/if}
						</button>
					</div>
				</li>
			{/each}
			{#if starred}
				<li class="px-4 pt-1 pb-0.5 text-xs text-ink-soft border-t border-line-soft mt-1">Opens on {starred.name}</li>
			{/if}
		</ul>
	{/if}
</div>
