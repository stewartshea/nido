<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { familiesAPI, inventoryAPI, type FamilyAccount, type InventoryRule } from '$lib/api';
	import AudiencePicker from './AudiencePicker.svelte';

	/**
	 * Inventory lives in three places, each with one job: this file owns the
	 * *configuration* ("tell me when..."), /inventory owns the items and their
	 * history, and the dashboard owns a glance. Rules are settings because they
	 * are a household preference, not a record — the same reason diaper colours
	 * and moods live in settings rather than in the log forms.
	 */
	let rules: InventoryRule[] = [];
	let signals: { name: string; label: string; unit: string; describe: string }[] = [];
	let items: { id: number; name: string; variant: string | null; category: string }[] = [];
	let accounts: FamilyAccount[] = [];

	let audienceKind: 'family' | 'users' = 'family';
	let audienceIds: string[] = [];

	let showAdd = false;
	let itemId: number | null = null;
	let signal = '';
	let comparator: 'lt' | 'lte' | 'gt' | 'gte' = 'lte';
	let threshold = '';
	let repeatDays = '';
	let busy = false;
	let error = '';
	let notice = '';

	const dispatch = createEventDispatcher<{ changed: void }>();

	$: signalMeta = signals.find((s) => s.name === signal);
	$: unitLabel = signalMeta?.unit === 'days' ? 'days' : signalMeta?.unit ?? '';

	async function load() {
		try {
			const [r, sig, inv, acct] = await Promise.all([
				inventoryAPI.rules(),
				inventoryAPI.signals(),
				inventoryAPI.list(),
				familiesAPI.accounts().catch(() => ({ data: { accounts: [] as FamilyAccount[] } })),
			]);
			accounts = acct.data.accounts ?? [];
			rules = r.data.rules ?? [];
			signals = sig.data.signals ?? [];
			items = (inv.data.items ?? []).map((i) => ({ id: i.id, name: i.name, variant: i.variant, category: i.category }));
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not load inventory rules.';
		}
	}

	function itemName(id: number | null): string {
		if (id === null) return 'Any item';
		const it = items.find((i) => i.id === id);
		return it ? `${it.name}${it.variant ? ` · ${it.variant}` : ''}` : `Item ${id}`;
	}

	function describe(r: InventoryRule): string {
		const atOrUnder = r.comparator === 'lte' || r.comparator === 'lt';
		const unit = signals.find((s) => s.name === r.signal)?.unit ?? '';
		const shown = unit && r.threshold === 1 ? unit.replace(/s$/, '') : unit;
		const unitText = shown ? ` ${shown}` : '';
		return `${signals.find((s) => s.name === r.signal)?.label ?? r.signal} is ${atOrUnder ? 'at or under' : 'at or over'} ${r.threshold}${unitText}`;
	}

	function audienceLabel(rule: InventoryRule): string {
		if (rule.audienceKind !== 'users') return 'everyone in the family';
		const names = rule.audienceIds
			.map((id) => accounts.find((a) => a.id === id)?.name)
			.filter(Boolean) as string[];
		if (names.length === 0) return 'nobody — pick someone';
		if (names.length === 1) return names[0];
		return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!signal || threshold === '') { error = 'Choose a signal and a limit.'; return; }
		if (audienceKind === 'users' && audienceIds.length === 0) {
			error = 'Choose at least one caregiver to tell, or set the audience back to the whole family.';
			return;
		}
		busy = true;
		error = '';
		try {
			await inventoryAPI.createRule({
				itemId, signal, comparator, threshold: Number(threshold),
				repeatDays: repeatDays ? Number(repeatDays) : null,
				audienceKind, audienceIds,
			});
			threshold = ''; repeatDays = ''; showAdd = false;
			audienceKind = 'family'; audienceIds = [];
			notice = 'Rule added.';
			await load();
			dispatch('changed');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add that rule.';
		} finally {
			busy = false;
		}
	}

	async function remove(id: number) {
		if (!confirm('Remove this rule?')) return;
		try {
			await inventoryAPI.deleteRule(id);
			await load();
			dispatch('changed');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not remove that rule.';
		}
	}

	onMount(load);
</script>

<div class="border-t border-line-soft pt-4 mt-4">
	<div class="flex items-center justify-between mb-1">
		<h4 class="font-display font-semibold text-sm">Inventory alerts</h4>
		<button type="button" on:click={() => (showAdd = !showAdd)} class="px-2 py-1 rounded-md bg-surface2 text-ink-soft text-xs font-semibold">
			{showAdd ? 'Cancel' : 'Add rule'}
		</button>
	</div>
	<p class="text-sm text-ink-soft mb-3">
		When to be told about stock. Every caregiver sees these rules and every one of them fires for everyone.
	</p>

	{#if error}<p class="text-danger-text text-sm mb-2">{error}</p>{/if}
	{#if notice}<p class="text-sm text-ink-soft mb-2" role="status">{notice}</p>{/if}

	{#if rules.length > 0}
		<ul class="space-y-1 mb-3">
			{#each rules as rule (rule.id)}
				<li class="text-sm flex items-center gap-2">
					<span>
						{describe(rule)} — {itemName(rule.itemId)}
						{rule.repeatDays ? ` · repeat every ${rule.repeatDays}d` : ' · once until it clears'}
						<span class="text-ink-soft"> · told to {audienceLabel(rule)}{rule.createdByName ? ` · set by ${rule.createdByName}` : ''}</span>
					</span>
					<button type="button" on:click={() => remove(rule.id)} class="text-xs text-ink-soft hover:text-danger-text shrink-0">remove</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-ink-soft mb-3">No rules yet, so nothing is being watched.</p>
	{/if}

	{#if showAdd}
		<form on:submit={add} class="flex flex-wrap items-end gap-2">
			<div class="min-w-[10rem]">
				<label for="sr-item" class="block text-xs text-ink-soft mb-1">Applies to</label>
				<select id="sr-item" value={itemId} on:change={(e) => (itemId = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} class="px-2 py-1.5 border border-line rounded-md">
					<option value="">Any item</option>
					{#each items as it}<option value={it.id}>{it.name}{it.variant ? ` · ${it.variant}` : ''}</option>{/each}
				</select>
			</div>
			<div class="min-w-[12rem]">
				<label for="sr-signal" class="block text-xs text-ink-soft mb-1">When</label>
				<select id="sr-signal" bind:value={signal} class="px-2 py-1.5 border border-line rounded-md">
					<option value="">Choose a signal</option>
					{#each signals as sg}<option value={sg.name}>{sg.label}</option>{/each}
				</select>
			</div>
			<div>
				<label for="sr-cmp" class="block text-xs text-ink-soft mb-1">Test</label>
				<select id="sr-cmp" bind:value={comparator} class="px-2 py-1.5 border border-line rounded-md">
					<option value="lte">at or under</option>
					<option value="lt">under</option>
					<option value="gte">at or over</option>
					<option value="gt">over</option>
				</select>
			</div>
			<div>
				<label for="sr-threshold" class="block text-xs text-ink-soft mb-1">Limit {unitLabel}</label>
				<input id="sr-threshold" type="number" step="0.1" bind:value={threshold} required class="w-20 px-2 py-1.5 border border-line rounded-md" />
			</div>
			<div>
				<label for="sr-repeat" class="block text-xs text-ink-soft mb-1">Repeat (days)</label>
				<input id="sr-repeat" type="number" min="1" bind:value={repeatDays} class="w-16 px-2 py-1.5 border border-line rounded-md" placeholder="once" />
			</div>
			<div class="min-w-[12rem]">
				<AudiencePicker bind:audienceKind bind:audienceIds />
			</div>
			<button type="submit" disabled={busy} class="px-3 py-1.5 rounded-md bg-primary text-on-primary text-sm font-semibold">Add</button>
		</form>
		{#if signalMeta}
			<p class="text-xs text-ink-soft mt-2">{signalMeta.describe}</p>
		{/if}
	{/if}
</div>
