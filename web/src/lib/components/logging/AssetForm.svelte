<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { assetsAPI } from '$lib/api/assets';
	import type { Asset, AssetCategoryId } from '$lib/api/types';

	// The create/edit form for a home asset. Create starts from just a name
	// and a category; the identity quartet is optional because it exists to
	// key manuals and suggestions (PRD §7.4/§7.5), not to gate saving.
	export let editing: Asset | null = null;
	// The family's residences, for the "lives at" picker. Empty = none loaded
	// yet; the select hides and family-wide is the default.
	export let homes: { id: number; name: string }[] = [];

	const dispatch = createEventDispatcher<{ save: void; cancel: void }>();

	let name = editing?.name ?? '';
	let category: AssetCategoryId = editing?.category ?? 'vehicle';
	// null = family-wide ("ours"), not a data loss — the default.
	let homeId: number | null = editing?.homeId ?? null;
	let manufacturer = editing?.identity.manufacturer ?? '';
	let model = editing?.identity.model ?? '';
	let modelYear = editing?.identity.modelYear ? String(editing.identity.modelYear) : '';
	let serial = editing?.identity.serial ?? '';
	let acquiredAt = editing?.acquiredAt ?? '';
	let purchasePrice = editing?.purchasePrice !== null && editing?.purchasePrice !== undefined ? String(editing.purchasePrice / 100) : '';
	let notes = editing?.notes ?? '';
	let error = '';
	let saving = false;

	$: identityPhrase = [manufacturer, model, modelYear].filter(Boolean).join(' ');

	async function save() {
		if (!name.trim()) {
			error = 'Give the asset a name.';
			return;
		}
		saving = true;
		error = '';
		const year = Number(modelYear);
		const data = {
			name: name.trim(),
			category,
			homeId,
			identity: {
				manufacturer: manufacturer.trim() || null,
				model: model.trim() || null,
				modelYear: modelYear.trim() ? year : null,
				serial: serial.trim() || null,
			},
			// Empty means "not set", not zero — the API takes null for unset.
			acquiredAt: acquiredAt || null,
			purchasePrice: purchasePrice.trim() ? Math.round(Number(purchasePrice) * 100) : null,
			notes: notes.trim() || null,
		};
		try {
			if (editing) await assetsAPI.update(editing.id, data);
			else await assetsAPI.create(data);
			dispatch('save');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not save the asset.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="bg-surface border border-line rounded-xl shadow-sm p-4 mb-4" data-testid="asset-form">
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="text-sm text-ink-soft sm:col-span-2">
			Name
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={name} placeholder="The Mazda" />
		</label>
		<label class="text-sm text-ink-soft">
			Category
			<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={category}>
				<option value="vehicle">Vehicle</option>
				<option value="appliance">Appliance</option>
				<option value="hvac">Heating &amp; cooling</option>
				<option value="structure">Structures &amp; improvements</option>
				<option value="outdoor">Yard &amp; outdoor</option>
				<option value="other">Other</option>
			</select>
		</label>
		{#if homes.length > 0}
			<label class="text-sm text-ink-soft">
				Lives at
				<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={homeId}>
					<option value={null}>Family-wide — no one home</option>
					{#each homes as home (home.id)}
						<option value={home.id}>{home.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="text-sm text-ink-soft">
			Acquired (YYYY-MM-DD)
			<input type="date" class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={acquiredAt} />
		</label>
		<div class="sm:col-span-2">
			<p class="text-xs text-ink-soft mb-1">Identity — optional; it keys manuals and suggestions{#if identityPhrase} ({identityPhrase}){/if}</p>
			<div class="grid gap-3 sm:grid-cols-2">
				<input class="w-full px-3 py-2 border border-line rounded-md bg-page text-ink text-sm" bind:value={manufacturer} placeholder="Manufacturer" />
				<input class="w-full px-3 py-2 border border-line rounded-md bg-page text-ink text-sm" bind:value={model} placeholder="Model" />
				<input class="w-full px-3 py-2 border border-line rounded-md bg-page text-ink text-sm" bind:value={modelYear} inputmode="numeric" placeholder="Model year" />
				<input class="w-full px-3 py-2 border border-line rounded-md bg-page text-ink text-sm" bind:value={serial} placeholder="Serial / VIN" />
			</div>
		</div>
		<label class="text-sm text-ink-soft">
			Purchase price ($)
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={purchasePrice} inputmode="decimal" placeholder="27400" />
		</label>
		<label class="text-sm text-ink-soft sm:col-span-2">
			Notes
			<textarea rows="2" class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={notes} placeholder="VIN ends 4417"></textarea>
		</label>
	</div>
	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
	<div class="flex justify-end gap-2 mt-3">
		<button type="button" class="px-4 py-2 rounded-md border border-line text-sm text-ink-soft hover:text-ink" on:click={() => dispatch('cancel')}>Cancel</button>
		<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" disabled={saving} on:click={save}>
			{saving ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
		</button>
	</div>
</div>