<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Milk, Baby, Moon } from 'lucide-svelte';
	import { formatElapsed, formatRelative, formatTime } from '$lib/logging/format';

	export let summary: any;
	export let name = 'Selected';

	const dispatch = createEventDispatcher<{ log: { kind: string } }>();

	/**
	 * The headline is how long ago, because that is the question being asked of
	 * a "last seen" tile. The exact clock time sits underneath for when it matters.
	 */
	$: now = Date.now();

	function ago(iso: string | null | undefined): string {
		return formatRelative(iso, now);
	}

	function clock(iso: string | null | undefined): string {
		if (!iso) return '';
		const t = formatTime(iso);
		return t.split(', ')[1] || t;
	}

	function by(r: any): string {
		return r?.created_by_name || r?.createdByName || '';
	}
</script>

{#if summary}
	<h3 class="text-lg font-display font-semibold mb-3">Today for {name}</h3>
	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
		<button type="button" on:click={() => dispatch('log', { kind: 'growth' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
			<div class="flex items-center gap-2 mb-1">
				<Baby class="w-5 h-5 text-ink-soft" aria-hidden="true" />
				<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Age</p>
			</div>
			<p class="text-2xl font-display font-semibold text-ink">{summary.baby.ageInWeeks} <span class="text-sm text-ink-soft font-sans font-normal">weeks</span></p>
			<p class="text-sm text-ink-soft mt-1">Add measurement</p>
		</button>
		<button type="button" on:click={() => dispatch('log', { kind: 'feeds' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-primary hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
			<div class="flex items-center gap-2 mb-1">
				<span class="shrink-0" aria-hidden="true"><Milk class="w-5 h-5" /></span>
				<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Feed</p>
			</div>
			<p class="text-2xl font-display font-semibold text-ink">{summary.latestFeeding ? ago(summary.latestFeeding.end_time || summary.latestFeeding.start_time) : '—'}</p>
			<p class="text-xs text-ink-soft mt-1">{summary.latestFeeding ? clock(summary.latestFeeding.end_time || summary.latestFeeding.start_time) : ''}</p>
			<p class="text-sm text-ink-soft mt-0.5">{summary.latestFeeding?.type || 'no feed recorded'}</p>
			{#if by(summary.latestFeeding)}<p class="text-xs text-ink-soft mt-0.5">by {by(summary.latestFeeding)}</p>{/if}
		</button>
		<button type="button" on:click={() => dispatch('log', { kind: 'diapers' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-accent hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
			<div class="flex items-center gap-2 mb-1">
				<span class="shrink-0" aria-hidden="true"><Baby class="w-5 h-5" /></span>
				<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Diaper</p>
			</div>
			<p class="text-2xl font-display font-semibold text-ink">{summary.latestDiaper ? ago(summary.latestDiaper.change_time) : '—'}</p>
			<p class="text-xs text-ink-soft mt-1">{summary.latestDiaper ? clock(summary.latestDiaper.change_time) : ''}</p>
			<p class="text-sm text-ink-soft mt-0.5">{summary.latestDiaper?.type || 'no change recorded'}</p>
			{#if by(summary.latestDiaper)}<p class="text-xs text-ink-soft mt-0.5">by {by(summary.latestDiaper)}</p>{/if}
		</button>
		<button type="button" on:click={() => dispatch('log', { kind: 'sleep' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-ink hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
			<div class="flex items-center gap-2 mb-1">
				<span class="shrink-0" aria-hidden="true"><Moon class="w-5 h-5" /></span>
				<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Sleep</p>
			</div>
			<p class="text-2xl font-display font-semibold text-ink">{summary.latestSleep ? ago(summary.latestSleep.start_time) : '—'}</p>
			<p class="text-xs text-ink-soft mt-1">{summary.latestSleep ? clock(summary.latestSleep.start_time) : ''}</p>
			<p class="text-sm text-ink-soft mt-0.5">{summary.latestSleep?.duration ? formatElapsed(summary.latestSleep.duration) : 'no sleep recorded'}</p>
			{#if by(summary.latestSleep)}<p class="text-xs text-ink-soft mt-0.5">by {by(summary.latestSleep)}</p>{/if}
		</button>
	</div>
{/if}
