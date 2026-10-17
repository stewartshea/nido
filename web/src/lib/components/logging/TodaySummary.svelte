<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Milk, Baby, Moon, Syringe, TrendingUp, Pill, Apple, Scissors, Calendar, Stethoscope, Award, Repeat2, Settings2 } from 'lucide-svelte';
	import { formatAge, formatElapsed, formatRelative, formatTime, formatUpcoming } from '$lib/logging/format';
	import { formatGrowthHeadline } from '$lib/growth/units';

	export let summary: any;
	export let name = 'Selected';
	/** The member's enabled categories. Empty means "no filtering". */
	export let categories: string[] = [];
	/** Used to pick a stage-appropriate growth tile: an age for a child, a weight for anyone else. */
	export let stage: string | null = null;
	/** Which tiles to show in which order. Null uses the default order. */
	export let tiles: string[] | null = null;

	const dispatch = createEventDispatcher<{ log: { kind: string }; saveTiles: { tiles: string[] | null } }>();

	/**
	 * Which tiles this member gets.
	 *
	 * These used to be hardcoded to Age / Last Feed / Last Diaper / Last Sleep,
	 * so selecting an adult still showed nappies and feeds. A tile now appears
	 * only when the member actually tracks that category, which is the same rule
	 * the Quick Actions follow.
	 */
	$: has = (id: string) => categories.length === 0 || categories.includes(id);
	/** An age is only meaningful for a child. Adults and pets were backfilled
	 * with a stage when stages arrived, so a null stage uniquely identifies a
	 * legacy child created before stages — it must show an age too. */
	$: age = stage === 'adult' || stage === 'pet' ? null : formatAge(summary?.baby?.birthDate, now);
	$: nextVaccine = summary?.upcomingVaccinations?.[0] ?? null;
	$: latestByKind = summary?.latestByKind || {};

	$: now = Date.now();

	function ago(iso: string | null | undefined): string {
		return formatRelative(iso, now);
	}

	function up(iso: string | null | undefined): string {
		return formatUpcoming(iso, now);
	}

	function clock(iso: string | null | undefined): string {
		if (!iso) return '';
		const t = formatTime(iso);
		return t.split(', ')[1] || t;
	}

	function by(r: any): string {
		return r?.created_by_name || r?.createdByName || '';
	}

	let showPicker = false;
	/** Everything this member tracks that has a tile. */
	$: available = ['growth', 'feeds', 'pumping', 'diapers', 'sleep', 'vaccines', 'medication', 'vitamins', 'grooming', 'appointments', 'medical', 'milestones', 'firsts', 'routines'].filter(has);
	/** What to render, in order: the saved order, else everything tracked. */
	$: orderedTiles = tiles && tiles.length ? tiles.filter((t) => available.includes(t)) : available;
	$: selection = tiles && tiles.length ? tiles.filter((t) => available.includes(t)) : available.slice();

	const TILE_LABELS: Record<string, string> = {
		growth: 'Growth', feeds: 'Feeds', pumping: 'Pumping', diapers: 'Diapers',
		sleep: 'Sleep', vaccines: 'Vaccinations', medication: 'Medication',
		vitamins: 'Vitamins', grooming: 'Grooming', appointments: 'Appointments',
		medical: 'Medical', milestones: 'Milestones', firsts: 'Firsts', routines: 'Routines',
	};

	function openCustomize() {
		if (showPicker) { showPicker = false; return; }
		selection = tiles && tiles.length ? tiles.filter((t) => available.includes(t)) : available.slice();
		showPicker = true;
	}

	/** Move a chosen tile one step earlier or later in the panel. */
	function move(id: string, dir: -1 | 1) {
		const i = selection.indexOf(id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= selection.length) return;
		const next = selection.slice();
		[next[i], next[j]] = [next[j], next[i]];
		selection = next;
	}

	function toggle(id: string, on: boolean) {
		if (on && !selection.includes(id)) selection = [...selection, id];
		else if (!on) selection = selection.filter((x) => x !== id);
	}

	function save() {
		// A selection that matches the default order is stored as null, so the
		// panel keeps following the member's categories if they change later.
		const isDefault = selection.length === available.length && selection.every((id, i) => id === available[i]);
		dispatch('saveTiles', { tiles: isDefault || selection.length === 0 ? null : selection.slice() });
		showPicker = false;
	}
</script>

{#if summary}
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-lg font-display font-semibold">Today for {name}</h3>
		<button type="button" on:click={() => openCustomize()} aria-expanded={showPicker} class="inline-flex items-center gap-1 px-2 py-1 text-xs text-ink-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
			<Settings2 class="w-3.5 h-3.5" aria-hidden="true" /> Customize
		</button>
	</div>

	{#if showPicker}
		<!-- Inline rather than a modal: this configures the panel right below it,
		     and the tile list can be longer than a small dialog would show. -->
		<div class="bg-surface2 rounded-lg border border-line p-3 mb-3">
			<p class="text-xs text-ink-soft mb-2">Choose which tiles show for {name}, and in what order.</p>
			<div class="max-h-64 overflow-auto">
				<!-- Shown, in order, with arrows to rearrange. -->
				{#each selection as t (t)}
					<div class="flex items-center gap-2 py-1.5 text-sm">
						<input type="checkbox" checked aria-label={TILE_LABELS[t] ?? t} on:change={(e) => toggle(t, e.currentTarget.checked)} />
						<span class="flex-1">{TILE_LABELS[t] ?? t}</span>
						<button type="button" class="text-ink-soft hover:text-ink px-1 disabled:opacity-30" disabled={selection.indexOf(t) === 0} aria-label="Move {TILE_LABELS[t] ?? t} up" on:click={() => move(t, -1)}>↑</button>
						<button type="button" class="text-ink-soft hover:text-ink px-1 disabled:opacity-30" disabled={selection.indexOf(t) === selection.length - 1} aria-label="Move {TILE_LABELS[t] ?? t} down" on:click={() => move(t, 1)}>↓</button>
					</div>
				{/each}
				<!-- Everything this member tracks that is not on the panel yet. -->
				{#each available.filter((t) => !selection.includes(t)) as t (t)}
					<label class="flex items-center gap-2 py-1.5 text-sm text-ink-soft">
						<input type="checkbox" on:change={(e) => toggle(t, e.currentTarget.checked)} />
						{TILE_LABELS[t] ?? t}
					</label>
				{/each}
			</div>
			<div class="flex gap-2 justify-end mt-2">
				<button type="button" class="px-2 py-1 text-xs text-ink-soft hover:text-ink" on:click={() => { selection = available.slice(); }}>Show all</button>
				<button type="button" class="px-3 py-1 text-xs bg-accent text-on-accent rounded" on:click={save}>Save</button>
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
		{#each orderedTiles as t (t)}
		{#if t === 'growth'}
			<button type="button" on:click={() => dispatch('log', { kind: 'growth' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					{#if age}<Baby class="w-5 h-5 text-ink-soft" aria-hidden="true" />{:else}<TrendingUp class="w-5 h-5 text-ink-soft" aria-hidden="true" />{/if}
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">{age ? 'Age' : 'Measurement'}</p>
				</div>
				{#if age}
					<p class="text-2xl font-display font-semibold text-ink">{age.value}{#if age.unit} <span class="text-sm text-ink-soft font-sans font-normal">{age.unit}</span>{/if}</p>
					<p class="text-sm text-ink-soft mt-1">Add measurement</p>
				{:else}
					{@const measurement = formatGrowthHeadline(summary.latestGrowth)}
					<p class="text-xl font-display font-semibold text-ink">{measurement ?? '—'}</p>
					<p class="text-xs text-ink-soft mt-1">{summary.latestGrowth ? ago(summary.latestGrowth.measurement_date) : 'no measurement recorded'}</p>
				{/if}
			</button>
		{:else if t === 'feeds'}
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
		{:else if t === 'pumping'}
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
		{:else if t === 'diapers'}
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
		{:else if t === 'sleep'}
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
		{:else if t === 'vaccines'}
			<button type="button" on:click={() => dispatch('log', { kind: 'vaccines' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Syringe class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Next Vaccination</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{nextVaccine ? ago(nextVaccine.next_due_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{nextVaccine ? clock(nextVaccine.next_due_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{nextVaccine?.name || 'nothing scheduled'}</p>
			</button>
		{:else if t === 'medication'}
			{@const m = latestByKind.medication}
			<button type="button" on:click={() => dispatch('log', { kind: 'medication' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Pill class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Medication</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || 'no medication recorded'}</p>
			</button>
		{:else if t === 'vitamins'}
			{@const m = latestByKind.vitamins}
			<button type="button" on:click={() => dispatch('log', { kind: 'vitamins' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Apple class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Vitamin</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || 'no vitamin recorded'}</p>
			</button>
		{:else if t === 'grooming'}
			{@const m = latestByKind.grooming}
			<button type="button" on:click={() => dispatch('log', { kind: 'grooming' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Scissors class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Grooming</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || m?.category || 'no grooming recorded'}</p>
			</button>
		{:else if t === 'appointments'}
			<!-- Future-facing. A booked appointment lives on a date that has not
			     arrived, and "time since the last appointment" is the wrong
			     question while one is on the calendar. When the member has an
			     appointment ahead, this tile counts down to the next one; only
			     when none is booked does it fall back to the last one. -->
			{@const next = summary?.upcomingAppointments?.[0] ?? null}
			{@const m = latestByKind.appointments}
			<button type="button" on:click={() => dispatch('log', { kind: 'appointments' })} data-testid="appointments-tile" class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Calendar class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">{next ? 'Next Appointment' : 'Last Appointment'}</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{next ? up(next.achieved_date) : (m ? ago(m.achieved_date) : '—')}</p>
				<p class="text-xs text-ink-soft mt-1">{next ? formatTime(next.achieved_date) : (m ? clock(m.achieved_date) : '')}</p>
				<p class="text-sm text-ink-soft mt-0.5">{next?.title || m?.title || 'no appointment recorded'}</p>
			</button>
		{:else if t === 'medical'}
			{@const m = latestByKind.medical}
			<button type="button" on:click={() => dispatch('log', { kind: 'medical' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Stethoscope class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Medical</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || 'no medical recorded'}</p>
			</button>
		{:else if t === 'milestones'}
			{@const m = latestByKind.milestones}
			<button type="button" on:click={() => dispatch('log', { kind: 'milestones' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Award class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Milestone</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || 'no milestone recorded'}</p>
			</button>
		{:else if t === 'firsts'}
			{@const m = latestByKind.firsts}
			<button type="button" on:click={() => dispatch('log', { kind: 'firsts' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Award class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last First</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || 'no first recorded'}</p>
			</button>
		{:else if t === 'routines'}
			{@const m = latestByKind.routines}
			<button type="button" on:click={() => dispatch('log', { kind: 'routines' })} class="text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-line hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition">
				<div class="flex items-center gap-2 mb-1">
					<Repeat2 class="w-5 h-5 text-ink-soft" aria-hidden="true" />
					<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Routine</p>
				</div>
				<p class="text-2xl font-display font-semibold text-ink">{m ? ago(m.achieved_date) : '—'}</p>
				<p class="text-xs text-ink-soft mt-1">{m ? clock(m.achieved_date) : ''}</p>
				<p class="text-sm text-ink-soft mt-0.5">{m?.title || m?.category || 'no routine recorded'}</p>
			</button>
		{/if}
		{/each}
	</div>

{/if}

