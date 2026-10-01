<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { vaccinationAPI } from '$lib/api';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	let name = '';
	let when = toLocalInput();
	let notes = '';
	let busy = false;

	onMount(() => { when = toLocalInput(); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			dispatch('error', { message: 'Vaccine name is required.' });
			return;
		}
		busy = true;
		try {
			await vaccinationAPI.create({ memberId, name: name.trim(), dateGiven: localInputToIso(when), notes: notes || undefined });
			name = ''; notes = '';
			dispatch('saved', { message: 'Vaccine recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to record vaccine.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">Log a Vaccine</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<label for="vaccine-name" class="block text-sm font-medium text-ink-soft mb-1">Vaccine name</label>
		<input id="vaccine-name" type="text" bind:value={name} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Hepatitis B, DTaP…" />
	</div>
	<div>
		<label for="vaccine-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="vaccine-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<div>
		<label for="vaccine-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
		<input id="vaccine-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Vaccine'}</button>
</form>
