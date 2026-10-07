<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { attachmentsAPI, milestoneAPI } from '$lib/api';
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
		// Shared with pets and adults; the wording avoids assuming a baby.
		medication: { title: 'Log Medication', nameLabel: 'Medication', placeholder: 'Flea treatment', done: 'Medication recorded.', save: 'Save Medication' },
		vitamins: { title: 'Log Vitamins', nameLabel: 'Vitamin', placeholder: 'Vitamin D', done: 'Vitamins recorded.', save: 'Save Vitamins' },
		appointments: { title: 'Log an Appointment', nameLabel: 'Appointment', placeholder: 'Vet check-up', done: 'Appointment recorded.', save: 'Save Appointment' },
		grooming: { title: 'Log Grooming', nameLabel: 'Grooming', placeholder: 'Nail trim', done: 'Grooming recorded.', save: 'Save Grooming' },
	} as const;

	$: copy = COPY[kind];
	// Kinds whose copy already reads naturally as a title keep it; the rest are
	// titled from the category label so a new kind cannot fall through to a
	// stale heading.
	const TITLED_BY_CATEGORY: MilestoneKind[] = ['routines', 'medical', 'medication', 'vitamins', 'appointments', 'grooming'];
	$: title = TITLED_BY_CATEGORY.includes(kind) ? `Log ${CATEGORIES.find((c) => c.id === kind)?.label}` : copy.title;

	let options: LoggingOptions = { get: () => [] };
	let categories: string[] = [];
	/** Attached after the record is created, because it needs the record's id. */
	let file: File | null = null;

	function pickFile(e: Event) {
		file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
	}
	let name = '';
	let when = toLocalInput();
	let category = '';
	let notes = '';
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
			const created = await milestoneAPI.create({
				memberId,
				title: name.trim(),
				achievedDate: localInputToIso(when),
				kind,
				category: category || undefined,
				description: notes || undefined,
			});
			// The record has to exist before a file can hang off it, so the upload
			// follows the create. A failed upload must not lose the record, so it is
			// reported but not thrown.
			let attachNote = '';
			const id = created?.data?.milestone?.id;
			if (file && id) {
				try {
					await attachmentsAPI.upload('milestone', id, file);
				} catch {
					attachNote = ' The record was saved, but the file did not upload.';
				}
			}
			name = ''; category = ''; notes = ''; file = null;
			dispatch('saved', { message: copy.done + attachNote });
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
	<div>
		<label for="milestone-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
		<input id="milestone-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="Symptoms, dose, advice given…" />
	</div>
	<div class="mb-4">
		<label for="milestone-file" class="block text-sm font-medium text-ink-soft mb-1">Attachment (optional)</label>
		<input
			id="milestone-file"
			type="file"
			on:change={pickFile}
			class="w-full text-sm text-ink-soft file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-surface2 file:text-ink file:font-semibold"
		/>
		<p class="text-xs text-ink-soft mt-1">A report, a scan, a photo. Stored encrypted with the rest of this family's data.</p>
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : copy.save}</button>
</form>
