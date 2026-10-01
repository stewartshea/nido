<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { PenLine, Timer } from 'lucide-svelte';
	import { feedingAPI } from '$lib/api';
	import { enqueueRecord } from '$lib/logging/outbox';
	import { pumpTimerKey } from '$lib/logging/timers';
	import { localInputToIso, toLocalInput, formatMinutes } from '$lib/logging/format';
	import { loadRecentFeedings, apiError } from '$lib/logging/recent';
	import { lastSide, sideTotalMs, buildManualBreastFeed, type TimerFeedPayload } from '$lib/breast';
	import BreastTimer from './BreastTimer.svelte';
	import BreastLogFields from './BreastLogFields.svelte';

	export let memberId: number;
	export let members: { id: number | string; name: string }[] = [];

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string }; notice: { message: string } }>();

	let targetId = memberId;
	$: targetId = memberId;
	let mode: 'timer' | 'log' = 'timer';
	let timer: BreastTimer;
	let busy = false;
	let recent: any[] = [];
	let loadedFor: number | null = null;

	let startValue = toLocalInput();
	let side: 'left' | 'right' | 'both' = 'both';
	let endsOn: 'left' | 'right' = 'right';
	let leftMin = '';
	let rightMin = '';
	let amount = '';
	let unit: 'oz' | 'ml' = 'oz';
	let notes = '';

	$: pumps = recent.filter((f) => f.type === 'pump');
	$: lastPumped = lastSide(pumps);
	$: dayAgo = Date.now() - 24 * 60 * 60 * 1000;
	$: last24 = pumps.filter((f) => new Date(f.start_time).getTime() >= dayAgo);
	$: leftDay = sideTotalMs(last24, 'left');
	$: rightDay = sideTotalMs(last24, 'right');
	$: if (targetId !== loadedFor) { loadedFor = targetId; refreshRecent(); }

	async function refreshRecent() {
		recent = await loadRecentFeedings(targetId);
	}

	function fail(message: string) {
		dispatch('error', { message });
	}

	async function createOrQueue(payload: any): Promise<'saved' | 'queued'> {
		try {
			await feedingAPI.create(payload);
			return 'saved';
		} catch (err: any) {
			if (err?.response && err.response.status < 500) throw err;
			enqueueRecord('feeding', payload);
			return 'queued';
		}
	}

	function payloadFrom(feed: { startTime: string; endTime?: string; side: 'left' | 'right' | 'both'; leftBreastAt?: string; rightBreastAt?: string; leftDuration?: number; rightDuration?: number }) {
		return {
			memberId: targetId,
			type: 'pump' as const,
			...feed,
			amount: amount ? Number(amount) : undefined,
			amountUnit: unit,
			notes: notes || undefined,
		};
	}

	/**
	 * `stored` runs once the record is safely saved or queued and before the
	 * parent hears about it: hearing about it closes the drawer, which tears
	 * this form (and its timer) down, so cleanup after the event never happens.
	 */
	async function persist(feed: Parameters<typeof payloadFrom>[0], stored?: () => void) {
		busy = true;
		try {
			const outcome = await createOrQueue(payloadFrom(feed));
			stored?.();
			amount = ''; notes = ''; leftMin = ''; rightMin = '';
			await refreshRecent();
			dispatch('saved', { message: outcome === 'queued' ? 'Pump session saved locally — will sync when connected.' : 'Pump session recorded.' });
			return true;
		} catch (err: any) {
			fail(apiError(err, 'Failed to record pump session.'));
			return false;
		} finally {
			busy = false;
		}
	}

	async function saveTimer(e: CustomEvent<TimerFeedPayload>) {
		await persist(e.detail, () => timer?.reset());
	}

	async function saveLog(event: SubmitEvent) {
		event.preventDefault();
		const feed = buildManualBreastFeed({
			startMs: new Date(localInputToIso(startValue)).getTime(),
			side, endsOn,
			leftMin: leftMin ? Number(leftMin) : null,
			rightMin: rightMin ? Number(rightMin) : null,
		});
		await persist(feed);
	}
</script>

<div class="flex items-center justify-between mb-4">
	<h3 class="text-xl font-display font-semibold">Pump session</h3>
	<div class="flex items-center gap-2">
		<button type="button" on:click={() => (mode = 'log')} class="{mode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
		<button type="button" on:click={() => (mode = 'timer')} class="{mode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
	</div>
</div>

{#if members.length > 1}
	<div class="mb-3">
		<label for="pump-member" class="block text-sm font-medium text-ink-soft mb-1">Member</label>
		<select id="pump-member" bind:value={targetId} class="w-full px-3 py-2 border border-line rounded-md">
			{#each members as m}
				<option value={Number(m.id)}>{m.name}</option>
			{/each}
		</select>
	</div>
{/if}

<div class="flex justify-between mb-3 text-xs text-ink-soft" data-testid="pump-day-totals">
	<span>Last 24h pumped · L {formatMinutes(leftDay)}</span>
	<span>R {formatMinutes(rightDay)}</span>
</div>

{#if mode === 'timer'}
	<BreastTimer bind:this={timer} storageKey={pumpTimerKey(targetId)} lastSide={lastPumped} {busy} saveLabel="Save Pump" on:save={saveTimer} on:discarded={() => dispatch('notice', { message: 'An unsaved pump timer from earlier was discarded.' })}>
		<div class="space-y-3 mt-2">
			<div>
				<label for="pump-timer-volume" class="block text-sm font-medium text-ink-soft mb-1">Volume (optional)</label>
				<div class="flex items-center gap-2">
					<input id="pump-timer-volume" type="number" step="0.1" min="0" bind:value={amount} class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="4.0" />
					<div class="flex rounded-md border border-line-soft overflow-hidden">
						<button type="button" on:click={() => (unit = 'oz')} class="{unit === 'oz' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">oz</button>
						<button type="button" on:click={() => (unit = 'ml')} class="{unit === 'ml' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">ml</button>
					</div>
				</div>
			</div>
			<div>
				<label for="pump-timer-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
				<input id="pump-timer-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
			</div>
		</div>
	</BreastTimer>
{:else}
	<form on:submit={saveLog} class="space-y-3">
		<div>
			<label for="pump-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time (start)</label>
			<input id="pump-time" type="datetime-local" bind:value={startValue} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<BreastLogFields bind:side bind:endsOn bind:leftMin bind:rightMin lastSide={lastPumped} label="Pumped from" />
		<div>
			<label for="pump-volume" class="block text-sm font-medium text-ink-soft mb-1">Volume</label>
			<div class="flex items-center gap-2">
				<input id="pump-volume" type="number" step="0.1" min="0" bind:value={amount} class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="4.0" />
				<div class="flex rounded-md border border-line-soft overflow-hidden">
					<button type="button" on:click={() => (unit = 'oz')} class="{unit === 'oz' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">oz</button>
					<button type="button" on:click={() => (unit = 'ml')} class="{unit === 'ml' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">ml</button>
				</div>
			</div>
		</div>
		<div>
			<label for="pump-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
			<input id="pump-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Pump'}</button>
	</form>
{/if}
