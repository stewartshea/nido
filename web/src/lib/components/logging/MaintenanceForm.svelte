<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { assetsAPI } from '$lib/api/assets';
	import { attachmentsAPI } from '$lib/api/attachments';
	import AttachmentGallery from './AttachmentGallery.svelte';
	import type { InventoryItem, MaintenanceEntry, Meter, ReceiptOcrPreviewPage, Schedule } from '$lib/api/types';

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
	/** An existing entry to edit in place, instead of creating a new one. */
	export let editing: MaintenanceEntry | null = null;
	export let today: string;

	const dispatch = createEventDispatcher<{ save: void; cancel: void }>();

	let task = editing?.task ?? schedule?.task ?? '';
	let performedAt = editing?.performedAt ?? today;
	let cost = editing?.cost != null ? (editing.cost / 100).toFixed(2) : '';
	let notes = editing?.notes ?? '';
	let matchedScheduleId: number | null = editing?.scheduleId ?? schedule?.id ?? null;
	let meterValues: Record<number, string> = {};
	let consumed: { itemId: number | null; quantity: string }[] = [];
	// Files chosen before the entry exists. They are uploaded to the entry the
	// save creates, which is the only id that can own them — and the anchor a
	// later OCR pass (issue #69) reads text from.
	let files: File[] = [];
	// A thumbnail per staged image (empty string for non-images), kept index-
	// aligned with `files` so the receipt is visible before it is saved.
	let previewUrls: string[] = [];
	// The OCR result each staged page already produced during preview, so save()
	// can hand the API the text instead of running tesseract a second time.
	let previewedPages: ReceiptOcrPreviewPage[] = [];
	let error = '';
	let saving = false;
	// Receipt OCR prefill (HOME receipt capture): reading the chosen pages to
	// fill the fields below, and whether a prefill happened.
	let scanningReceipt = false;
	let ocrNotice = '';

	// The identity of the thing being logged. When it changes (a different
	// schedule, a different entry, or a fresh one) the fields are rebuilt, so a
	// form left open on one entry never keeps another's values.
	let initializedForKey = '';
	$: {
		const key = editing ? `edit-${editing.id}` : schedule ? `sched-${schedule.id}` : 'new';
		if (key !== initializedForKey) {
			initializedForKey = key;
			task = editing?.task ?? schedule?.task ?? '';
			performedAt = editing?.performedAt ?? today;
			cost = editing?.cost != null ? (editing.cost / 100).toFixed(2) : '';
			notes = editing?.notes ?? '';
			matchedScheduleId = editing?.scheduleId ?? schedule?.id ?? null;
			meterValues = {};
			consumed = [];
			files = [];
			for (const url of previewUrls) URL.revokeObjectURL(url);
			previewUrls = [];
			previewedPages = [];
			error = '';
			ocrNotice = '';
		}
	}

	async function onFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const rawFiles = Array.from(input.files ?? []);
		// Clear the input first, but clone the blobs into memory before doing
		// so: WebKit/Safari invalidates the File reference once the input's
		// value is reset, which used to leave an empty, unusable attachment.
		input.value = '';
		if (!rawFiles.length) return;
		const cloned: File[] = [];
		for (const raw of rawFiles) {
			const buf = await raw.arrayBuffer();
			cloned.push(new File([buf], raw.name || 'receipt.jpg', { type: raw.type || 'image/jpeg' }));
		}
		files = [...files, ...cloned];
		for (const file of cloned) {
			previewUrls = [...previewUrls, file.type.startsWith('image/') ? URL.createObjectURL(file) : ''];
		}
		// Read the receipt(s) to prefill whatever the user has not typed yet.
		// Only empty/default fields are touched, so a typed value always wins.
		scanningReceipt = true;
		ocrNotice = '';
		try {
			const res = await assetsAPI.previewMaintenanceReceipt(assetId, files);
			// `pages` is index-aligned with `files`, so keep it for save().
			previewedPages = res.data.pages;
			if (!task.trim() && res.data.hints.task) task = res.data.hints.task;
			if (matchedScheduleId === null && res.data.hints.scheduleId !== null) {
				matchedScheduleId = res.data.hints.scheduleId;
			}
			if (res.data.hints.performedAt && (!performedAt || performedAt === today)) {
				performedAt = res.data.hints.performedAt;
			}
			if (!cost.trim() && res.data.hints.cost !== null) {
				cost = (res.data.hints.cost / 100).toFixed(2);
			}
			if (!notes.trim() && res.data.hints.notes) notes = res.data.hints.notes;
			ocrNotice = 'Prefilled from receipt OCR — review and save.';
		} catch {
			// A receipt that cannot be read is not an error: the user can just
			// fill the form in by hand, and the files still attach on save.
		} finally {
			scanningReceipt = false;
		}
	}

	function removeFile(index: number) {
		const url = previewUrls[index];
		if (url) URL.revokeObjectURL(url);
		files = files.filter((_, i) => i !== index);
		previewUrls = previewUrls.filter((_, i) => i !== index);
		previewedPages = previewedPages.filter((_, i) => i !== index);
	}

	onDestroy(() => {
		for (const url of previewUrls) URL.revokeObjectURL(url);
	});

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
			if (editing) {
				await assetsAPI.updateEntry(editing.id, {
					scheduleId: matchedScheduleId,
					task: task.trim(),
					performedAt,
					cost: costCents,
					notes: notes.trim() || null,
				});
				// Attach the receipt(s) before closing: awaiting here (instead of
				// swallowing the error) is what guarantees the photo is actually
				// on the entry when the list reloads.
				for (let i = 0; i < files.length; i += 1) {
					const file = files[i];
					if (!file) continue;
					await attachmentsAPI.upload('maintenance', editing.id, file, previewedPages[i]);
				}
				dispatch('save');
				return;
			}
			const created = await assetsAPI.logMaintenance(assetId, {
				scheduleId: matchedScheduleId,
				task: task.trim(),
				performedAt,
				// Empty means "not recorded", not free — the API stores null.
				cost: costCents,
				notes: notes.trim() || null,
				meterReadings: meterReadings.length ? meterReadings : undefined,
				consumedItems: consumedItems.length ? consumedItems : undefined,
			});
			// The receipt is part of the story, so it is attached in the same
			// save — awaited, so the photo is on the entry before the list
			// reloads. A failure surfaces instead of being silently dropped.
			for (let i = 0; i < files.length; i += 1) {
				const file = files[i];
				if (!file) continue;
				await attachmentsAPI.upload('maintenance', created.data.entry.id, file, previewedPages[i]);
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
	{#if editing && editing.attachments?.length}
		<!-- Already on the entry (a receipt auto-logged from a photo, or an
		     earlier upload): show it immediately so editing never looks empty. -->
		<div class="mb-3">
			<AttachmentGallery
				refType="maintenance"
				refId={editing.id}
				attachments={editing.attachments}
				title="Attached receipt & photos"
				accept="image/*,application/pdf"
				compact
				on:change={() => dispatch('save')}
			/>
		</div>
	{/if}
	{#if schedule}
		<p class="text-sm text-ink-soft mb-2">Logging <span class="font-semibold text-ink">{schedule.task}</span></p>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="text-sm text-ink-soft sm:col-span-2">
			Receipt or photo (optional — select 1 or more pages to auto-fill)
			<input type="file" accept="image/*,application/pdf" multiple class="w-full mt-1 text-sm text-ink-soft" on:change={onFiles} disabled={scanningReceipt} />
		</label>
		{#if scanningReceipt}
			<p class="sm:col-span-2 -mt-1 text-xs text-ink-soft">Reading receipt…</p>
		{:else if ocrNotice}
			<p class="sm:col-span-2 -mt-1 text-xs text-accent" role="status">{ocrNotice}</p>
		{/if}
		{#if files.length}
			<ul class="sm:col-span-2 -mt-1 space-y-2">
				{#each files as file, index (index)}
					<li class="flex items-center gap-2 text-xs text-ink-soft">
						{#if previewUrls[index]}
							<img src={previewUrls[index]} alt={file.name} class="w-14 h-14 rounded-md object-cover border border-line-soft shrink-0" />
						{/if}
						<span class="truncate">{file.name}</span>
						<button type="button" class="underline shrink-0 ml-auto" on:click={() => removeFile(index)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}
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
