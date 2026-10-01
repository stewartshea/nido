<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { Heart, Baby, Infinity as InfinityIcon, PenLine, Timer, RotateCcw, ChevronLeft } from 'lucide-svelte';
	import { feedingAPI } from '$lib/api';
	import { enqueueRecord } from '$lib/logging/outbox';
	import { feedTimerKey } from '$lib/logging/timers';
	import { formatMinutes, localInputToIso, toLocalInput } from '$lib/logging/format';
	import { loadRecentFeedings, apiError } from '$lib/logging/recent';
	import { lastSide, oppositeSide, sideTotalMs, buildManualBreastFeed, type TimerFeedPayload } from '$lib/breast';
	import BreastTimer from './BreastTimer.svelte';
	import BreastLogFields from './BreastLogFields.svelte';
	import BottleFields from './BottleFields.svelte';

	export let familyId: string | null;
	export let memberId: number;

	type Kind = 'breast' | 'bottle' | 'combo';
	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string }; notice: { message: string } }>();

	let kind: Kind | null = null;
	let mode: 'timer' | 'log' = 'timer';
	let timer: BreastTimer;
	let busy = false;
	let recent: any[] = [];
	let loadedFor: number | null = null;

	let startValue = toLocalInput();
	let side: 'left' | 'right' | 'both' = 'left';
	let endsOn: 'left' | 'right' = 'right';
	let leftMin = '';
	let rightMin = '';
	let notes = '';
	let bottleSource: 'breastmilk' | 'formula' = 'breastmilk';
	let formulaId: number | null = null;
	let amount = '';

	$: breastFeeds = recent.filter((f) => f.type === 'breast');
	$: lastBreast = lastSide(breastFeeds);
	$: dayAgo = Date.now() - 24 * 60 * 60 * 1000;
	$: last24 = breastFeeds.filter((f) => new Date(f.start_time).getTime() >= dayAgo);
	$: leftDay = sideTotalMs(last24, 'left');
	$: rightDay = sideTotalMs(last24, 'right');
	$: lastBreastAt = breastFeeds.length ? Math.max(...breastFeeds.map((f) => new Date(f.start_time).getTime())) : null;
	$: pumpedSince = lastBreastAt !== null && recent.some((f) => f.type === 'pump' && new Date(f.start_time).getTime() > lastBreastAt!);
	$: if (memberId !== loadedFor) { loadedFor = memberId; refreshRecent(); }

	async function refreshRecent() {
		recent = await loadRecentFeedings(memberId);
		if (kind && (kind === 'breast' || kind === 'combo')) suggestSide();
	}

	function suggestSide() {
		const last = lastSide(recent.filter((f) => f.type === 'breast'));
		side = oppositeSide(last);
		endsOn = last === 'right' ? 'left' : 'right';
	}

	function choose(next: Kind) {
		kind = next;
		mode = next === 'bottle' ? 'log' : 'timer';
		startValue = toLocalInput();
		if (next !== 'bottle') suggestSide();
	}

	function back() {
		kind = null;
	}

	function fail(message: string) {
		dispatch('error', { message });
	}

	function rememberLast() {
		try {
			localStorage.setItem('nido.lastFeed', JSON.stringify({ kind, side, bottleSource, formulaId, amount }));
		} catch { /* storage unavailable */ }
	}

	function repeatLast() {
		try {
			const raw = localStorage.getItem('nido.lastFeed');
			if (!raw) { fail('No previous feed to repeat.'); return; }
			const l = JSON.parse(raw);
			const k: Kind = l.kind === 'bottle' || l.kind === 'combo' ? l.kind : 'breast';
			choose(k);
			mode = 'log';
			side = l.side === 'right' || l.side === 'both' ? l.side : 'left';
			bottleSource = l.bottleSource === 'formula' ? 'formula' : 'breastmilk';
			formulaId = l.formulaId ?? null;
			amount = l.amount ?? '';
		} catch {
			fail('No previous feed to repeat.');
		}
	}

	function bottleRecord(startTime: string) {
		const type = bottleSource === 'formula' ? 'formula' : 'bottle';
		return {
			memberId,
			startTime,
			type: type as 'formula' | 'bottle',
			formulaId: type === 'formula' ? (formulaId ?? undefined) : undefined,
			amount: amount ? Number(amount) : undefined,
			notes: notes || undefined,
		};
	}

	function bottleInvalid(): string | null {
		if ((kind === 'bottle' || kind === 'combo') && bottleSource === 'formula' && !formulaId) return 'Pick a formula for the bottle.';
		return null;
	}

	async function createOrQueue(payload: any): Promise<'saved' | 'queued'> {
		try {
			await feedingAPI.create(payload);
			return 'saved';
		} catch (err: any) {
			// A network failure or 5xx is worth queueing; a 4xx means the data is wrong.
			if (err?.response && err.response.status < 500) throw err;
			enqueueRecord('feeding', payload);
			return 'queued';
		}
	}

	async function finish(outcome: 'saved' | 'queued') {
		rememberLast();
		notes = ''; amount = ''; leftMin = ''; rightMin = '';
		kind = null;
		await refreshRecent();
		dispatch('saved', { message: outcome === 'queued' ? 'Feeding saved locally — will sync when connected.' : 'Feed recorded.' });
	}

	async function saveTimer(e: CustomEvent<TimerFeedPayload>) {
		const invalid = bottleInvalid();
		if (invalid) { fail(invalid); return; }
		busy = true;
		try {
			const feed = e.detail;
			let outcome = await createOrQueue({ memberId, type: 'breast', notes: notes || undefined, ...feed });
			if (kind === 'combo') {
				const second = await createOrQueue(bottleRecord(feed.startTime));
				if (second === 'queued') outcome = 'queued';
			}
			timer.reset();
			await finish(outcome);
		} catch (err: any) {
			fail(apiError(err, 'Failed to record feed.'));
		} finally {
			busy = false;
		}
	}

	async function saveLog(event: SubmitEvent) {
		event.preventDefault();
		const invalid = bottleInvalid();
		if (invalid) { fail(invalid); return; }
		busy = true;
		try {
			const startMs = new Date(localInputToIso(startValue)).getTime();
			let outcome: 'saved' | 'queued' = 'saved';
			let bottleStart = new Date(startMs).toISOString();
			if (kind === 'breast' || kind === 'combo') {
				const feed = buildManualBreastFeed({
					startMs, side, endsOn,
					leftMin: leftMin ? Number(leftMin) : null,
					rightMin: rightMin ? Number(rightMin) : null,
				});
				bottleStart = feed.startTime;
				outcome = await createOrQueue({ memberId, type: 'breast', notes: notes || undefined, ...feed });
			}
			if (kind === 'bottle' || kind === 'combo') {
				const second = await createOrQueue(bottleRecord(bottleStart));
				if (second === 'queued') outcome = 'queued';
			}
			await finish(outcome);
		} catch (err: any) {
			fail(apiError(err, 'Failed to record feed.'));
		} finally {
			busy = false;
		}
	}

	onMount(() => { startValue = toLocalInput(); });
</script>

<div class="flex items-center justify-between mb-4">
	<h3 class="text-xl font-display font-semibold">Feed</h3>
	{#if kind && kind !== 'bottle'}
		<div class="flex items-center gap-2">
			<button type="button" on:click={() => (mode = 'log')} class="{mode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
			<button type="button" on:click={() => (mode = 'timer')} class="{mode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
		</div>
	{/if}
</div>

{#if !kind}
	<div class="block text-sm font-medium text-ink-soft mb-2">BreastFeed, Bottle Feed, or Combo?</div>
	<div class="grid grid-cols-3 gap-2 mb-3">
		<button type="button" on:click={() => choose('breast')} class="bg-surface text-ink-soft border-line-soft border rounded-lg py-4 px-3 text-sm font-semibold flex flex-col items-center justify-center gap-2"><Heart class="w-5 h-5" /> BreastFeed</button>
		<button type="button" on:click={() => choose('bottle')} class="bg-surface text-ink-soft border-line-soft border rounded-lg py-4 px-3 text-sm font-semibold flex flex-col items-center justify-center gap-2"><Baby class="w-5 h-5" /> Bottle Feed</button>
		<button type="button" on:click={() => choose('combo')} class="bg-surface text-ink-soft border-line-soft border rounded-lg py-4 px-3 text-sm font-semibold flex flex-col items-center justify-center gap-2"><InfinityIcon class="w-5 h-5" /> Combo</button>
	</div>
	<button type="button" on:click={repeatLast} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:bg-line-soft text-sm"><RotateCcw class="w-4 h-4 inline mr-1" /> Repeat last</button>
{:else}
	<button type="button" on:click={back} class="mb-3 text-sm text-ink-soft hover:text-ink inline-flex items-center gap-1"><ChevronLeft class="w-4 h-4" /> {kind === 'breast' ? 'BreastFeed' : kind === 'bottle' ? 'Bottle Feed' : 'Combo'}</button>

	{#if kind !== 'bottle'}
		<div class="flex justify-between mb-3 text-xs text-ink-soft" data-testid="day-totals">
			<span>Last 24h · L {formatMinutes(leftDay)}</span>
			<span>R {formatMinutes(rightDay)}</span>
		</div>
		{#if pumpedSince}
			<div class="mb-3 text-xs text-accent" data-testid="pump-since">Pumped since the last feed</div>
		{/if}
	{/if}

	{#if kind !== 'bottle' && mode === 'timer'}
		<BreastTimer bind:this={timer} storageKey={feedTimerKey(memberId)} lastSide={lastBreast} {busy} on:save={saveTimer} on:discarded={() => dispatch('notice', { message: 'An unsaved feed timer from earlier was discarded.' })}>
			{#if kind === 'combo'}
				<div class="mt-4 space-y-3 border-t pt-3">
					<p class="text-sm font-medium text-ink-soft">Bottle</p>
					<BottleFields {familyId} bind:source={bottleSource} bind:formulaId bind:amount on:error={(e) => fail(e.detail.message)} />
				</div>
			{/if}
			<div class="mt-3">
				<label for="feed-timer-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
				<input id="feed-timer-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
			</div>
		</BreastTimer>
	{:else}
		<form on:submit={saveLog} class="space-y-3">
			<div>
				<label for="feed-start" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time (start)</label>
				<input id="feed-start" type="datetime-local" bind:value={startValue} class="w-full px-3 py-2 border border-line rounded-md" />
			</div>
			{#if kind === 'breast' || kind === 'combo'}
				<BreastLogFields bind:side bind:endsOn bind:leftMin bind:rightMin lastSide={lastBreast} />
			{/if}
			{#if kind === 'bottle' || kind === 'combo'}
				<BottleFields {familyId} bind:source={bottleSource} bind:formulaId bind:amount on:error={(e) => fail(e.detail.message)} />
			{/if}
			<div>
				<label for="feed-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
				<input id="feed-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
			</div>
			<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Feed'}</button>
		</form>
	{/if}
{/if}
