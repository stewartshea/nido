<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { ChevronRight, Milk, Moon } from 'lucide-svelte';
	import { formatElapsed } from '$lib/logging/format';
	import { storedTimers, TIMERS_CHANGED_EVENT, type StoredTimer, type TimerKind } from '$lib/logging/timers';
	import { holdWakeLock, releaseWakeLock, WAKE_LOCK_MAX_MS } from '$lib/logging/wakeLock';

	export let memberId: number | null = null;

	const dispatch = createEventDispatcher<{ log: { kind: string } }>();

	const LABELS: Record<TimerKind, string> = { feeds: 'Feeding', pumping: 'Pumping', sleep: 'Sleep' };

	let timers: StoredTimer[] = [];
	let lastMember: number | null | undefined;
	let tick: ReturnType<typeof setInterval> | null = null;
	let anyRunning = false;

	function refresh() {
		timers = browser ? storedTimers(localStorage, memberId, Date.now()) : [];
	}

	function startTick() {
		if (!tick) tick = setInterval(refresh, 1000);
	}

	function stopTick() {
		if (tick) { clearInterval(tick); tick = null; }
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') refresh();
	}

	// The stored keys are per member, so switching member re-reads the list.
	$: if (browser && memberId !== lastMember) {
		lastMember = memberId;
		refresh();
	}

	// Tick only while something is parked, so an idle page does no work.
	$: if (browser) { if (timers.length > 0) startTick(); else stopTick(); }

	// This strip stays mounted while the log sheet is open or closed, so it is
	// the one place that can keep the screen awake for a parked timer. iOS
	// locking the screen is what suspends (and can reload) the PWA mid-feed.
	// Sleep is excluded — it runs for hours, and the phone must be allowed to
	// sleep — and the hold is bounded for the same reason (WAKE_LOCK_MAX_MS).
	const wakeHolder = {};
	$: keepAwake = timers.some((t) => t.running && t.kind !== 'sleep' && t.elapsedMs < WAKE_LOCK_MAX_MS);
	$: if (browser) { if (keepAwake) holdWakeLock(wakeHolder); else releaseWakeLock(wakeHolder); }

	onMount(() => {
		refresh();
		document.addEventListener('visibilitychange', onVisibilityChange);
		// A timer started inside the sheet changes storage, not this component,
		// so the sheet tells the page when there is something new to show.
		window.addEventListener(TIMERS_CHANGED_EVENT, refresh);
		// `pageshow` covers a bfcache restore that never remounts; `focus`
		// covers returning to the app without a visibilitychange on iOS.
		window.addEventListener('pageshow', refresh);
		window.addEventListener('focus', refresh);
		return () => {
			stopTick();
			releaseWakeLock(wakeHolder);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener(TIMERS_CHANGED_EVENT, refresh);
			window.removeEventListener('pageshow', refresh);
			window.removeEventListener('focus', refresh);
		};
	});
</script>

<!--
	A timer keeps running in localStorage after the log sheet is closed. This
	strip is the way back: without it, a parked feed timer is invisible (and
	looks lost) until you open Feeds and pick the right kind again.
-->
{#if timers.length > 0}
	<div class="mb-4 bg-surface rounded-xl shadow-sm border border-line-soft p-3" data-testid="running-timers">
		<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider mb-1">In progress</p>
		<div class="divide-y divide-line-soft">
			{#each timers as t (t.kind)}
				<button
					type="button"
					on:click={() => dispatch('log', { kind: t.kind })}
					aria-label={`Resume ${LABELS[t.kind].toLowerCase()} timer, ${formatElapsed(t.elapsedMs)}`}
					class="w-full min-h-11 flex items-center gap-3 py-2 text-left hover:text-accent transition-colors"
				>
					{#if t.kind === 'sleep'}
						<Moon class="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
					{:else}
						<Milk class="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
					{/if}
					<span class="text-sm font-semibold">{LABELS[t.kind]}</span>
					{#if !t.running}<span class="text-xs text-ink-soft">paused</span>{/if}
					<span class="ml-auto text-sm tabular-nums text-ink-soft">{formatElapsed(t.elapsedMs)}</span>
					<ChevronRight class="w-4 h-4 text-ink-soft shrink-0" aria-hidden="true" />
				</button>
			{/each}
		</div>
	</div>
{/if}
