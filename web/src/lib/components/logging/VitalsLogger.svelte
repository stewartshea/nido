<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { vitalsAPI } from '$lib/api/records';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	/**
	 * One form for four readings, because they are one record with a kind: the
	 * fields swap rather than the form. Blood pressure is the reason this exists
	 * at all — two numbers that a title-and-notes milestone could not hold.
	 */
	const KINDS = [
		{ id: 'blood pressure', label: 'Blood pressure', hint: 'systolic / diastolic' },
		{ id: 'pulse', label: 'Pulse', unit: 'bpm' },
		{ id: 'temperature', label: 'Temperature', unit: '°C' },
		{ id: 'oxygen saturation', label: 'Oxygen saturation', unit: '%' },
	];

	let kind = 'blood pressure';
	let when = toLocalInput();
	let systolic = '';
	let diastolic = '';
	let value = '';
	let notes = '';
	let busy = false;

	onMount(() => { when = toLocalInput(); });

	const isBp = () => kind === 'blood pressure';
	const unitFor = (id: string) => KINDS.find((k) => k.id === id)?.unit ?? '';

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		try {
			await vitalsAPI.create({
				memberId,
				kind,
				recordedAt: localInputToIso(when),
				systolic: isBp() && systolic ? Number(systolic) : undefined,
				diastolic: isBp() && diastolic ? Number(diastolic) : undefined,
				value: !isBp() && value ? Number(value) : undefined,
				notes: notes || undefined,
			});
			systolic = '';
			diastolic = '';
			value = '';
			notes = '';
			dispatch('saved', { message: 'Vital sign recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to save vital sign.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">New Vital Sign</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<label for="vitals-kind" class="block text-sm font-medium text-ink-soft mb-1">Measurement</label>
		<select id="vitals-kind" bind:value={kind} class="w-full px-3 py-2 border border-line rounded-md">
			{#each KINDS as k}
				<option value={k.id}>{k.label}</option>
			{/each}
		</select>
	</div>
	<div>
		<label for="vitals-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="vitals-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	{#if isBp()}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="vitals-systolic" class="block text-sm font-medium text-ink-soft mb-1">Systolic (mmHg)</label>
				<input id="vitals-systolic" type="number" min="40" max="300" bind:value={systolic} class="w-full px-3 py-2 border border-line rounded-md" placeholder="120" required />
			</div>
			<div>
				<label for="vitals-diastolic" class="block text-sm font-medium text-ink-soft mb-1">Diastolic (mmHg)</label>
				<input id="vitals-diastolic" type="number" min="20" max="200" bind:value={diastolic} class="w-full px-3 py-2 border border-line rounded-md" placeholder="80" required />
			</div>
		</div>
	{:else}
		<div>
			<label for="vitals-value" class="block text-sm font-medium text-ink-soft mb-1">Value ({unitFor(kind)})</label>
			<input id="vitals-value" type="number" step="0.1" bind:value={value} class="w-full px-3 py-2 border border-line rounded-md" placeholder={kind === 'temperature' ? '37.0' : kind === 'pulse' ? '72' : '98'} required />
		</div>
	{/if}
	<div>
		<label for="vitals-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
		<input id="vitals-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="Anything worth remembering" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Vital Sign'}</button>
</form>
