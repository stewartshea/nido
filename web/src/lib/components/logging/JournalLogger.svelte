<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { journalAPI } from '$lib/api';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	let title = '';
	let body = '';
	let when = toLocalInput();
	let busy = false;

	onMount(() => { when = toLocalInput(); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim() && !body.trim()) {
			dispatch('error', { message: 'Add a title or a note.' });
			return;
		}
		busy = true;
		try {
			await journalAPI.create({ memberId, title: title.trim() || undefined, body: body.trim() || undefined, entryDate: localInputToIso(when) });
			title = ''; body = '';
			dispatch('saved', { message: 'Journal entry saved.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to save journal entry.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">New Journal Entry</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<label for="journal-title" class="block text-sm font-medium text-ink-soft mb-1">Title</label>
		<input id="journal-title" type="text" bind:value={title} class="w-full px-3 py-2 border border-line rounded-md" placeholder="First walk, doctor visit…" />
	</div>
	<div>
		<label for="journal-body" class="block text-sm font-medium text-ink-soft mb-1">Note</label>
		<textarea id="journal-body" bind:value={body} rows="4" class="w-full px-3 py-2 border border-line rounded-md" placeholder="What happened today…"></textarea>
	</div>
	<div>
		<label for="journal-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="journal-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Entry'}</button>
</form>
