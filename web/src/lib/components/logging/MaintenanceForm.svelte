<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { assetsAPI } from '$lib/api/assets';
	import { attachmentsAPI } from '$lib/api/attachments';
	import type { InventoryItem, Meter, Schedule } from '$lib/api/types';

	// The maintenance entry form (HOME module 4, issue #68).
	//
	// One entry is one thing done, once. It carries the three facts the rest of
	// the loop reads: the date (schedules), the cost (rollups), and — when the
	// work happened at the asset — the meter reading (meters). Inventory lines
	// are optional and write through the same ledger the manual adjust does.
	export let assetId: number;
	export let meters: Meter[] = [];
	export let inventory: InventoryItem[] = [];
	/** Prefill from a schedule's "Log it" action. */
	export let schedule: Schedule | null = null;
	export let today: string;

	const dispatch = createEventDispatcher<{ save: void; cancel: void }>();

	let task = schedule?.task ?? '';
	let performedAt = today;
	let cost = '';
	let notes = '';
	let meterValues: Record<number, string> = {};
	let consumed: { itemId: number | null; quantity: string }[] = [];
	// Files chosen before the entry exists. They are uploaded to the entry the
	// save creates, which is the only id that can own them — and the anchor a
	// later OCR pass (issue #69) reads text from.
	let files: File[] = [];
	let error = '';
	let saving = false;

	function onFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		files = [...files, ...Array.from(input.files ?? [])];
		input.value = '';
	}

	function removeFile(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	function addConsumed() {
		consumed = [...consumed, { itemId: inventory[0]?.id ?? null, quantity: '1' }];
	}

	function removeConsumed(index: number) {
		consumed = consumed.filter((_, i) => i !== index);
	}

	async function save() {
		error = '';
		if (!task.trim()) {
			error = 'Say what was done.';
			return;
		}
		if (!performedAt) {
			error = 'Pick the date it was done.';
			return;
		}
		const costCents = cost.trim() ? Math.round(Number(cost) * 100) : null;
		if (costCents !== null && (!Number.isFinite(costCents) || costCents < 0)) {
			error = 'The cost must be a number, like 89 or 89.50.';
			return;
		}
		const meterReadings = Object.entries(meterValues)
			.filter(([, value]) => value.trim() !== '')
			.map(([meterId, value]) => ({ meterId: Number(meterId), value: Number(value) }));
		if (meterReadings.some((reading) => !Number.isFinite(reading.value) || reading.value < 0)) {
			error = 'A meter reading must be a number.';
			return;
		}
		const consumedItems = consumed
			.filter((line) => line.itemId !== null && Number(line.quantity) > 0)
			.map((line) => ({ itemId: Number(line.itemId), quantity: Number(line.quantity) }));

		saving = true;
		try {
			const created = await assetsAPI.logMaintenance(assetId, {
				scheduleId: schedule?.id ?? null,
				task: task.trim(),
				performedAt,
				// Empty means "not recorded", not free — the API stores null.
				cost: costCents,
				notes: notes.trim() || null,
				meterReadings: meterReadings.length ? meterReadings : undefined,
				consumedItems: consumedItems.length ? consumedItems : undefined,
			});
			// The receipt is part of the story, so it is attached in the same
			// save. A failed upload must not lose an entry the user just
			// logged: it is best-effort, and the row still lets them add it.
			for (const file of files) {
				await attachmentsAPI.upload('maintenance', created.data.entry.id, file).catch(() => {});
			}
			dispatch('save');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not save the entry.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="bg-surface border border-line rounded-xl shadow-sm p-4 mb-4" data-testid="maintenance-form">
	{#if schedule}
		<p class="text-sm text-ink-soft mb-2">Logging <span class="font-semibold text-ink">{schedule.task}</span></p>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="text-sm text-ink-soft sm:col-span-2">
			What was done
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={task} placeholder="Oil change" />
		</label>
		<label class="text-sm text-ink-soft">
			Date
			<input type="date" class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={performedAt} />
		</label>
		<label class="text-sm text-ink-soft">
			Cost ($, optional)
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={cost} inputmode="decimal" placeholder="89.00" />
		</label>
		<label class="text-sm text-ink-soft sm:col-span-2">
			Notes
			<textarea rows="2" class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={notes} placeholder="Synthetic 5W-30, ask for Ray"></textarea>
		</label>
		<label class="text-sm text-ink-soft sm:col-span-2">
			Receipt or photo (optional)
			<input type="file" accept="image/*,application/pdf" multiple class="w-full mt-1 text-sm text-ink-soft" on:change={onFiles} />
		</label>
		{#if files.length}
			<ul class="sm:col-span-2 -mt-1 space-y-1">
				{#each files as file, index (index)}
					<li class="flex items-center gap-2 text-xs text-ink-soft">
						<span class="truncate">{file.name}</span>
						<button type="button" class="underline shrink-0" on:click={() => removeFile(index)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if meters.length}
		<div class="mt-3">
			<p class="text-sm text-ink-soft">Readings at the time (optional — this is how a meter stays current)</p>
			<div class="grid gap-2 sm:grid-cols-2 mt-1">
				{#each meters as meter (meter.id)}
					<label class="text-sm text-ink-soft">
						{meter.label || meter.unit}
						<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={meterValues[meter.id]} inputmode="decimal" placeholder={meter.lastReading ? String(meter.lastReading.value) : '0'} />
					</label>
				{/each}
			</div>
		</div>
	{/if}

	{#if inventory.length}
		<div class="mt-3">
			<p class="text-sm text-ink-soft">Used from inventory (optional)</p>
			{#each consumed as line, index (index)}
				<div class="flex gap-2 mt-2 items-end">
					<label class="text-sm text-ink-soft flex-1">
						Item
						<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={line.itemId}>
							{#each inventory as item (item.id)}
								<option value={item.id}>{item.name} ({item.quantity} {item.unit})</option>
							{/each}
						</select>
					</label>
					<label class="text-sm text-ink-soft w-24">
						How many
						<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={line.quantity} inputmode="decimal" />
					</label>
					<button type="button" class="text-sm underline text-ink-soft hover:text-ink pb-2" on:click={() => removeConsumed(index)}>Remove</button>
				</div>
			{/each}
			<button type="button" class="mt-2 text-sm underline text-accent" on:click={addConsumed}>+ Add an item</button>
		</div>
	{/if}

	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
	<div class="flex justify-end gap-2 mt-3">
		<button type="button" class="px-4 py-2 rounded-md border border-line text-sm text-ink-soft hover:text-ink" on:click={() => dispatch('cancel')}>Cancel</button>
		<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" disabled={saving} on:click={save}>
			{saving ? 'Saving…' : 'Save entry'}
		</button>
	</div>
</div>
