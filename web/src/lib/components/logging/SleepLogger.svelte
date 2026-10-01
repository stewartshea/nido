<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import { PenLine, Timer, Moon } from 'lucide-svelte';
	import { sleepAPI } from '$lib/api';
	import { enqueueRecord } from '$lib/logging/outbox';
	import { sleepTimerKey } from '$lib/logging/timers';
	import { formatElapsed, formatTime, localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	let mode: 'timer' | 'log' = 'timer';
	let startedAt: number | null = null;
	let now = Date.now();
	let tick: ReturnType<typeof setInterval> | null = null;
	let location = 'crib';
	let notes = '';
	let startValue = toLocalInput();
	let endValue = '';
	let busy = false;
	let loadedFor: number | null = null;

	$: if (memberId !== loadedFor) { loadedFor = memberId; restore(); }

	function restore() {
		startedAt = null;
		try {
			const raw = localStorage.getItem(sleepTimerKey(memberId));
			const v = raw ? Number(JSON.parse(raw).startedAt) : NaN;
			if (Number.isFinite(v) && v > 0) startedAt = v;
		} catch { /* ignore corrupt value */ }
		now = Date.now();
		if (startedAt) startTick();
	}

	function startTick() {
		if (!tick) tick = setInterval(() => { now = Date.now(); }, 1000);
	}

	function stopTick() {
		if (tick) { clearInterval(tick); tick = null; }
	}

	function start() {
		startedAt = Date.now();
		now = startedAt;
		localStorage.setItem(sleepTimerKey(memberId), JSON.stringify({ startedAt }));
		startTick();
	}

	function cancel() {
		startedAt = null;
		localStorage.removeItem(sleepTimerKey(memberId));
		stopTick();
	}

	async function wake() {
		if (!startedAt) return;
		const payload = { memberId, startTime: new Date(startedAt).toISOString(), endTime: new Date().toISOString(), location, notes: notes || undefined };
		busy = true;
		try {
			let queued = false;
			try {
				await sleepAPI.create(payload);
			} catch (err: any) {
				if (err?.response && err.response.status < 500) throw err;
				enqueueRecord('sleep', payload);
				queued = true;
			}
			cancel();
			notes = '';
			dispatch('saved', { message: queued ? 'Sleep saved locally — will sync when connected.' : 'Sleep recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to record sleep.') });
		} finally {
			busy = false;
		}
	}

	async function saveLog(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		try {
			await sleepAPI.create({
				memberId,
				startTime: localInputToIso(startValue),
				endTime: endValue ? new Date(endValue).toISOString() : undefined,
				location,
				notes: notes || undefined,
			});
			notes = ''; endValue = '';
			dispatch('saved', { message: 'Sleep recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to record sleep.') });
		} finally {
			busy = false;
		}
	}

	onMount(() => { startValue = toLocalInput(); });
	onDestroy(stopTick);
</script>

<div class="flex items-center justify-between mb-4">
	<h3 class="text-xl font-display font-semibold">Sleep</h3>
	<div class="flex items-center gap-2">
		<button type="button" on:click={() => (mode = 'log')} class="{mode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
		<button type="button" on:click={() => (mode = 'timer')} class="{mode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
	</div>
</div>

<div class="mb-3">
	<label for="sleep-location" class="block text-sm font-medium text-ink-soft mb-1">Location</label>
	<select id="sleep-location" bind:value={location} class="w-full px-3 py-2 border border-line rounded-md">
		<option value="crib">Crib</option>
		<option value="bassinet">Bassinet</option>
		<option value="stroller">Stroller</option>
		<option value="carrier">Carrier</option>
		<option value="other">Other</option>
	</select>
</div>

{#if mode === 'timer'}
	{#if startedAt}
		<div class="text-center mb-4">
			<p class="text-5xl font-display font-bold text-ink-soft">{formatElapsed(now - startedAt)}</p>
			<p class="text-sm text-ink-soft">sleeping since {formatTime(new Date(startedAt).toISOString())}</p>
		</div>
	{/if}
	<div class="mb-3">
		<label for="sleep-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
		<input id="sleep-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	{#if startedAt}
		<div class="flex gap-4">
			<button type="button" on:click={wake} disabled={busy} class="flex-1 bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Wake & Save'}</button>
			<button type="button" on:click={cancel} class="bg-surface2 text-ink-soft py-2 px-4 rounded-md hover:bg-line-soft">Cancel</button>
		</div>
	{:else}
		<button type="button" on:click={start} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold"><Moon class="w-5 h-5 inline mr-2" /> Start Sleep</button>
	{/if}
{:else}
	<form on:submit={saveLog} class="space-y-3">
		<div>
			<label for="sleep-start" class="block text-sm font-medium text-ink-soft mb-1">Start date &amp; time</label>
			<input id="sleep-start" type="datetime-local" bind:value={startValue} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<div>
			<label for="sleep-end" class="block text-sm font-medium text-ink-soft mb-1">End date &amp; time (optional)</label>
			<input id="sleep-end" type="datetime-local" bind:value={endValue} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<div>
			<label for="sleep-log-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
			<input id="sleep-log-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Sleep'}</button>
	</form>
{/if}
