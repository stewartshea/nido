<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Pause, Play, ArrowLeft, ArrowRight } from 'lucide-svelte';
	import {
		emptyBreastTimer, toggleSide, timerHasTime, timerIsRunning, sideTotals,
		loadBreastTimer, saveBreastTimer, clearBreastTimer, type BreastTimerState, type Side,
	} from '$lib/logging/timers';
	import { buildTimerFeed, oppositeSide, type TimerFeedPayload } from '$lib/breast';
	import { formatElapsed } from '$lib/logging/format';

	export let storageKey: string;
	export let lastSide: Side | null = null;
	export let saveLabel = 'Save';
	export let busy = false;

	const dispatch = createEventDispatcher<{ save: TimerFeedPayload; discarded: void }>();

	let state: BreastTimerState = emptyBreastTimer();
	let now = Date.now();
	let loadedKey = '';
	let tick: ReturnType<typeof setInterval> | null = null;
	let mounted = false;
	let pendingDiscard = false;

	// The stored timer is read inside this block, with `state` assigned right
	// here, so Svelte orders it ahead of the values derived from it. Doing the
	// assignment inside a helper function hides it from Svelte: Save and the
	// totals were then computed from the empty timer and never refreshed.
	$: if (browser && storageKey !== loadedKey) {
		const loaded = loadBreastTimer(localStorage, storageKey, Date.now());
		loadedKey = storageKey;
		state = loaded.state;
		now = Date.now();
		if (loaded.discarded) {
			// Events fired during initialisation are lost: the parent has not
			// attached its listener yet, so hold the message until mounted.
			if (mounted) dispatch('discarded');
			else pendingDiscard = true;
		}
	}
	$: hasTime = timerHasTime(state);
	$: running = timerIsRunning(state);
	$: totals = sideTotals(state, now);
	$: leftRunning = state.leftStartedAt !== null;
	$: rightRunning = state.rightStartedAt !== null;
	$: if (browser) { if (running) startTick(); else stopTick(); }

	function startTick() {
		if (tick) return;
		tick = setInterval(() => { now = Date.now(); }, 1000);
	}

	function stopTick() {
		if (tick) { clearInterval(tick); tick = null; }
	}

	function toggle(side: Side) {
		now = Date.now();
		state = toggleSide(state, side, now);
		saveBreastTimer(localStorage, storageKey, state);
	}

	function save() {
		const feed = buildTimerFeed({ nowMs: Date.now(), ...state });
		if (feed) dispatch('save', feed);
	}

	/** Called by the parent once the feed is stored (or safely queued). */
	export function reset() {
		state = emptyBreastTimer();
		clearBreastTimer(localStorage, storageKey);
	}

	export function discard() {
		reset();
	}

	function resync() {
		if (document.visibilityState === 'visible') now = Date.now();
	}

	onMount(() => {
		mounted = true;
		if (pendingDiscard) {
			pendingDiscard = false;
			dispatch('discarded');
		}
	});

	if (browser) document.addEventListener('visibilitychange', resync);
	onDestroy(() => {
		stopTick();
		if (browser) document.removeEventListener('visibilitychange', resync);
	});
</script>

<div class="flex items-center justify-between mb-2">
	<div class="block text-sm font-medium text-ink-soft">Breast</div>
	{#if lastSide}
		<span class="text-xs text-ink-soft">
			last: {#if lastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}
			· try {oppositeSide(lastSide)} next
		</span>
	{/if}
</div>
<div class="grid grid-cols-2 gap-4 mb-4">
	<div class="rounded-lg border p-4 text-center {leftRunning ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}" data-testid="timer-left">
		<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Left</p>
		<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(totals.leftMs)}</p>
		<button type="button" on:click={() => toggle('left')} class="mt-3 w-full {leftRunning ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
			{#if leftRunning}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
		</button>
	</div>
	<div class="rounded-lg border p-4 text-center {rightRunning ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}" data-testid="timer-right">
		<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Right</p>
		<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(totals.rightMs)}</p>
		<button type="button" on:click={() => toggle('right')} class="mt-3 w-full {rightRunning ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
			{#if rightRunning}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
		</button>
	</div>
</div>
<div class="flex items-center justify-between mb-3 text-sm">
	<span class="text-ink-soft">Total</span>
	<span class="font-display font-semibold text-ink text-lg">{formatElapsed(totals.totalMs)}</span>
</div>

<slot />

<div class="flex gap-2 mt-3">
	<button type="button" on:click={save} disabled={!hasTime || busy} class="flex-1 bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">
		{busy ? 'Saving…' : saveLabel}
	</button>
	{#if hasTime}
		<button type="button" on:click={discard} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:bg-line-soft">Cancel</button>
	{/if}
</div>
