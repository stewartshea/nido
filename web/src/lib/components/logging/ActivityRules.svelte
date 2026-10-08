<script lang="ts">
	import { reminderNoun } from '$lib/shared';
	import { createEventDispatcher, onMount } from 'svelte';
	import { remindersAPI, type Reminder } from '$lib/api';

	/**
	 * "Nothing has happened for a while" rules: no feed in 3h, change the
	 * furnace filter every 180 days. Lives with the inventory rules rather than
	 * in Settings, because both are the same idea — a condition worth telling
	 * someone about — and splitting them hid half the picture.
	 */
	const dispatch = createEventDispatcher<{ changed: void }>();

	let rules: Reminder[] = [];
	let loading = true;
	let error = '';
	let kind: 'inactivity' | 'interval' = 'inactivity';
	let category = 'feeds';
	let amount = '3';
	let label = '';

	const ACTIVITY = [
		{ id: 'feeds', label: 'Feed' },
		{ id: 'pumping', label: 'Pump' },
		// Fed at the breast or expressed — the supply question, which a bottle
		// does not answer and a pump alone does not either.
		{ id: 'breast_or_pump', label: 'Breast or pump' },
		{ id: 'diapers', label: 'Diaper' },
		{ id: 'sleep', label: 'Sleep' },
	];

	function describe(r: Reminder): string {
		if (r.kind === 'inactivity') {
			return `no ${reminderNoun(r.category)} in ${r.hours}h`;
		}
		return `${r.label || r.category} — every ${r.intervalDays}d`;
	}

	async function load() {
		loading = true;
		try {
			const res = await remindersAPI.list();
			rules = res.data.reminders ?? [];
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not load reminders.';
		} finally {
			loading = false;
		}
	}

	async function add() {
		error = '';
		const n = Number(amount);
		if (!Number.isFinite(n) || n <= 0) { error = 'Enter how many hours or days.'; return; }
		try {
			await remindersAPI.create(
				kind === 'inactivity'
					? { kind, category, hours: n }
					: { kind, category, intervalDays: n, label: label.trim() || undefined },
			);
			label = '';
			await load();
			dispatch('changed');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add that reminder.';
		}
	}

	async function remove(id: number) {
		try {
			await remindersAPI.remove(id);
			await load();
			dispatch('changed');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not remove that reminder.';
		}
	}

	onMount(load);
</script>

<div data-testid="activity-rules">
	{#if loading}
		<p class="text-sm text-ink-soft">Loading…</p>
	{:else}
		{#if rules.length === 0}
			<p class="text-sm text-ink-soft mb-3">None yet.</p>
		{:else}
			<ul class="space-y-2 mb-3">
				{#each rules as rule (rule.id)}
					<li class="flex items-center justify-between gap-2 bg-surface2 rounded-md px-3 py-2 text-sm">
						<span class="text-ink" class:text-danger-text={rule.overdue}>
							{describe(rule)}
							<span class="text-ink-soft"> · shared with the family{rule.createdByName ? ` · set by ${rule.createdByName}` : ''}</span>
						</span>
						<button type="button" on:click={() => remove(rule.id)} class="text-xs text-danger-text hover:underline">Remove</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form on:submit|preventDefault={add} class="flex flex-wrap items-end gap-2">
			<div>
				<label for="ar-kind" class="block text-xs text-ink-soft mb-1">Kind</label>
				<select id="ar-kind" bind:value={kind} class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm">
					<option value="inactivity">Nothing logged in</option>
					<option value="interval">Do every</option>
				</select>
			</div>
			{#if kind === 'inactivity'}
				<div>
					<label for="ar-cat" class="block text-xs text-ink-soft mb-1">Of</label>
					<select id="ar-cat" bind:value={category} class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm">
						{#each ACTIVITY as a}<option value={a.id}>{a.label}</option>{/each}
					</select>
				</div>
			{:else}
				<div>
					<label for="ar-cat2" class="block text-xs text-ink-soft mb-1">What</label>
					<input id="ar-cat2" type="text" bind:value={label} class="w-40 px-2 py-2 border border-line rounded-md bg-surface text-ink text-sm" placeholder="Change furnace filter" />
				</div>
			{/if}
			<div>
				<label for="ar-amount" class="block text-xs text-ink-soft mb-1">{kind === 'inactivity' ? 'Hours' : 'Days'}</label>
				<input id="ar-amount" type="number" min="1" bind:value={amount} class="w-20 px-2 py-2 border border-line rounded-md bg-surface text-ink text-sm" />
			</div>
			<button type="submit" class="bg-primary text-on-primary px-3 py-2 rounded-md text-sm font-semibold">+ Add</button>
		</form>
	{/if}
	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
</div>
