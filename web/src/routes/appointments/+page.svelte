<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { familiesAPI } from '$lib/api/family';
	import { milestoneAPI } from '$lib/api/records';
	import { planAPI } from '$lib/api/plans';
	import type { Plan } from '$lib/api/types';
	import { dayKeyOffset, dayKeyToDate, todayKey, zonedDayKey, zonedOptions } from '$lib/logging/format';
	import { loadFamilyTimezone, timezoneStore } from '$lib/stores/timezoneStore';
	import { CalendarClock, AlertCircle, CalendarPlus, Check, CalendarRange, X, Frown } from 'lucide-svelte';

	/**
	 * What is booked, family-wide, in the weeks ahead — and the question each
	 * booking becomes once its time has passed.
	 *
	 * "Upcoming" is not a log category: it is any open plan, whatever category
	 * it was booked as (design §3.6). A booked medical visit, a routine or an
	 * appointment all land here; an overdue plan is the prompt, so it rises to
	 * the top instead of aging out of sight. Each one is answered in place:
	 * done writes the ordinary event (bills stock, resets reminders), or the
	 * family reschedules it, marks it missed, or cancels it.
	 */

	interface UpcomingAppointment {
		id: number;
		title: string;
		date: string;
		kind: string;
		category: string | null;
		description: string | null;
		memberId: number | null;
		memberName: string | null;
		overdue?: boolean;
	}

	let loaded = false;
	let error = '';
	let notice = '';
	let appointments: UpcomingAppointment[] = [];
	let days = 30;

	// Booking: the categories whose records are events and which declare
	// 'book' — the same gate the route enforces, mirrored here so the form
	// never offers something the server would refuse.
	const BOOKABLE = ['appointments', 'medical'];

	let showBook = false;
	let bookCategory = 'appointments';
	let bookTitle = '';
	let bookDate = '';
	let bookTime = '09:00';
	let members: Array<{ id: number; name: string; trackable?: boolean }> = [];
	let bookMemberId: number | null = null;
	let bookBusy = false;

	// The plan currently being answered, with its four verbs.
	let answering: UpcomingAppointment | null = null;
	let answerBusy = false;

	async function load() {
		try {
			// The clock first: this page is reachable by a direct link (and from the
			// tile, and from a mail), so it cannot rely on the dashboard or the
			// layout having already loaded the family's settings. Reading it here
			// means the first paint is already on the right day.
			await loadFamilyTimezone();

			const res = await milestoneAPI.getUpcoming({ days });
			appointments = res.data.appointments ?? [];
			days = res.data.days ?? days;

			const fams = await familiesAPI.list();
			const active = fams.data.families?.[0];
			if (active) {
				const res2 = await familiesAPI.members(active.familyId);
				members = (res2.data.members ?? []).filter((m: any) => m.trackable !== false);
				bookMemberId = members[0]?.id ?? null;
			}
		} catch (e: any) {
			if (e?.response?.status === 401) { await goto('/login'); return; }
			error = e?.response?.data?.error || 'Could not load upcoming appointments.';
		} finally {
			loaded = true;
		}
	}

	async function book() {
		if (!bookMemberId || !bookDate) { error = 'Choose who it is for and a day.'; return; }
		bookBusy = true;
		error = '';
		try {
			const scheduledAt = new Date(`${bookDate}T${bookTime || '09:00'}:00`).toISOString();
			await planAPI.book({
				memberId: bookMemberId,
				category: bookCategory,
				scheduledAt,
				title: bookTitle.trim() || undefined,
				data: bookCategory === 'medical' ? { visitType: 'wellness' } : { type: 'checkup' },
			});
			showBook = false;
			bookTitle = '';
			notice = 'Booked.';
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not book that.';
		} finally {
			bookBusy = false;
		}
	}

	// The four answers. "Done" writes the ordinary event through the shared
	// path — the record lands, stock bills, reminder clocks reset — and links
	// the plan to it; the other three close the question without one.
	async function answer(plan: UpcomingAppointment, verb: 'fulfil' | 'missed' | 'cancel') {
		answerBusy = true;
		error = '';
		try {
			if (verb === 'fulfil') {
				await planAPI.fulfil(plan.id, {});
				notice = `${plan.title || 'The booking'} recorded.`;
			} else if (verb === 'missed') {
				await planAPI.missed(plan.id);
				notice = `${plan.title || 'The booking'} marked missed.`;
			} else {
				await planAPI.cancel(plan.id);
				notice = `${plan.title || 'The booking'} cancelled.`;
			}
			answering = null;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not update that booking.';
		} finally {
			answerBusy = false;
		}
	}

	async function reschedule(plan: UpcomingAppointment) {
		const next = prompt('Reschedule to (YYYY-MM-DD HH:MM):', new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16));
		if (!next) return;
		const when = new Date(next);
		if (Number.isNaN(when.getTime())) { error = 'That date did not parse.'; return; }
		answerBusy = true;
		try {
			await planAPI.reschedule(plan.id, when.toISOString());
			notice = 'Rescheduled.';
			answering = null;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not reschedule.';
		} finally {
			answerBusy = false;
		}
	}

	// Grouped by calendar day so "what is this week" reads at a glance. The list
	// arrives sorted ascending, and Map preserves insertion order, so the groups
	// come out in the same order. Overdue plans group under their booked day,
	// with their own heading at the top of the list.
	//
	// The day is the *family's* day, not the device's: a plan booked for 9:30
	// in the morning is stored as an instant, and reading that instant on a
	// device that has travelled would file it under the wrong heading.
	// zonedDayKey asks the chosen zone which date the instant falls on.
	//
	// `$timezoneStore` is read so this recomputes when the zone arrives or
	// changes: the list can land before the family's settings do, and without the
	// dependency the grouping would keep the device's day from that first pass.
	$: overdue = appointments.filter((a) => a.overdue);
	$: upcoming = appointments.filter((a) => !a.overdue);
	$: byDay = (() => {
		void $timezoneStore;
		const groups = new Map<string, UpcomingAppointment[]>();
		for (const a of upcoming) {
			const key = zonedDayKey(a.date) || 'Unknown date';
			const list = groups.get(key) ?? [];
			list.push(a);
			groups.set(key, list);
		}
		return [...groups.entries()];
	})();

	function dayLabel(key: string): string {
		if (key === 'Unknown date') return key;
		if (key === todayKey()) return 'Today';
		if (key === dayKeyOffset(todayKey(), 1)) return 'Tomorrow';
		return dayKeyToDate(key).toLocaleDateString(undefined, zonedOptions({ weekday: 'long', month: 'long', day: 'numeric' }));
	}

	function timeLabel(iso: string): string {
		const d = new Date(iso);
		return Number.isFinite(d.getTime())
			? d.toLocaleTimeString(undefined, zonedOptions({ hour: 'numeric', minute: '2-digit' }))
			: '';
	}

	onMount(load);
</script>

<svelte:head><title>Upcoming · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="flex items-start gap-3 mb-5">
		<span class="w-12 h-12 rounded-full border-2 border-accent text-accent flex items-center justify-center shrink-0" aria-hidden="true">
			<CalendarClock class="w-6 h-6" />
		</span>
		<div class="flex-1">
			<h1 class="text-2xl font-display font-semibold text-ink">Upcoming</h1>
			<p class="text-sm text-ink-soft mt-1">
				What is booked for your family in the next {days} days. Book a visit or a check-up here;
				when its time passes, it asks whether it happened.
			</p>
		</div>
		<button type="button" on:click={() => (showBook = !showBook)} class="flex items-center gap-1.5 h-9 px-3 rounded-full bg-primary text-on-primary text-sm font-semibold hover:opacity-90 shrink-0">
			<CalendarPlus class="w-4 h-4" aria-hidden="true" /> Book
		</button>
	</div>

	{#if showBook}
		<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 mb-4" data-testid="book-form">
			<form on:submit|preventDefault={book} class="grid gap-3 sm:grid-cols-2">
				<label class="block text-sm">
					<span class="block text-ink-soft mb-1">Who it is for</span>
					<select bind:value={bookMemberId} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
						{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
					</select>
				</label>
				<label class="block text-sm">
					<span class="block text-ink-soft mb-1">What kind</span>
					<select bind:value={bookCategory} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
						<option value="appointments">Appointment</option>
						<option value="medical">Medical visit</option>
					</select>
				</label>
				<label class="block text-sm">
					<span class="block text-ink-soft mb-1">Title</span>
					<input type="text" bind:value={bookTitle} placeholder="Six-month checkup" class="w-full px-3 py-2 border border-line rounded-md" />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="block text-sm">
						<span class="block text-ink-soft mb-1">Day</span>
						<input type="date" bind:value={bookDate} required class="w-full px-3 py-2 border border-line rounded-md" />
					</label>
					<label class="block text-sm">
						<span class="block text-ink-soft mb-1">Time</span>
						<input type="time" bind:value={bookTime} class="w-full px-3 py-2 border border-line rounded-md" />
					</label>
				</div>
				<div class="sm:col-span-2 flex justify-end gap-2">
					<button type="button" on:click={() => (showBook = false)} class="px-4 py-2 text-sm border border-line rounded-md">Cancel</button>
					<button type="submit" disabled={bookBusy} class="px-4 py-2 text-sm bg-primary text-on-primary rounded-md disabled:opacity-50">{bookBusy ? 'Booking…' : 'Book it'}</button>
				</div>
			</form>
		</section>
	{/if}

	{#if error}<p class="text-sm text-danger-text mb-3 flex items-center gap-2"><AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />{error}</p>{/if}
	{#if notice}<p class="text-sm text-success mb-3">{notice}</p>{/if}

	{#if loaded}
		{#if overdue.length > 0}
			<section class="bg-surface rounded-lg shadow-card border-l-4 border-warning p-4 md:p-5 mb-4" data-testid="overdue-plans">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-warning mb-1">Did it happen?</h2>
				<p class="text-xs text-ink-soft mb-3">These were booked for a time that has passed. Answering clears the question.</p>
				<ul class="space-y-3">
					{#each overdue as a (a.id)}
						<li class="flex flex-wrap items-start gap-2">
							<span class="flex-1 min-w-0">
								<span class="block text-ink">
									{#if a.memberName}<span class="font-semibold">{a.memberName}</span> · {/if}{a.title || 'Untitled booking'}
								</span>
								<span class="block text-xs text-ink-soft capitalize">
									booked for {timeLabel(a.date)}{#if a.kind} · {a.kind}{/if}{#if a.category} · {a.category}{/if}
								</span>
							</span>
							<span class="flex flex-wrap gap-1.5">
								<button type="button" on:click={() => answer(a, 'fulfil')} disabled={answerBusy} class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-primary text-on-primary rounded-md disabled:opacity-50" title="Writes the record at the time it actually happened">
									<Check class="w-3.5 h-3.5" aria-hidden="true" /> Done
								</button>
								<button type="button" on:click={() => reschedule(a)} disabled={answerBusy} class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-line rounded-md" title="Pick a new time">
									<CalendarRange class="w-3.5 h-3.5" aria-hidden="true" /> Reschedule
								</button>
								<button type="button" on:click={() => answer(a, 'missed')} disabled={answerBusy} class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-line rounded-md" title="It did not happen and will not — kept in history">
									<Frown class="w-3.5 h-3.5" aria-hidden="true" /> Missed
								</button>
								<button type="button" on:click={() => answer(a, 'cancel')} disabled={answerBusy} class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-line rounded-md text-ink-soft" title="No longer expected at all">
									<X class="w-3.5 h-3.5" aria-hidden="true" /> Cancel
								</button>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if appointments.length === 0}
			<section class="bg-surface rounded-lg shadow-card border border-line-soft p-6 text-center" data-testid="appointments-empty">
				<CalendarClock class="w-8 h-8 mx-auto text-ink-soft mb-2" aria-hidden="true" />
				<p class="text-ink-soft">Nothing booked in the next {days} days.</p>
				<p class="text-sm text-ink-soft mt-1">Use Book above to schedule a visit or a check-up.</p>
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
										<span class="block text-xs text-ink-soft capitalize">
											{#if a.kind === 'appointments'}Appointment
											{:else if a.kind}{a.kind}
											{/if}{#if a.category} · {a.category}{/if}
										</span>
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
