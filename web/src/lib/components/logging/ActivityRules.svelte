<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { reminderNoun, reminderPhrase } from '$lib/shared';
	import { familiesAPI, remindersAPI, type Reminder, type ReminderCatalogCategory, type ReminderMatch } from '$lib/api';

	const dispatch = createEventDispatcher<{ changed: void }>();

	interface DraftCondition { category: string; values: string[] }

	let rules: Reminder[] = [];
	let catalog: ReminderCatalogCategory[] = [];
	let members: { id: number; name: string }[] = [];
	let loading = true;
	let error = '';
	let kind: 'inactivity' | 'interval' = 'inactivity';
	let draft: DraftCondition[] = [{ category: '', values: [] }];
	let match: ReminderMatch = 'any';
	let amount = '3';
	let label = '';
	let targetMemberId: number | null = null;

	function optionsFor(category: string): string[] {
		return catalog.find((c) => c.id === category)?.options ?? [];
	}

	function labelFor(category: string): string {
		return catalog.find((c) => c.id === category)?.label ?? category;
	}

	function describe(r: Reminder): string {
		if (r.kind === 'inactivity') {
			const what = r.conditions.length
				? reminderPhrase(r.conditions, r.match)
				: reminderNoun(r.category);
			return `no ${what} in ${r.hours}h`;
		}
		return `${r.label || r.category} — every ${r.intervalDays}d`;
	}

	async function load() {
		loading = true;
		try {
			const [res, cat] = await Promise.all([remindersAPI.list(), remindersAPI.catalog()]);
			rules = res.data.reminders ?? [];
			catalog = cat.data.categories ?? [];
			if (!draft[0]?.category && catalog[0]) draft = [{ category: catalog[0].id, values: [] }];
			try {
				const famRes = await familiesAPI.list();
				const families = famRes.data.families ?? [];
				const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('nido.defaultFamily') : null;
				const active = families.find((f: any) => f.familyId === saved) ?? families[0];
				if (active) {
					const m = await familiesAPI.members(active.familyId);
					members = (m.data.members ?? []).map((x: any) => ({ id: Number(x.id), name: x.name }));
				}
			} catch { members = []; }
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not load reminders.';
		} finally {
			loading = false;
		}
	}

	function addCondition() {
		draft = [...draft, { category: catalog[0]?.id ?? '', values: [] }];
	}

	function removeCondition(index: number) {
		draft = draft.filter((_, i) => i !== index);
	}

	function setCategory(index: number, category: string) {
		draft = draft.map((c, i) => (i === index ? { category, values: [] } : c));
	}

	function toggleValue(index: number, value: string) {
		draft = draft.map((c, i) => {
			if (i !== index) return c;
			const has = c.values.includes(value);
			return { ...c, values: has ? c.values.filter((v) => v !== value) : [...c.values, value] };
		});
	}

	async function add() {
		error = '';
		const n = Number(amount);
		if (!Number.isFinite(n) || n <= 0) { error = 'Enter how many hours or days.'; return; }
		try {
			if (kind === 'inactivity') {
				const conditions = draft
					.filter((c) => c.category)
					.map((c) => (c.values.length ? { category: c.category, values: c.values } : { category: c.category }));
				if (conditions.length === 0) { error = 'Choose at least one thing to watch.'; return; }
				await remindersAPI.create({
					kind, conditions, match, hours: n,
					targetType: targetMemberId ? 'member' : 'home',
					targetId: targetMemberId ?? undefined,
				});
			} else {
				await remindersAPI.create({ kind, category: 'custom', intervalDays: n, label: label.trim() || undefined });
			}
			label = '';
			draft = [{ category: catalog[0]?.id ?? '', values: [] }];
			match = 'any';
			targetMemberId = null;
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
							{#if rule.targetId}
								<span class="text-ink-soft"> · {members.find((m) => m.id === rule.targetId)?.name ?? 'one person'}</span>
							{:else}
								<span class="text-ink-soft"> · anyone in the family</span>
							{/if}
							<span class="text-ink-soft"> · set by {rule.createdByName ?? 'a caregiver'}</span>
						</span>
						<button type="button" on:click={() => remove(rule.id)} class="text-xs text-danger-text hover:underline">Remove</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form on:submit|preventDefault={add} class="space-y-3">
			<div class="flex flex-wrap items-end gap-2">
				<div>
					<label for="ar-kind" class="block text-xs text-ink-soft mb-1">Kind</label>
					<select id="ar-kind" bind:value={kind} class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm">
						<option value="inactivity">Nothing logged in</option>
						<option value="interval">Do every</option>
					</select>
				</div>
				{#if kind === 'inactivity'}
					<div class="min-w-[12rem]">
						<label for="ar-target" class="block text-xs text-ink-soft mb-1">About</label>
						<select id="ar-target" value={targetMemberId ?? ''} on:change={(e) => (targetMemberId = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm w-full">
							<option value="">Anyone in the family</option>
							{#each members as m}<option value={m.id}>{m.name}</option>{/each}
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
			</div>

			{#if kind === 'inactivity'}
				<div class="space-y-2">
					<div class="text-xs font-semibold text-ink-soft">Watch for</div>
					{#each draft as condition, i}
						<div class="bg-surface2 rounded-md p-2 space-y-2" data-testid="condition-row">
							<div class="flex items-center gap-2">
								<select value={condition.category} on:change={(e) => setCategory(i, e.currentTarget.value)} class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm" aria-label="Thing to watch for">
									{#each catalog as c}<option value={c.id}>{c.label}</option>{/each}
								</select>
								{#if draft.length > 1}
									<button type="button" on:click={() => removeCondition(i)} class="ml-auto text-xs text-ink-soft hover:text-danger-text">Remove</button>
								{/if}
							</div>
							{#if optionsFor(condition.category).length > 0}
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="text-xs text-ink-soft">only</span>
									{#each optionsFor(condition.category) as value}
										<button type="button" on:click={() => toggleValue(i, value)} class="{condition.values.includes(value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} px-2 py-1 rounded-full border text-xs" aria-pressed={condition.values.includes(value)}>{value}</button>
									{/each}
									{#if condition.values.length === 0}
										<span class="text-xs text-ink-soft">— any type of {labelFor(condition.category).toLowerCase()}</span>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
					<div class="flex flex-wrap items-center gap-2">
						<button type="button" on:click={addCondition} class="text-xs text-accent hover:underline">+ Watch for another</button>
						{#if draft.length > 1}
							<label for="ar-match" class="ml-auto text-xs text-ink-soft">Clear when</label>
							<select id="ar-match" bind:value={match} class="px-2 py-1 border border-line rounded-md bg-surface text-ink text-xs">
								<option value="any">one of them happens</option>
								<option value="all">all of them happen</option>
							</select>
						{/if}
					</div>
				</div>
			{/if}

			<button type="submit" class="bg-primary text-on-primary px-3 py-2 rounded-md text-sm font-semibold">+ Add</button>
		</form>
	{/if}
	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
</div>
