<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { medicationAPI, type Medication, type MedicationFrequency } from '$lib/api';
	import { apiError } from '$lib/logging/recent';
	import { formatMinutes } from '$lib/logging/format';
	import { Pill, Plus, Check, Pencil, Ban, RotateCcw, Trash2 } from 'lucide-svelte';

	/**
	 * The medication list, which is what makes a reminder possible without
	 * anyone logging each dose by hand: the frequency is the schedule, and
	 * "Taken" records the dose as an ordinary event so history is unchanged.
	 *
	 * A standing list, not part of the activity feed — but the doses it writes
	 * do appear there, and the parent refreshes on `changed`.
	 */
	export let memberId: number;

	const dispatch = createEventDispatcher<{ changed: void }>();

	let medications: Medication[] = [];
	let frequencies: MedicationFrequency[] = [];
	let loading = true;
	let error = '';
	let notice = '';
	let busyId: number | null = null;

	// The add/edit form. Editing reuses it rather than a second dialog.
	let formOpen = false;
	let editing: Medication | null = null;
	let fName = '';
	let fDose = '';
	let fFrequency = 'once_daily';
	let fStart = '';
	let fEnd = '';
	let fNotes = '';
	let saving = false;

	const today = () => new Date().toISOString().slice(0, 10);

	$: active = medications.filter((m) => m.active);
	$: stopped = medications.filter((m) => !m.active);
	$: dueCount = active.filter((m) => m.due).length;

	async function load() {
		if (!memberId) return;
		loading = true;
		error = '';
		try {
			const res = await medicationAPI.list(memberId);
			medications = res.data.medications ?? [];
			frequencies = res.data.frequencies ?? [];
			if (!fFrequency || !frequencies.some((f) => f.id === fFrequency)) {
				fFrequency = frequencies[0]?.id ?? 'once_daily';
			}
		} catch (err: any) {
			error = apiError(err, 'Failed to load medications.');
		} finally {
			loading = false;
		}
	}

	$: if (memberId) load();

	function openAdd() {
		editing = null;
		fName = '';
		fDose = '';
		fFrequency = frequencies[0]?.id ?? 'once_daily';
		fStart = today();
		fEnd = '';
		fNotes = '';
		error = '';
		formOpen = true;
	}

	function openEdit(med: Medication) {
		editing = med;
		fName = med.name;
		fDose = med.dose ?? '';
		fFrequency = med.frequency;
		fStart = med.startDate;
		fEnd = med.endDate ?? '';
		fNotes = med.notes ?? '';
		error = '';
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
		editing = null;
	}

	async function save() {
		if (!fName.trim()) {
			error = 'Give the medication a name.';
			return;
		}
		saving = true;
		error = '';
		try {
			const payload = {
				name: fName.trim(),
				dose: fDose.trim() || undefined,
				frequency: fFrequency,
				startDate: fStart || today(),
				endDate: fEnd || undefined,
				notes: fNotes.trim() || undefined,
			};
			if (editing) {
				await medicationAPI.update(editing.id, {
					name: payload.name,
					dose: payload.dose ?? null,
					frequency: payload.frequency,
					startDate: payload.startDate,
					endDate: payload.endDate ?? null,
					notes: payload.notes ?? null,
				});
				notice = `${payload.name} updated.`;
			} else {
				await medicationAPI.create({ memberId, ...payload });
				notice = `${payload.name} added.`;
			}
			closeForm();
			await load();
			dispatch('changed');
		} catch (err: any) {
			error = apiError(err, 'Failed to save medication.');
		} finally {
			saving = false;
		}
	}

	async function takeDose(med: Medication) {
		busyId = med.id;
		error = '';
		try {
			await medicationAPI.dose(med.id);
			notice = `${med.name} taken.`;
			await load();
			dispatch('changed');
		} catch (err: any) {
			error = apiError(err, 'Failed to record the dose.');
		} finally {
			busyId = null;
		}
	}

	async function setActive(med: Medication, active: boolean) {
		busyId = med.id;
		error = '';
		try {
			await medicationAPI.update(med.id, { active });
			notice = active ? `${med.name} restarted.` : `${med.name} stopped.`;
			await load();
			dispatch('changed');
		} catch (err: any) {
			error = apiError(err, 'Failed to update the medication.');
		} finally {
			busyId = null;
		}
	}

	async function remove(med: Medication) {
		if (!confirm(`Delete ${med.name}? Doses already recorded stay in the history.`)) return;
		busyId = med.id;
		try {
			await medicationAPI.delete(med.id);
			notice = `${med.name} deleted.`;
			await load();
			dispatch('changed');
		} catch (err: any) {
			error = apiError(err, 'Failed to delete the medication.');
		} finally {
			busyId = null;
		}
	}

	/** How long ago the last dose was, or how long until the next is due. */
	function doseTiming(med: Medication): string {
		const sinceLast = med.lastDoseAt ? formatMinutes(Date.now() - new Date(med.lastDoseAt).getTime()) : '';
		if (med.frequency === 'as_needed') {
			return med.lastDoseAt ? `last taken ${sinceLast} ago` : 'as needed';
		}
		if (med.due) {
			if (!med.lastDoseAt) return 'not taken yet';
			return `overdue — last taken ${sinceLast} ago`;
		}
		if (med.nextDueAt) {
			const ms = new Date(med.nextDueAt).getTime() - Date.now();
			if (ms > 0) return `next in ${formatMinutes(ms)}`;
		}
		return med.lastDoseAt ? `last taken ${sinceLast} ago` : '';
	}
</script>

<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft" data-testid="medications-panel">
	<div class="flex items-center justify-between mb-1">
		<h3 class="text-lg font-display font-semibold flex items-center gap-2">
			<Pill class="w-4 h-4 text-ink-soft" aria-hidden="true" /> Medications
			{#if dueCount > 0}
				<span class="text-xs font-semibold bg-accent text-on-accent px-2 py-0.5 rounded-full">{dueCount} due</span>
			{/if}
		</h3>
		<button type="button" on:click={openAdd} class="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
			<Plus class="w-4 h-4" aria-hidden="true" /> Add
		</button>
	</div>
	<p class="text-xs text-ink-soft mb-3">A standing list. The schedule is what lets Nido remind you, rather than you logging every dose by hand.</p>

	{#if error}
		<p class="text-sm text-danger-text mb-2">{error}</p>
	{/if}
	{#if notice}
		<p class="text-sm text-ink-soft mb-2">{notice}</p>
	{/if}

	{#if formOpen}
		<form on:submit|preventDefault={save} class="bg-surface2 rounded-lg border border-line p-3 mb-4 space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="med-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
					<input id="med-name" type="text" bind:value={fName} class="w-full px-3 py-2 border border-line rounded-md" placeholder="Atenolol" required />
				</div>
				<div>
					<label for="med-dose" class="block text-sm font-medium text-ink-soft mb-1">Dose</label>
					<input id="med-dose" type="text" bind:value={fDose} class="w-full px-3 py-2 border border-line rounded-md" placeholder="50 mg" />
				</div>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div>
					<label for="med-frequency" class="block text-sm font-medium text-ink-soft mb-1">Frequency</label>
					<select id="med-frequency" bind:value={fFrequency} class="w-full px-3 py-2 border border-line rounded-md">
						{#each frequencies as f}
							<option value={f.id}>{f.label}</option>
						{/each}
					</select>
				</div>
				<div>
					<label for="med-start" class="block text-sm font-medium text-ink-soft mb-1">Start</label>
					<input id="med-start" type="date" bind:value={fStart} class="w-full px-3 py-2 border border-line rounded-md" />
				</div>
				<div>
					<label for="med-end" class="block text-sm font-medium text-ink-soft mb-1">End (optional)</label>
					<input id="med-end" type="date" bind:value={fEnd} class="w-full px-3 py-2 border border-line rounded-md" />
				</div>
			</div>
			<div>
				<label for="med-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
				<input id="med-notes" type="text" bind:value={fNotes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="With breakfast" />
			</div>
			<div class="flex justify-end gap-2">
				<button type="button" on:click={closeForm} class="px-3 py-2 text-sm bg-surface text-ink-soft rounded-md border border-line-soft">Cancel</button>
				<button type="submit" disabled={saving} class="px-4 py-2 text-sm bg-primary text-on-primary rounded-md disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Save changes' : 'Add medication'}</button>
			</div>
		</form>
	{/if}

	{#if loading && medications.length === 0}
		<p class="text-sm text-ink-soft py-2">Loading…</p>
	{:else if medications.length === 0 && !formOpen}
		<p class="text-sm text-ink-soft py-2">No medications yet — add one to set a schedule.</p>
	{:else}
		<ul class="divide-y divide-line-soft">
			{#each active as med (med.id)}
				<li class="py-3 flex items-start gap-3">
					<div class="flex-1 min-w-0">
						<p class="font-semibold text-ink text-sm">
							{med.name}{#if med.dose}<span class="text-ink-soft font-normal"> · {med.dose}</span>{/if}
						</p>
						<p class="text-xs text-ink-soft">{med.frequencyLabel} · {doseTiming(med)}</p>
						{#if med.notes}<p class="text-xs text-ink-soft truncate">{med.notes}</p>{/if}
					</div>
					<div class="flex items-center gap-1 shrink-0">
						{#if med.due}
							<button type="button" on:click={() => takeDose(med)} disabled={busyId === med.id} class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-primary text-on-primary rounded-md disabled:opacity-50" aria-label="Mark {med.name} taken">
								<Check class="w-3.5 h-3.5" aria-hidden="true" /> Taken
							</button>
						{:else}
							<button type="button" on:click={() => takeDose(med)} disabled={busyId === med.id} class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-line-soft text-ink rounded-md hover:bg-surface2 disabled:opacity-50" aria-label="Mark {med.name} taken">
								<Check class="w-3.5 h-3.5" aria-hidden="true" /> Taken
							</button>
						{/if}
						<button type="button" on:click={() => openEdit(med)} class="p-2 rounded-md text-accent hover:bg-surface2" aria-label="Edit {med.name}">
							<Pencil class="w-4 h-4" />
						</button>
						<button type="button" on:click={() => setActive(med, false)} disabled={busyId === med.id} class="p-2 rounded-md text-ink-soft hover:bg-surface2" aria-label="Stop {med.name}">
							<Ban class="w-4 h-4" />
						</button>
					</div>
				</li>
			{/each}
		</ul>

		{#if stopped.length > 0}
			<details class="mt-2">
				<summary class="text-xs text-ink-soft cursor-pointer py-1">Stopped ({stopped.length})</summary>
				<ul class="divide-y divide-line-soft">
					{#each stopped as med (med.id)}
						<li class="py-2 flex items-center gap-3 opacity-70">
							<div class="flex-1 min-w-0">
								<p class="text-sm text-ink truncate">{med.name}{#if med.dose} · {med.dose}{/if}</p>
								<p class="text-xs text-ink-soft">{med.frequencyLabel}{#if med.endDate} · ended {med.endDate}{/if}</p>
							</div>
							<button type="button" on:click={() => setActive(med, true)} disabled={busyId === med.id} class="p-2 rounded-md text-accent hover:bg-surface2" aria-label="Restart {med.name}">
								<RotateCcw class="w-4 h-4" />
							</button>
							<button type="button" on:click={() => remove(med)} disabled={busyId === med.id} class="p-2 rounded-md text-danger-text hover:bg-surface2" aria-label="Delete {med.name}">
								<Trash2 class="w-4 h-4" />
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</div>
