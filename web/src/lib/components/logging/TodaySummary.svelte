<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Milk, Baby, Moon, Syringe, TrendingUp } from 'lucide-svelte';
	import { formatAge, formatElapsed, formatRelative, formatTime } from '$lib/logging/format';

	export let summary: any;
	export let name = 'Selected';
	/** The member's enabled categories. Empty means "no filtering". */
	export let categories: string[] = [];
	/** Used to pick a stage-appropriate growth tile: an age for a child, a weight for anyone else. */
	export let stage: string | null = null;

	const dispatch = createEventDispatcher<{ log: { kind: string } }>();

	/**
	 * Which tiles this member gets.
	 *
	 * These used to be hardcoded to Age / Last Feed / Last Diaper / Last Sleep,
	 * so selecting an adult still showed nappies and feeds. A tile now appears
	 * only when the member actually tracks that category, which is the same rule
	 * the Quick Actions follow.
	 */
	$: has = (id: string) => categories.length === 0 || categories.includes(id);
	/** An age is only meaningful for a child; an adult or a pet gets a measurement. */
	$: age = stage === 'infant' || stage === 'child' ? formatAge(summary?.baby?.birthDate, now) : null;
	$: nextVaccine = summary?.upcomingVaccinations?.[0] ?? null;

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
		{#if has('growth')}
			<button type="button" on:click={() => dispatch('log', { kind: 'growth' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					{#if age}<Baby class="w-5 h-5 text-ink-soft" aria-hidden="true" />{:else}<TrendingUp class="w-5 h-5 text-ink-soft" aria-hidden="true" />{/if}
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">{age ? 'Age' : 'Measurement'}</p>
				</div>
				{#if age}
					<p class="text-2xl font-display font-semibold text-ink">{age.value}{#if age.unit} <span class="text-sm text-ink-soft font-sans font-normal">{age.unit}</span>{/if}</p>
					<p class="text-sm text-ink-soft mt-1">Add measurement</p>
				{:else}
					<p class="text-2xl font-display font-semibold text-ink">{summary.latestGrowth?.weight ? `${summary.latestGrowth.weight}` : '—'}</p>
					<p class="text-xs text-ink-soft mt-1">{summary.latestGrowth ? ago(summary.latestGrowth.measurement_date) : 'no measurement recorded'}</p>
				{/if}
			</button>
		{/if}
		{#if has('feeds')}
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
		{/if}
		{#if has('pumping')}
			<!-- The parent's side, and deliberately its own tile: a pump is not the
			     baby feeding, and "time since the breast was last used" is a supply
			     question that a bottle or a bowl of solids does not answer. -->
			<button type="button" on:click={() => dispatch('log', { kind: 'pumping' })} data-testid="last-pump" class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<span class="shrink-0" aria-hidden="true"><Milk class="w-5 h-5" /></span>
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Pump</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{summary.latestPump ? ago(summary.latestPump.end_time || summary.latestPump.start_time) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{summary.latestPump ? clock(summary.latestPump.end_time || summary.latestPump.start_time) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">
					{#if summary.latestPump?.amount}{summary.latestPump.amount} {summary.latestPump.amount_unit || 'oz'}{:else if summary.latestPump?.duration}{formatElapsed(summary.latestPump.duration)}{:else}no pump recorded{/if}
				</p>
				{#if by(summary.latestPump)}<p class="text-xs text-ink-soft mt-0.5">by {by(summary.latestPump)}</p>{/if}
			</button>
		{/if}
		{#if has('diapers')}
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
		{/if}
		{#if has('sleep')}
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
		{/if}
		{#if has('vaccines')}
			<button type="button" on:click={() => dispatch('log', { kind: 'vaccines' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Syringe class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Next Vaccination</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{nextVaccine ? ago(nextVaccine.next_due_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{nextVaccine ? clock(nextVaccine.next_due_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{nextVaccine?.name || 'nothing scheduled'}</p>
			</button>
		{/if}
	</div>
{/if}
