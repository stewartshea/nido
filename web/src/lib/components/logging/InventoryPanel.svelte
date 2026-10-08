<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { inventoryAPI, type InventoryItem, type InventoryAlert, type DiaperBand } from '$lib/api';
	import { defaultMemberId } from '$lib/shared';

	export let members: { id: number | string; name: string; trackable?: boolean }[] = [];

	let selectedMemberId: number | null = null;
	$: if (selectedMemberId === null) selectedMemberId = defaultMemberId(members);

	const dispatch = createEventDispatcher<{ refresh: void }>();

	/** Stock that belongs to a specific child rather than to the household. */
	const BABY_CATEGORIES = new Set(['diapers', 'formula', 'baby_care']);

	// A logged-event link and a calendar cadence are mutually exclusive by design.
	// Deriving it from the category, rather than trusting a flag left over from when
	// the form opened: changing the category away from diapers hid the checkbox but
	// left the flag set, so a household item saved both and the API rejected it.
	// Any item can be consumed by a logged change — a tub of wipes goes down
	// when a nappy is changed, and that item's category is not 'diapers'.
	$: linkedToLogs = autoDecrement;

	const CATEGORY_LABELS: Record<string, string> = {
		diapers: 'Diapers', formula: 'Formula', baby_care: 'Baby care', vitamins: 'Vitamins',
		cleaning: 'Cleaning', filters: 'Filters', batteries: 'Batteries', household: 'Household', other: 'Other',
	};

	let items: InventoryItem[] = [];
	let categories: string[] = [];
	let sizes: any[] = [];
	let signals: Record<string, number | null> = {};
	let alertList: InventoryAlert[] = [];
	let viewMode: 'cards' | 'table' = 'cards';
	// A delivery is a box of 192 or a box of 90, and no two brands match, so the
	// quantity is typed rather than tapped or learned from a per-item constant.
	let qtyDraft: Record<number, string> = {};
	let showCategories = false;
	let newCategory = '';
	let showAddSize = false;
	let newSize = '';
	let newBandMinKg = '';
	let newBandMaxKg = '';
	let newSizeItemId: number | null = null;
	// 'current' is the size the child is in now; 'next' is known but not reached
	// yet. Both count for forecasting, and only 'current' drives days of cover.
	let newSizeState: 'current' | 'next' = 'current';
	let presets: DiaperBand[] = [];
	let chosenPresets: string[] = [];
	let preloading = false;

	let managingId: number | null = null;
	$: managing = items.find((i) => i.id === managingId) ?? null;
	let recountValue = '';
	let recountNote = '';
	let loadedSizesFor: number | null = null;
	let loading = true;
	let error = '';
	let notice = '';

	let showAdd = false;
	let name = '';
	let category = 'diapers';
	let variant = '';
	let quantity = '';
	let unit = 'count';
	let packSize = '';
	let leadDays = '';
	let consumeEvery = '';
	let consumeQty = '';
	let expiresAt = '';
	let memberId: number | null = null;
	let autoDecrement = false;
	/** How many of this item a single logged change uses. */
	let eventQty = '1';
	let saving = false;

	async function loadSizes(memberId: number | null) {
		loadedSizesFor = memberId;
		if (memberId === null) { sizes = []; signals = {}; return; }
		try {
			const res = await inventoryAPI.diaperSizes(memberId);
			sizes = res.data.sizes ?? [];
			signals = res.data.signals ?? {};
			const pre = await inventoryAPI.diaperSizePresets();
			presets = pre.data.presets ?? [];
			const have = sizes.map((sz: any) => String(sz.size));
			chosenPresets = presets.filter((p) => !have.includes(p.size)).map((p) => p.size);
		} catch {
			sizes = []; signals = {};
		}
	}

	async function recount(item: InventoryItem) {
		if (recountValue === '') { error = 'Enter the counted amount.'; return; }
		error = '';
		try {
			await inventoryAPI.recount(item.id, Number(recountValue), recountNote || null);
			managingId = null; recountValue = ''; recountNote = '';
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not correct the count.';
		}
	}

	async function resetHistory(item: InventoryItem) {
		if (recountValue === '') { error = 'Enter the counted amount to start from.'; return; }
		if (!confirm(`Forget the recorded history for ${item.name}?\n\nForecasts restart from the number you enter. This cannot be undone.`)) return;
		error = '';
		try {
			await inventoryAPI.resetHistory(item.id, Number(recountValue), recountNote || null);
			managingId = null; recountValue = ''; recountNote = '';
			notice = 'History reset.';
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not reset the history.';
		}
	}

	async function hide(item: InventoryItem) {
		try {
			await inventoryAPI.update(item.id, { active: false });
			managingId = null;
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not remove that item.';
		}
	}

	async function resetAll() {
		if (!confirm('Remove every inventory item, its history and all rules?\n\nDiaper sizes are kept. This cannot be undone.')) return;
		error = '';
		try {
			await inventoryAPI.resetAll();
			notice = 'Inventory reset.';
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not reset the inventory.';
		}
	}

	function openManage(item: InventoryItem) {
		managingId = managingId === item.id ? null : item.id;
		recountValue = String(item.quantity);
		recountNote = '';
	}

	async function load() {
		loading = true;
		try {
			const [list, cats] = await Promise.all([inventoryAPI.list(), inventoryAPI.categories()]);
			items = list.data.items ?? [];
			alertList = list.data.alerts ?? [];
			// Whatever this household already uses, plus the starter list.
			categories = cats.data.categories ?? Object.keys(CATEGORY_LABELS);
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not load inventory.';
		} finally {
			loading = false;
		}
		await loadSizes(selectedMemberId);
	}

	async function addSize(event: SubmitEvent) {
		event.preventDefault();
		if (!newSize.trim() || selectedMemberId === null) return;
		error = '';
		try {
			const added = await inventoryAPI.addDiaperSize({
				memberId: selectedMemberId,
				size: newSize.trim(),
				itemId: newSizeItemId,
				weightBandMinKg: newBandMinKg ? Number(newBandMinKg) : null,
				weightBandMaxKg: newBandMaxKg ? Number(newBandMaxKg) : null,
			});
			if (newSizeState === 'next' && added.data?.id) {
				await inventoryAPI.retireDiaperSize(added.data.id);
			}
			newSize = ''; newBandMinKg = ''; newBandMaxKg = ''; newSizeItemId = null; showAddSize = false;
		consumeEvery = '';
		expiresAt = '';
			await loadSizes(selectedMemberId);
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add that size.';
		}
	}

	/** One tap for the conventional ladder, with the usual weight bands filled in. */
	async function preloadSizes() {
		if (selectedMemberId === null || chosenPresets.length === 0) return;
		preloading = true;
		try {
			const picked = presets.filter((p) => chosenPresets.includes(p.size));
			await inventoryAPI.preloadDiaperSizes({
				memberId: selectedMemberId,
				sizes: picked.map((p) => ({ size: p.size, weightBandMinKg: p.weightBandMinKg, weightBandMaxKg: p.weightBandMaxKg })),
			});
			await loadSizes(selectedMemberId);
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add the standard sizes.';
		} finally {
			preloading = false;
		}
	}

	async function retireSize(row: any) {
		try {
			await inventoryAPI.retireDiaperSize(row.id);
			await loadSizes(selectedMemberId);
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not retire that size.';
		}
	}

	$: diaperStock = items.filter((i) => i.category === 'diapers');
	$: sizeUpDays = signals.size_up_in_days ?? null;
	$: if (selectedMemberId !== loadedSizesFor) loadSizes(selectedMemberId);

	function openAdd() {
		showAdd = true;
		memberId = BABY_CATEGORIES.has(category) ? selectedMemberId : null;
		name = ''; variant = ''; quantity = ''; packSize = ''; leadDays = '';
		consumeQty = '';
		// Diapers are the obvious linked case; anything else is opt-in.
		autoDecrement = category === 'diapers';
		eventQty = '1';
		error = '';
		notice = '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) { error = 'Give the item a name.'; return; }
		saving = true;
		error = '';
		try {
			await inventoryAPI.create({
				memberId,
				name: name.trim(),
				category,
				variant: variant || null,
				quantity: quantity ? Number(quantity) : 0,
				unit,
				packSize: packSize ? Number(packSize) : null,
				leadDays: leadDays ? Number(leadDays) : null,
				eventCategory: linkedToLogs ? 'diapers' : null,
				decrementPerEvent: linkedToLogs ? Math.max(1, Number(eventQty) || 1) : (consumeQty ? Number(consumeQty) : null),
				consumeIntervalDays: consumeEvery ? Number(consumeEvery) : null,
				expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
			});
			showAdd = false;
			notice = 'Item added.';
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add that item.';
		} finally {
			saving = false;
		}
	}

	async function addCategory(event: SubmitEvent) {
		event.preventDefault();
		const name = newCategory.trim();
		if (!name) return;
		error = '';
		try {
			const res = await inventoryAPI.addCategory(name);
			categories = res.data.categories ?? categories;
			newCategory = '';
			notice = `Added the ${name} category.`;
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add that category.';
		}
	}

	async function removeCategory(name: string) {
		if (!confirm(`Remove "${name}" from the list?\n\nItems already using it keep it.`)) return;
		try {
			await inventoryAPI.removeCategory(name);
			const res = await inventoryAPI.categoriesInUse();
			categories = res.data.categories ?? [];
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not remove that category.';
		}
	}

	async function adjust(item: InventoryItem, change: number, reason: 'purchase' | 'used' | 'manual' | 'correction') {
		error = '';
		try {
			await inventoryAPI.adjust(item.id, { change, reason });
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not update stock.';
		}
	}

	/** A weight band is a range. One end alone is a half-answer, so say which. */
	function bandLabel(min: number | null | undefined, max: number | null | undefined): string {
		if (min != null && max != null) return `${min}–${max} kg`;
		if (max != null) return `up to ${max} kg`;
		if (min != null) return `from ${min} kg`;
		return 'no weight band set';
	}

	async function setQuantity(item: InventoryItem, raw: string) {
		const next = Number(raw);
		delete qtyDraft[item.id];
		if (!Number.isFinite(next) || next < 0 || next === item.quantity) return;
		error = '';
		try {
			await inventoryAPI.recount(item.id, next, 'Set from the table');
			await load();
			dispatch('refresh');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not set that quantity.';
		}
	}

	function commitQtyOnEnter(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		if ((e as KeyboardEvent).key === 'Enter') el.blur();
	}

	/** Most urgent first: needs attention, then least cover, unknown cover last. */
	function byUrgency(list: InventoryItem[]): InventoryItem[] {
		return [...list].sort((a, b) => {
			if (a.alerting !== b.alerting) return a.alerting ? -1 : 1;
			const da = a.daysOfCover;
			const db = b.daysOfCover;
			if (da === null && db === null) return a.name.localeCompare(b.name);
			if (da === null) return 1;
			if (db === null) return -1;
			return da - db;
		});
	}

	const grouped = () => {
		const byCategory = new Map<string, InventoryItem[]>();
		for (const item of items) {
			const list = byCategory.get(item.category) ?? [];
			list.push(item);
			byCategory.set(item.category, list);
		}
		return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	};

	function cover(item: InventoryItem): string {
		if (item.daysOfCover === null) return 'no usage recorded yet';
		const d = item.daysOfCover;
		if (d < 1) return 'runs out today';
		if (d < 2) return 'about a day left';
		return `about ${Math.round(d)} days left`;
	}

	onMount(load);
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-5 border border-line-soft mb-4">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-lg font-display font-semibold">Inventory</h3>
		<div class="flex items-center gap-2">
			<div class="flex bg-surface2 rounded-md p-1">
				<button
					type="button"
					on:click={() => (viewMode = 'cards')}
					class="{viewMode === 'cards' ? 'bg-surface text-ink' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors"
				>Cards</button>
				<button
					type="button"
					on:click={() => (viewMode = 'table')}
					class="{viewMode === 'table' ? 'bg-surface text-ink' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors"
				>Table</button>
			</div>
			<button type="button" on:click={openAdd} class="px-3 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold">Add item</button>
		</div>
	</div>

	{#if error}<p class="text-danger-text text-sm mb-2">{error}</p>{/if}
	{#if notice}<p class="text-xs text-ink-soft mb-2">{notice}</p>{/if}

	{#if showAdd}
		<form on:submit={save} class="border border-line-soft rounded-lg p-4 mb-4 space-y-3 bg-surface2">
			<div>
				<label for="inv-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
				<input id="inv-name" type="text" bind:value={name} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Diapers" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="inv-category" class="block text-sm font-medium text-ink-soft mb-1">Category</label>
					<input
						id="inv-category"
						list="inv-category-options"
						bind:value={category}
						class="w-full px-3 py-2 border border-line rounded-md"
						placeholder="diapers, filters, or your own"
					/>
					<datalist id="inv-category-options">
						{#each categories as c}<option value={c}></option>{/each}
					</datalist>
					<p class="text-xs text-ink-soft mt-1">Any category works — suggestions are just what your family already uses.</p>
				</div>
				<div>
					<label for="inv-variant" class="block text-sm font-medium text-ink-soft mb-1">Variant (e.g. size)</label>
					<input id="inv-variant" type="text" bind:value={variant} class="w-full px-3 py-2 border border-line rounded-md" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="inv-qty" class="block text-sm font-medium text-ink-soft mb-1">How many you have</label>
					<input id="inv-qty" type="number" min="0" step="1" bind:value={quantity} class="w-full px-3 py-2 border border-line rounded-md" />
				</div>
				<div>
					<label for="inv-lead" class="block text-sm font-medium text-ink-soft mb-1">Warn me this many days early</label>
					<input id="inv-lead" type="number" min="0" step="1" bind:value={leadDays} class="w-full px-3 py-2 border border-line rounded-md" placeholder="7" />
				</div>
				<div class="sm:col-span-2">
					<span class="block text-sm font-medium text-ink-soft mb-1">Uses up on its own</span>
					<div class="flex items-center gap-2">
						<div class="flex-1 min-w-[5rem]">
							<label for="inv-consume-qty" class="sr-only">How many used up each time</label>
							<input id="inv-consume-qty" type="number" min="1" step="1" bind:value={consumeQty} disabled={linkedToLogs} class="w-full px-3 py-2 border border-line rounded-md disabled:opacity-50" placeholder="1" />
						</div>
						<span class="text-sm text-ink-soft shrink-0">every</span>
						<div class="flex-1 min-w-[5rem]">
							<label for="inv-consume" class="sr-only">How many days between</label>
							<input id="inv-consume" type="number" min="1" step="1" bind:value={consumeEvery} disabled={linkedToLogs} class="w-full px-3 py-2 border border-line rounded-md disabled:opacity-50" placeholder="1" />
						</div>
						<span class="text-sm text-ink-soft shrink-0">day{consumeEvery === '1' ? '' : 's'}</span>
					</div>
					<p class="text-xs text-ink-soft mt-1">
						{#if linkedToLogs}
							Unavailable while stock is subtracted from logged changes. Use one or the other.
						{:else}
							For stock used up by the calendar rather than by something you log: 2 contacts every day,
							1 every fortnight. Nothing to log each time.
						{/if}
					</p>
				</div>
				<div>
					<label for="inv-expiry" class="block text-sm font-medium text-ink-soft mb-1">Expires (optional)</label>
					<input id="inv-expiry" type="date" bind:value={expiresAt} class="w-full px-3 py-2 border border-line rounded-md" />
					<p class="text-xs text-ink-soft mt-1">For anything with a shelf life. You can then set a rule to warn you before it goes.</p>
				</div>
			</div>
			<div>
				<label for="inv-member" class="block text-sm font-medium text-ink-soft mb-1">Belongs to</label>
				<select id="inv-member" bind:value={memberId} class="w-full px-3 py-2 border border-line rounded-md">
					<option value={null}>The whole home</option>
					{#each members as m}<option value={Number(m.id)}>{m.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" bind:checked={autoDecrement} class="w-4 h-4 accent-[var(--color-primary)]" />
					Subtract this when I log a diaper change
				</label>
				{#if autoDecrement}
					<div class="mt-2 flex items-center gap-2">
						<label for="inv-per-event" class="text-sm text-ink-soft">How many each time</label>
						<input id="inv-per-event" type="number" min="1" step="1" bind:value={eventQty} class="w-20 px-3 py-2 border border-line rounded-md" placeholder="1" />
					</div>
					<p class="text-xs text-ink-soft mt-1">A tub of wipes set to 3 comes down by 3 for every change you log.</p>
				{/if}
			</div>
			<div class="flex gap-2">
				<button type="submit" disabled={saving} class="flex-1 px-3 py-2 rounded-md bg-primary text-on-primary font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Add item'}</button>
				<button type="button" on:click={() => (showAdd = false)} class="px-3 py-2 rounded-md bg-surface text-ink-soft">Cancel</button>
			</div>
		</form>
	{/if}

	{#if selectedMemberId !== null}
		<div class="border-t border-line-soft pt-4 mb-4">
			<div class="flex items-center justify-between mb-2">
				<div>
					<p class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Diaper sizes</p>
					{#if members.length > 1}
						<label for="inv-size-child" class="block text-xs text-ink-soft mt-1">Child</label>
						<select
							id="inv-size-child"
							value={selectedMemberId}
							on:change={(e) => (selectedMemberId = Number(e.currentTarget.value))}
							class="mt-1 px-2 py-1 border border-line rounded-md bg-surface text-ink text-xs"
						>
							{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
						</select>
					{/if}
				</div>
				<button type="button" on:click={() => (showAddSize = !showAddSize)} class="px-2 py-1 rounded-md bg-surface2 text-ink-soft text-xs font-semibold">
					{showAddSize ? 'Cancel' : 'Add size'}
				</button>
			</div>

	{#if presets.length > 0}
		<div class="mb-3" data-testid="size-presets">
			<p class="text-xs text-ink-soft mb-1">
				Standard sizes, pre-filled with the usual weight bands. Brands differ slightly, so change any band that does not match yours.
			</p>
			<div class="flex flex-wrap gap-1.5">
				{#each presets as preset (preset.size)}
					{@const already = sizes.some((row) => String(row.size) === preset.size)}
					<label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs {already || !chosenPresets.includes(preset.size) ? 'bg-surface2 text-ink-soft border-line-soft' : 'bg-primary text-on-primary border-primary'}">
						<input
							type="checkbox"
							checked={chosenPresets.includes(preset.size)}
							disabled={already}
							on:change={() => (chosenPresets = chosenPresets.includes(preset.size) ? chosenPresets.filter((z) => z !== preset.size) : [...chosenPresets, preset.size])}
							class="w-3.5 h-3.5"
						/>
					{preset.size} · {bandLabel(preset.weightBandMinKg, preset.weightBandMaxKg)}
					</label>
				{/each}
			</div>
			<button
				type="button"
				on:click={preloadSizes}
				disabled={preloading || chosenPresets.length === 0}
				data-testid="preload-sizes"
				class="mt-2 px-3 py-1.5 rounded-md bg-primary text-on-primary text-sm font-semibold disabled:opacity-50"
			>
				{preloading ? 'Adding…' : `Add ${chosenPresets.length} standard size${chosenPresets.length === 1 ? '' : 's'}`}
			</button>
		</div>
	{/if}

			{#if showAddSize}
				<form on:submit={addSize} class="flex flex-wrap items-end gap-2 mb-3">
					<div>
						<label for="size-name" class="block text-xs text-ink-soft mb-1">Size</label>
						<input id="size-name" type="text" bind:value={newSize} required class="w-16 px-2 py-1.5 border border-line rounded-md" />
					</div>
					<div>
						<label for="size-band-min" class="block text-xs text-ink-soft mb-1">Starts at (kg)</label>
						<input id="size-band-min" type="number" step="0.1" min="0" bind:value={newBandMinKg} class="w-20 px-2 py-1.5 border border-line rounded-md" placeholder="5.5" />
					</div>
					<div>
						<label for="size-band-max" class="block text-xs text-ink-soft mb-1">Outgrown at (kg)</label>
						<input id="size-band-max" type="number" step="0.1" min="0" bind:value={newBandMaxKg} class="w-20 px-2 py-1.5 border border-line rounded-md" placeholder="8.2" />
					</div>
					<div>
						<label for="size-state" class="block text-xs text-ink-soft mb-1">Status</label>
						<select id="size-state" bind:value={newSizeState} class="px-2 py-1.5 border border-line rounded-md">
							<option value="current">Wearing now</option>
							<option value="next">Next size, not yet</option>
						</select>
					</div>
					<div>
						<label for="size-item" class="block text-xs text-ink-soft mb-1">Stock item</label>
						<select id="size-item" bind:value={newSizeItemId} class="px-2 py-1.5 border border-line rounded-md">
							<option value={null}>—</option>
							{#each diaperStock as d}
								<option value={d.id}>{d.name}{d.variant ? ` · ${d.variant}` : ''} ({d.quantity})</option>
							{/each}
						</select>
					</div>
					<button type="submit" class="px-3 py-1.5 rounded-md bg-primary text-on-primary text-sm font-semibold">Add</button>
				</form>
			{/if}

			{#if sizes.length === 0}
				<p class="text-xs text-ink-soft">No sizes recorded yet. Add the standard sizes above, or add one by hand.</p>
			{:else}
				<ul class="space-y-1 mb-2">
					{#each sizes as row (row.id)}
						<li class="text-xs flex items-center gap-2 {row.active ? '' : 'opacity-50'}">
							<span class="font-semibold text-ink">Size {row.size}</span>
							<span class="text-ink-soft">{bandLabel(row.weightBandMinKg, row.weightBandMaxKg)}</span>
							{#if row.itemId}<span class="text-ink-soft">· linked stock</span>{/if}
							{#if !row.active}<span class="text-ink-soft">· retired</span>{/if}
							{#if row.active}
								<button type="button" on:click={() => retireSize(row)} class="text-ink-soft hover:text-danger-text ml-auto">retire</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if sizeUpDays !== null}
					<p class="text-xs text-ink-soft">About {sizeUpDays} days until the next size.</p>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="border-b border-line-soft pb-3 mb-3">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Categories</p>
				<p class="text-xs text-ink-soft mt-0.5">Pick one when adding an item, or add your own.</p>
			</div>
			<button type="button" on:click={() => (showCategories = !showCategories)} data-testid="manage-categories" class="px-2 py-1 rounded-md bg-surface2 text-ink-soft text-xs font-semibold">
				{showCategories ? 'Close' : 'Manage'}
			</button>
		</div>

		{#if showCategories}
			<div class="mt-2 space-y-2">
				<div class="flex flex-wrap gap-1.5" data-testid="category-chips">
					{#each categories as cat}
						<span class="inline-flex items-center gap-1 bg-surface2 text-ink-soft px-2 py-1 rounded text-sm">
							{cat}
							<button type="button" on:click={() => removeCategory(cat)} aria-label="Remove {cat} from the list" class="text-ink-soft hover:text-danger-text">&times;</button>
						</span>
					{/each}
				</div>
				<form on:submit={addCategory} class="flex gap-2">
					<input
						id="new-category"
						type="text"
						bind:value={newCategory}
						placeholder="e.g. pet food"
						class="flex-1 px-3 py-1.5 border border-line rounded-md text-sm"
					/>
					<button type="submit" class="px-3 py-1.5 rounded-md bg-primary text-on-primary text-sm font-semibold">Add</button>
				</form>
			</div>
		{:else}
			<div class="flex flex-wrap gap-1.5 mt-1.5">
				{#each categories.slice(0, 6) as cat}
					<span class="inline-block bg-surface2 text-ink-soft px-2 py-0.5 rounded text-xs">{cat}</span>
				{/each}
				{#if categories.length > 6}<span class="text-xs text-ink-soft">+{categories.length - 6} more</span>{/if}
			</div>
		{/if}
	</div>

	{#if loading}
		<p class="text-sm text-ink-soft py-4">Loading inventory…</p>
	{:else if items.length === 0}
		<p class="text-sm text-ink-soft py-4">Nothing tracked yet. Add diapers or a household item to see how long it will last.</p>
	{:else}

		{#if viewMode === 'table'}
			<div class="overflow-x-auto -mx-1 px-1">
				<table class="w-full text-sm" data-testid="inventory-table">
					<thead>
						<tr class="border-b border-line-soft text-xs uppercase tracking-wider text-ink-soft">
							<th scope="col" class="text-left font-semibold py-2 pr-3">Item</th>
							<th scope="col" class="text-left font-semibold py-2 pr-3 hidden md:table-cell">Category</th>
							<th scope="col" class="text-right font-semibold py-2 pr-3 w-32">On hand</th>
							<th scope="col" class="text-left font-semibold py-2 pr-3 hidden md:table-cell w-28">Cover</th>
							<th scope="col" class="text-right font-semibold py-2 w-28"><span class="sr-only">Adjust</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-line-soft">
						{#each byUrgency(items) as item (item.id)}
							<tr data-testid="inventory-table-row">
								<td class="py-2 pr-3 min-w-0">
									<div class="flex items-center gap-2 min-w-0">
										<span class="font-semibold text-ink truncate">{item.name}</span>
										{#if item.alerting}<span class="shrink-0 text-xs font-semibold text-danger-text">needs attention</span>{/if}
									</div>
									<p class="text-xs text-ink-soft truncate">
										{#if item.consumeIntervalDays}uses {item.decrementPerEvent ?? 1} every {item.consumeIntervalDays}d · {/if}
										{#if item.expiresAt}expires {new Date(item.expiresAt).toLocaleDateString()} · {/if}
										{item.unit}
									</p>
								</td>
								<td class="py-2 pr-3 text-ink-soft hidden md:table-cell">{CATEGORY_LABELS[item.category] ?? item.category}</td>
								<td class="py-2 pr-3">
									<input
										type="number"
										min="0"
										step="1"
										value={qtyDraft[item.id] ?? item.quantity}
										on:input={(e) => (qtyDraft[item.id] = e.currentTarget.value)}
										on:blur={(e) => setQuantity(item, e.currentTarget.value)}
										on:keydown={commitQtyOnEnter}
										aria-label="On hand {item.name}"
										data-testid="qty-input"
										class="w-full px-2 py-1 text-right bg-surface2 border border-line-soft rounded-md tabular-nums"
									/>
								</td>
								<td class="py-2 pr-3 hidden md:table-cell tabular-nums">
									{#if item.daysOfCover === null}
										<span class="text-ink-soft">&mdash;</span>
									{:else}
										<span class="text-ink">{item.daysOfCover}d</span>
										{#if item.lowConfidence}<span class="text-xs text-ink-soft"> thin</span>{/if}
									{/if}
								</td>
								<td class="py-2">
									<div class="flex items-center justify-end gap-1">
										<button type="button" on:click={() => adjust(item, -1, 'used')} aria-label="Record using one {item.name}" data-testid="record-use" class="px-2 py-1 rounded-md text-ink-soft hover:bg-surface2 tabular-nums">−1</button>
										<button type="button" on:click={() => adjust(item, 1, 'purchase')} aria-label="Add one {item.name}" class="px-2 py-1 rounded-md text-accent hover:bg-surface2 tabular-nums">+1</button>
										<button type="button" on:click={() => openManage(item)} aria-label="Manage {item.name}" data-testid="manage-item" class="px-2 py-1 rounded-md text-ink-soft hover:bg-surface2">&vellip;</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
		{#each grouped() as [cat, catItems]}
			<div class="mb-4">
				<p class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">{CATEGORY_LABELS[cat] ?? cat}</p>
				<ul class="divide-y divide-line-soft">
					{#each catItems as item (item.id)}
						<li class="py-2 flex items-center gap-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-ink">
									{item.name}{item.variant ? ` · ${item.variant}` : ''}
									{#if item.alerting}<span class="ml-2 text-xs font-semibold text-danger-text">needs attention</span>{/if}
								</p>
								<p class="text-xs text-ink-soft">
									{item.quantity} {item.unit} · {cover(item)}
									{#if item.lowConfidence} · based on very little usage{/if}
									{#if item.consumeIntervalDays}
										· uses {item.decrementPerEvent ?? 1} every {item.consumeIntervalDays} day{item.consumeIntervalDays === 1 ? '' : 's'}
										{#if item.nextConsumptionAt}· next {new Date(item.nextConsumptionAt).toLocaleDateString()}{/if}
									{/if}
									{#if item.expiresAt} · expires {new Date(item.expiresAt).toLocaleDateString()}{/if}
								</p>
								{#if item.drift}
									<p class="text-xs text-danger-text">
										Automatic tracking is {Math.abs(item.drift)} {Math.abs(item.drift) === 1 ? 'unit' : 'units'} off — recount to correct it.
									</p>
								{/if}
							</div>
							<div class="flex items-center gap-1 shrink-0">
								<button
									type="button"
									on:click={() => adjust(item, -1, 'used')}
									aria-label="Record using one {item.name}"
									title="Record using one — this is what a cadence is checked against"
									data-testid="record-use"
									class="p-2 rounded-md text-ink-soft hover:bg-surface2"
								>−1</button>
								<button type="button" on:click={() => adjust(item, 1, 'purchase')} aria-label="Add one {item.name}" class="p-2 rounded-md text-accent hover:bg-surface2">+1</button>
								<button
									type="button"
									on:click={() => openManage(item)}
									aria-label="Manage {item.name}"
									data-testid="manage-item"
									class="p-2 rounded-md text-ink-soft hover:bg-surface2"
								>⋯</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
		{/if}
		{#if managing}
			<div class="p-3 bg-surface2 border border-line-soft rounded-md space-y-2" data-testid="manage-panel">
								<p class="text-xs text-ink-soft">
									Counted amount{#if managing.ledgerQuantity !== null} · ledger says {managing.ledgerQuantity} {managing.unit}{/if}
								</p>
								<div class="flex flex-wrap items-end gap-2">
									<div>
										<label for="recount-onhand" class="block text-xs text-ink-soft mb-1">On hand</label>
										<input id="recount-onhand" type="number" min="0" step="0.5" bind:value={recountValue} class="w-20 px-2 py-1.5 border border-line rounded-md" />
									</div>
									<div class="flex-1 min-w-[8rem]">
										<label for="recount-note" class="block text-xs text-ink-soft mb-1">Note</label>
										<input id="recount-note" type="text" bind:value={recountNote} class="w-full px-2 py-1.5 border border-line rounded-md" placeholder="Counted the cupboard" />
									</div>
								</div>
								<div class="flex flex-wrap gap-2">
									<button type="button" on:click={() => recount(managing)} class="px-2 py-1.5 rounded-md bg-primary text-on-primary text-xs font-semibold">Save count</button>
									<button type="button" on:click={() => resetHistory(managing)} class="px-2 py-1.5 rounded-md bg-surface text-ink-soft text-xs">Reset history</button>
									<button type="button" on:click={() => hide(managing)} class="px-2 py-1.5 rounded-md bg-surface text-ink-soft text-xs">Stop tracking</button>
									<button type="button" on:click={() => (managingId = null)} class="px-2 py-1.5 rounded-md bg-surface text-ink-soft text-xs">Close</button>
								</div>
			</div>
		{/if}

	{/if}

	{#if items.length > 0}
		<div class="border-t border-line-soft pt-3 mt-4">
			<button type="button" on:click={resetAll} data-testid="reset-all" class="text-xs text-ink-soft hover:text-danger-text underline">
				Reset the whole inventory
			</button>
			<p class="text-xs text-ink-soft mt-1">Removes every item, its history and all rules. Diaper sizes are kept.</p>
		</div>
	{/if}
</div>
