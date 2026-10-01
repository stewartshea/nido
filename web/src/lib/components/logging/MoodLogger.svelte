<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { moodAPI } from '$lib/api';
	import { loadLoggingOptions, type LoggingOptions } from '$lib/logging/options';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let familyId: string | null;
	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	let options: LoggingOptions = { get: () => [] };
	let mood = '';
	let when = toLocalInput();
	let notes = '';
	let busy = false;

	onMount(async () => {
		when = toLocalInput();
		options = await loadLoggingOptions(familyId);
		mood = options.get('moods', 'mood')[0] ?? 'happy';
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!mood) {
			dispatch('error', { message: 'Pick a mood.' });
			return;
		}
		busy = true;
		try {
			await moodAPI.create({ memberId, mood, recordedAt: localInputToIso(when), notes: notes || undefined });
			notes = '';
			dispatch('saved', { message: 'Mood recorded.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to record mood.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">Log Mood</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<div class="block text-sm font-medium text-ink-soft mb-1">Mood</div>
		<div class="flex flex-wrap gap-2">
			{#each options.get('moods', 'mood') as opt}
				<button type="button" on:click={() => (mood = opt)} class="{mood === opt ? 'bg-accent border-accent text-ink' : 'bg-surface2 text-ink-soft border-line-soft'} px-3 py-2 rounded-full border text-sm">{opt}</button>
			{/each}
		</div>
	</div>
	<div>
		<label for="mood-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="mood-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<div>
		<label for="mood-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
		<input id="mood-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Mood'}</button>
</form>
