<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { assetsAPI } from '$lib/api/assets';
	import type { Meter, Schedule, ScheduleCondition } from '$lib/api/types';

	// The create/edit form for a schedule item (HOME module 3, issue #67).
	//
	// A schedule is one obligation with one or more triggers and a combinator.
	// "Every 8,000 km *or* 6 months, whichever comes first" is the shape this
	// form has to make obvious: add both conditions to ONE schedule and leave
	// `any` selected.
	export let assetId: number;
	export let meters: Meter[] = [];
	export let editing: Schedule | null = null;

	const dispatch = createEventDispatcher<{ save: void; cancel: void }>();

	type DraftCondition =
		| { kind: 'interval'; every: string; unit: 'days' | 'months' }
		| { kind: 'meter'; every: string; meterId: number | null }
		| { kind: 'seasonal'; start: string; end: string };

	function draftFrom(condition: ScheduleCondition): DraftCondition {
		if (condition.kind === 'interval') {
			return { kind: 'interval', every: String(condition.every), unit: condition.unit };
		}
		if (condition.kind === 'meter') {
			return { kind: 'meter', every: String(condition.every), meterId: condition.meterId };
		}
		return { kind: 'seasonal', start: condition.start, end: condition.end };
	}

	function blankCondition(): DraftCondition {
		if (meters.length) return { kind: 'meter', every: '', meterId: meters[0].id };
		return { kind: 'interval', every: '', unit: 'months' };
	}

	let task = editing?.task ?? '';
	let match: 'any' | 'all' = editing?.match ?? 'any';
	let leadDays = String(editing?.leadDays ?? 14);
	let drafts: DraftCondition[] = editing ? editing.conditions.map(draftFrom) : [blankCondition()];
	let error = '';
	let saving = false;

	function addCondition() {
		drafts = [...drafts, blankCondition()];
	}

	function removeCondition(index: number) {
		drafts = drafts.filter((_, i) => i !== index);
	}

	function conditionPayload(draft: DraftCondition): ScheduleCondition | null {
		if (draft.kind === 'interval') {
			const every = Number(draft.every);
			if (!Number.isFinite(every) || every <= 0) return null;
			return { kind: 'interval', every, unit: draft.unit };
		}
		if (draft.kind === 'meter') {
			const every = Number(draft.every);
			if (draft.meterId === null || !Number.isFinite(every) || every <= 0) return null;
			return { kind: 'meter', every, meterId: draft.meterId };
		}
		if (!/^\d{2}-\d{2}$/.test(draft.start) || !/^\d{2}-\d{2}$/.test(draft.end)) return null;
		return { kind: 'seasonal', start: draft.start, end: draft.end };
	}

	async function save() {
		error = '';
		if (!task.trim()) {
			error = 'Name the task — "oil change", "swap to winter tires".';
			return;
		}
		const conditions = drafts.map(conditionPayload);
		if (conditions.some((condition) => condition === null)) {
			error = 'Every trigger needs its amount and its dates (MM-DD).';
			return;
		}
		saving = true;
		try {
			const data = {
				task: task.trim(),
				conditions: conditions as ScheduleCondition[],
				match,
				leadDays: Number(leadDays) || 0,
			};
			if (editing) await assetsAPI.updateSchedule(editing.id, data);
			else await assetsAPI.createSchedule(assetId, data);
			dispatch('save');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not save the schedule.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="bg-surface border border-line rounded-xl shadow-sm p-4 mb-4" data-testid="schedule-form">
	<label class="text-sm text-ink-soft block">
		Task
		<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={task} placeholder="Oil change" />
	</label>

	<div class="mt-3">
		<p class="text-sm text-ink-soft">When is it due?</p>
		{#each drafts as draft, index (index)}
			<div class="mt-2 border border-line-soft rounded-lg p-3 grid gap-2 sm:grid-cols-2">
				<label class="text-sm text-ink-soft">
					Trigger
					<select
						class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink"
						data-testid={`trigger-kind-${index}`}
						value={draft.kind}
						on:change={(event) => {
							const kind = event.currentTarget.value;
							const next = [...drafts];
							next[index] = kind === 'interval'
								? { kind: 'interval', every: '', unit: 'months' }
								: kind === 'meter'
									? { kind: 'meter', every: '', meterId: meters[0]?.id ?? null }
									: { kind: 'seasonal', start: '', end: '' };
							drafts = next;
						}}
					>
						<option value="interval">Every so many days or months</option>
						<option value="meter">Every so many km / hours</option>
						<option value="seasonal">During a season</option>
					</select>
				</label>

				{#if draft.kind === 'interval'}
					<div class="grid grid-cols-2 gap-2">
						<label class="text-sm text-ink-soft">
							Every
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.every} inputmode="numeric" placeholder="6" />
						</label>
						<label class="text-sm text-ink-soft">
							Unit
							<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.unit}>
								<option value="months">months</option>
								<option value="days">days</option>
							</select>
						</label>
					</div>
				{:else if draft.kind === 'meter'}
					<div class="grid grid-cols-2 gap-2">
						<label class="text-sm text-ink-soft">
							Every
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.every} inputmode="decimal" placeholder="8000" />
						</label>
						<label class="text-sm text-ink-soft">
							Meter
							<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.meterId}>
								{#each meters as meter (meter.id)}
									<option value={meter.id}>{meter.label || meter.unit}</option>
								{/each}
							</select>
						</label>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-2">
						<label class="text-sm text-ink-soft">
							From (MM-DD)
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.start} placeholder="11-15" />
						</label>
						<label class="text-sm text-ink-soft">
							Until (MM-DD)
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={draft.end} placeholder="12-15" />
						</label>
					</div>
				{/if}

				{#if drafts.length > 1}
					<button type="button" class="text-sm underline text-ink-soft hover:text-ink text-left sm:col-span-2" on:click={() => removeCondition(index)}>
						Remove this trigger
					</button>
				{/if}
			</div>
		{/each}
		<button type="button" class="mt-2 text-sm underline text-accent" on:click={addCondition}>+ Add another trigger</button>
	</div>

	<div class="grid gap-3 sm:grid-cols-2 mt-3">
		<label class="text-sm text-ink-soft">
			With several triggers
			<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={match}>
				<option value="any">Whichever comes first</option>
				<option value="all">Only when all are due</option>
			</select>
		</label>
		<label class="text-sm text-ink-soft">
			Warn me (days early)
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={leadDays} inputmode="numeric" />
		</label>
	</div>

	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
	<div class="flex justify-end gap-2 mt-3">
		<button type="button" class="px-4 py-2 rounded-md border border-line text-sm text-ink-soft hover:text-ink" on:click={() => dispatch('cancel')}>Cancel</button>
		<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" disabled={saving} on:click={save}>
			{saving ? 'Saving…' : editing ? 'Save schedule' : 'Add schedule'}
		</button>
	</div>
</div>
