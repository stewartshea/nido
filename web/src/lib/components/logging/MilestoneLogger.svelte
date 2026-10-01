<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { milestoneAPI } from '$lib/api';
	import { CATEGORIES, milestoneCategoryKey, type MilestoneKind } from '$lib/shared';
	import { loadLoggingOptions, type LoggingOptions } from '$lib/logging/options';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	/** milestones | firsts | routines | medical all store milestone rows. */
	export let kind: MilestoneKind;
	export let familyId: string | null;
	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	const COPY = {
		milestones: { title: 'Log a Milestone', nameLabel: 'Milestone', placeholder: 'Sat up on their own', done: 'Milestone recorded.', save: 'Save Milestone' },
		firsts: { title: 'Log a First', nameLabel: 'First', placeholder: 'First smile', done: 'First recorded.', save: 'Save First' },
		routines: { title: 'Log a Routine', nameLabel: 'Routine', placeholder: 'Morning bath', done: 'Routine recorded.', save: 'Save Routine' },
		medical: { title: 'Log a Medical Entry', nameLabel: 'What happened', placeholder: 'Six-week check-up', done: 'Medical entry recorded.', save: 'Save Entry' },
	} as const;

	$: copy = COPY[kind];
	$: title = kind === 'routines' || kind === 'medical' ? `Log ${CATEGORIES.find((c) => c.id === kind)?.label}` : copy.title;

	let options: LoggingOptions = { get: () => [] };
	let categories: string[] = [];
	let name = '';
	let when = toLocalInput();
	let category = '';
	let busy = false;

	onMount(async () => {
		when = toLocalInput();
		options = await loadLoggingOptions(familyId);
		categories = options.get(kind, milestoneCategoryKey(kind));
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			dispatch('error', { message: `${copy.nameLabel} is required.` });
			return;
		}
		busy = true;
		try {
			await milestoneAPI.create({
				memberId,
				title: name.trim(),
				achievedDate: localInputToIso(when),
				kind,
				category: category || undefined,
			});
			name = ''; category = '';
			dispatch('saved', { message: copy.done });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to record entry.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">{title}</h3>
<form on:submit={save} class="space-y-3">
	<div>
		<label for="milestone-name" class="block text-sm font-medium text-ink-soft mb-1">{copy.nameLabel}</label>
		<input id="milestone-name" type="text" bind:value={name} required class="w-full px-3 py-2 border border-line rounded-md" placeholder={copy.placeholder} />
	</div>
	{#if categories.length > 0}
		<div>
			<label for="milestone-category" class="block text-sm font-medium text-ink-soft mb-1">Category</label>
			<select id="milestone-category" bind:value={category} class="w-full px-3 py-2 border border-line rounded-md">
				<option value="">—</option>
				{#each categories as c}
					<option value={c}>{c}</option>
				{/each}
			</select>
		</div>
	{/if}
	<div>
		<label for="milestone-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
		<input id="milestone-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : copy.save}</button>
</form>
