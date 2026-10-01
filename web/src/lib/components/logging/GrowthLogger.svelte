<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { growthAPI } from '$lib/api';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	let when = toLocalInput();
	let unit: 'metric' | 'imperial' = 'metric';
	let weight = '';
	let height = '';
	let head = '';
	let busy = false;

	onMount(() => { when = toLocalInput(); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		try {
			await growthAPI.create({
				memberId,
				measurementDate: localInputToIso(when),
				weight: weight ? Number(weight) : undefined,
				height: height ? Number(height) : undefined,
				headCircumference: head ? Number(head) : undefined,
				unitSystem: unit,
			});
			dispatch('saved', { message: 'Growth measurement recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to save growth measurement.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">New Measurement</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<label for="growth-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="growth-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<div>
		<label for="growth-unit" class="block text-sm font-medium text-ink-soft mb-1">Units</label>
		<select id="growth-unit" bind:value={unit} class="w-full px-3 py-2 border border-line rounded-md">
			<option value="metric">Metric (kg / cm)</option>
			<option value="imperial">Imperial (lbs / inches)</option>
		</select>
	</div>
	<div>
		<label for="growth-weight" class="block text-sm font-medium text-ink-soft mb-1">Weight ({unit === 'metric' ? 'kg' : 'lbs'})</label>
		<input id="growth-weight" type="number" step="0.1" bind:value={weight} class="w-full px-3 py-2 border border-line rounded-md" placeholder="7.2" />
	</div>
	<div>
		<label for="growth-height" class="block text-sm font-medium text-ink-soft mb-1">Length ({unit === 'metric' ? 'cm' : 'inches'})</label>
		<input id="growth-height" type="number" step="0.1" bind:value={height} class="w-full px-3 py-2 border border-line rounded-md" placeholder="64.1" />
	</div>
	<div>
		<label for="growth-head" class="block text-sm font-medium text-ink-soft mb-1">Head Circumference ({unit === 'metric' ? 'cm' : 'inches'})</label>
		<input id="growth-head" type="number" step="0.1" bind:value={head} class="w-full px-3 py-2 border border-line rounded-md" placeholder="40.2" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Measurement'}</button>
</form>
