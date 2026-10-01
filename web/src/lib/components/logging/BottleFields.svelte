<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { Plus } from 'lucide-svelte';
	import { formulasAPI } from '$lib/api';

	export let familyId: string | null;
	export let source: 'breastmilk' | 'formula' = 'breastmilk';
	export let formulaId: number | null = null;
	export let amount = '';

	const dispatch = createEventDispatcher<{ error: { message: string } }>();
	const FORMULA_TYPES = ['standard', 'gentle', 'hypoallergenic', 'hydrolyzed', 'anti-reflux', 'lactose-free', 'soy', 'goat-milk', 'premature', 'sensitive'];

	let formulas: any[] = [];
	let showAdd = false;
	let newName = '';
	let newBrand = '';
	let newType = 'standard';

	async function load() {
		if (!familyId) { formulas = []; return; }
		try {
			const res = await formulasAPI.list(familyId);
			formulas = res.data.formulas || [];
		} catch {
			formulas = [];
		}
	}

	async function add() {
		if (!newName.trim() || !familyId) return;
		try {
			await formulasAPI.create(familyId, { name: newName.trim(), brand: newBrand.trim() || undefined, formulaType: newType });
			newName = ''; newBrand = ''; newType = 'standard';
			showAdd = false;
			await load();
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
				<select id="bottle-formula" bind:value={formulaId} class="flex-1 px-3 py-2 border border-line rounded-md">
					<option value={null}>—</option>
					{#each formulas as f}
						<option value={f.id}>{f.brand} {f.name} · {f.formulaType || 'standard'}</option>
					{/each}
				</select>
				<button type="button" aria-label="Add formula" on:click={() => (showAdd = !showAdd)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md"><Plus class="w-4 h-4" /></button>
			</div>
			{#if showAdd}
				<div class="flex gap-2 mt-2">
					<input type="text" bind:value={newName} placeholder="Formula name" class="flex-1 px-3 py-2 border border-line rounded-md" />
					<input type="text" bind:value={newBrand} placeholder="Brand" class="flex-1 px-3 py-2 border border-line rounded-md" />
					<select bind:value={newType} class="flex-1 px-3 py-2 border border-line rounded-md">
						{#each FORMULA_TYPES as t}<option value={t}>{t}</option>{/each}
					</select>
					<button type="button" on:click={add} class="px-3 py-2 bg-primary text-on-primary rounded-md">Add</button>
				</div>
			{/if}
		</div>
	{/if}
	<div>
		<label for="bottle-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
		<input id="bottle-amount" type="number" step="0.1" min="0" bind:value={amount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
	</div>
</div>
