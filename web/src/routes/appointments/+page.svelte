<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { milestoneAPI } from '$lib/api';
	import { CalendarClock, AlertCircle } from 'lucide-svelte';

	/**
	 * What is booked, family-wide, in the weeks ahead.
	 *
	 * Appointments are milestone rows with kind 'appointments' (see
	 * api/src/appointments.ts), so this page is a read of one list rather than a
	 * module of its own. It is deliberately family-wide: an appointment belongs
	 * to the household's week, not to whoever happens to be selected on the
	 * dashboard, and the weekly email is built from the same query.
	 */

	interface UpcomingAppointment {
		id: number;
		title: string;
		date: string;
		category: string | null;
		description: string | null;
		memberId: number | null;
		memberName: string | null;
	}

	let loaded = false;
	let error = '';
	let appointments: UpcomingAppointment[] = [];
	let days = 30;

	async function load() {
		try {
			const res = await milestoneAPI.getUpcoming({ days });
			appointments = res.data.appointments ?? [];
			days = res.data.days ?? days;
		} catch (e: any) {
			if (e?.response?.status === 401) { await goto('/login'); return; }
			error = e?.response?.data?.error || 'Could not load upcoming appointments.';
		} finally {
			loaded = true;
		}
	}

	// Grouped by calendar day so "what is this week" reads at a glance. The list
	// arrives sorted ascending, and Map preserves insertion order, so the groups
	// come out in the same order.
	$: byDay = (() => {
		const groups = new Map<string, UpcomingAppointment[]>();
		for (const a of appointments) {
			const d = new Date(a.date);
			const key = Number.isFinite(d.getTime()) ? d.toDateString() : 'Unknown date';
			const list = groups.get(key) ?? [];
			list.push(a);
			groups.set(key, list);
		}
		return [...groups.entries()];
	})();

	function dayLabel(key: string): string {
		if (key === 'Unknown date') return key;
		const d = new Date(key);
		const today = new Date();
		const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
		if (d.toDateString() === today.toDateString()) return 'Today';
		if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
		return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	}

	function timeLabel(iso: string): string {
		const d = new Date(iso);
		return Number.isFinite(d.getTime())
			? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			: '';
	}

	onMount(load);
</script>

<svelte:head><title>Appointments · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="flex items-start gap-3 mb-5">
		<span class="w-12 h-12 rounded-full border-2 border-accent text-accent flex items-center justify-center shrink-0" aria-hidden="true">
			<CalendarClock class="w-6 h-6" />
		</span>
		<div>
			<h1 class="text-2xl font-display font-semibold text-ink">Upcoming appointments</h1>
			<p class="text-sm text-ink-soft mt-1">
				What is booked for your family in the next {days} days. Appointments are added from the
				dashboard&rsquo;s log sheet — pick <strong class="font-semibold text-ink">Appointments</strong> and set a future date.
			</p>
		</div>
	</div>

	{#if error}<p class="text-sm text-danger-text mb-3 flex items-center gap-2"><AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />{error}</p>{/if}

	{#if loaded}
		{#if appointments.length === 0}
			<section class="bg-surface rounded-lg shadow-card border border-line-soft p-6 text-center" data-testid="appointments-empty">
				<CalendarClock class="w-8 h-8 mx-auto text-ink-soft mb-2" aria-hidden="true" />
				<p class="text-ink-soft">Nothing booked in the next {days} days.</p>
				<p class="text-sm text-ink-soft mt-1">When an appointment is logged with a future date, it appears here.</p>
			</section>
		{:else}
			<div class="space-y-4" data-testid="appointments-list">
				{#each byDay as [key, items] (key)}
					<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 md:p-5">
						<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-soft mb-2">{dayLabel(key)}</h2>
						<ul class="space-y-2">
							{#each items as a (a.id)}
								<li class="flex items-start gap-3">
									<span class="text-sm font-semibold tabular-nums text-ink shrink-0 w-20">{timeLabel(a.date)}</span>
									<span class="flex-1 min-w-0">
										<span class="block text-ink">
											{#if a.memberName}<span class="font-semibold">{a.memberName}</span> · {/if}{a.title}
										</span>
										{#if a.category}
											<span class="block text-xs text-ink-soft capitalize">{a.category}</span>
										{/if}
										{#if a.description}
											<span class="block text-xs text-ink-soft">{a.description}</span>
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
	{/if}
</div>
