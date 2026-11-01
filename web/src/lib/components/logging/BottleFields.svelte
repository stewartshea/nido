<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { Plus } from 'lucide-svelte';
	import { inventoryAPI } from '$lib/api/inventory';
	import type { InventoryItem } from '$lib/api/types';

	export let familyId: string | null;
	export let source: 'breastmilk' | 'formula' = 'breastmilk';
	/** The inventory container the bottle drew from — where the picker now reads. */
	export let formulaItemId: number | null = null;
	export let amount = '';
	/**
	 * The member's recent feedings, newest first — where "the formula we last
	 * fed" begins. Parent owns recent; this component only reads it.
	 */
	export let recent: any[] = [];

	const dispatch = createEventDispatcher<{ error: { message: string } }>();

	// Formula packs are sold by oz and kept by oz; a picker option is a can, not a crate.
	const FORMULA_ITEM_CATEGORY = 'formula';

	let items: InventoryItem[] = [];
	let showAdd = false;
	let newName = '';
	/** The whole container, oz — what goes in to pack_size on the item. */
	let newPackSize = '';
	/** Once the parent (or the user) has chosen, auto-prefill stops arguing. */
	let userPicked = false;

	/** The family's formula cans, active only, oldest first. */
	$: formulaItems = items.filter((i) => i.category === FORMULA_ITEM_CATEGORY && i.active);

	/**
	 * The formula the last bottle fed: the newest feeding naming a container,
	 * with the legacy `formula_id` as a fallback the backfill migration made
	 * resolvable. Guarded by `userPicked` — fixing a wrong prefill is the
	 * user's choice, and a parent re-render never fights them for the field.
	 */
	$: lastUsedItemId = (() => {
		for (const f of recent) {
			const id = f.formula_item_id ?? f.formulaItemId;
			if (id != null) return Number(id);
		}
		return null;
	})();

	$: if (!userPicked && formulaItemId === null) {
		if (lastUsedItemId != null && formulaItems.some((i) => i.id === lastUsedItemId)) {
			formulaItemId = lastUsedItemId;
		} else if (formulaItems.length === 1) {
			// Exactly one can stocked needs no picker: it is the answer until a second can appears.
			formulaItemId = formulaItems[0].id;
		}
	}

	/** Label shown in the picker: the can and what's left of it. */
	function optionLabel(item: InventoryItem): string {
		const left = Number(item.quantity);
		const oz = Number.isFinite(left) ? left : 0;
		return `${item.name} · ${oz} oz left`;
	}

	async function load() {
		if (!familyId) { items = []; return; }
		try {
			const res = await inventoryAPI.list();
			items = res.data.items || [];
		} catch {
			items = [];
		}
	}

	async function add() {
		if (!newName.trim() || !familyId) return;
		const pack = Number(newPackSize);
		if (!Number.isFinite(pack) || pack <= 0) {
			dispatch('error', { message: 'Set the container size so the tracker knows what a full can is.' });
			return;
		}
		try {
			// The can arrives wired to the bottle feed: a feed naming it
			// subtracts the oz the bottle held. The rule says the
			// relationship; the route pins the rule to this container.
			const res = await inventoryAPI.create({
				name: newName.trim(),
				category: FORMULA_ITEM_CATEGORY,
				unit: 'oz',
				packSize: pack,
				quantity: pack,
				consumptionRule: {
					sourceCategory: 'feeds',
					match: 'all',
					conditions: [{ attr: 'type', values: ['bottle', 'formula'] }],
					unitsPerUse: 1,
					amountPerUse: 1,
					amountAttr: 'amountOz',
				},
			});
			const made = res.data.item as InventoryItem;
			newName = '';
			newPackSize = '';
			showAdd = false;
			await load();
			userPicked = true;
			// A newly added can is the one being fed: select it right away.
			if (made?.id) formulaItemId = made.id;
		} catch (e: any) {
			dispatch('error', { message: e?.response?.data?.error || 'Failed to add formula.' });
		}
	}

	onMount(load);
</script>

<div class="space-y-3">
	<div>
		<label for="bottle-source" class="block text-sm font-medium text-ink-soft mb-1">Bottle contents</label>
		<select id="bottle-source" bind:value={source} class="w-full px-3 py-2 border border-line rounded-md">
			<option value="breastmilk">Breast milk</option>
			<option value="formula">Formula</option>
		</select>
	</div>
	{#if source === 'formula'}
		<div>
			<label for="bottle-formula" class="block text-sm font-medium text-ink-soft mb-1">Formula</label>
			<div class="flex gap-2">
				<select id="bottle-formula" bind:value={formulaItemId} on:change={() => (userPicked = true)} class="flex-1 px-3 py-2 border border-line rounded-md">
					<option value={null}>—</option>
					{#each formulaItems as f (f.id)}
						<option value={f.id}>{optionLabel(f)}</option>
					{/each}
				</select>
				<button type="button" aria-label="Add formula" on:click={() => (showAdd = !showAdd)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md"><Plus class="w-4 h-4" /></button>
			</div>
			{#if showAdd}
				<div class="flex flex-wrap gap-2 mt-2">
					<input type="text" bind:value={newName} placeholder="Formula (e.g. Enfamil NeuroPro)" class="flex-1 min-w-40 px-3 py-2 border border-line rounded-md" />
					<input type="number" step="0.1" min="0" bind:value={newPackSize} placeholder="Can size (oz)" class="w-32 px-3 py-2 border border-line rounded-md" />
					<button type="button" on:click={add} class="px-3 py-2 bg-primary text-on-primary rounded-md">Add can to inventory</button>
				</div>
				<p class="text-xs text-ink-soft mt-1">A new can starts full. Each bottle subtracts the oz it held, and the can shows up in Inventory too.</p>
			{/if}
		</div>
	{/if}
	<div>
		<label for="bottle-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
		<input id="bottle-amount" type="number" step="0.1" min="0" bind:value={amount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
	</div>
</div>
