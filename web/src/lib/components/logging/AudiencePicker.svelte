<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { familiesAPI, type FamilyAccount } from '$lib/api';

	/**
	 * Chooses who a notification rule is addressed to.
	 *
	 * This governs email only. Every caregiver can still see every rule and every
	 * firing alert, because the stock is shared: hiding a low-stock rule from the
	 * household because one person owns it helps nobody, and the information
	 * disappears exactly when that person is away.
	 */
	export let audienceKind: 'family' | 'users' = 'family';
	export let audienceIds: string[] = [];
	const dispatch = createEventDispatcher<{ change: { audienceKind: 'family' | 'users'; audienceIds: string[] } }>();

	let accounts: FamilyAccount[] = [];
	let loaded = false;

	onMount(async () => {
		try {
			accounts = (await familiesAPI.accounts()).data.accounts ?? [];
		} catch {
			accounts = [];
		} finally {
			loaded = true;
		}
	});

	$: selected = accounts.filter((a) => audienceIds.includes(a.id));
	// Someone who never confirmed their address cannot be emailed, so choosing them
	// would look like it worked and quietly do nothing.
	$: unverifiedSelected = selected.filter((a) => !a.emailVerified);

	function emit(kind: 'family' | 'users', ids: string[]) {
		audienceKind = kind;
		audienceIds = ids;
		dispatch('change', { audienceKind: kind, audienceIds: ids });
	}

	function toggle(id: string) {
		const next = audienceIds.includes(id) ? audienceIds.filter((x) => x !== id) : [...audienceIds, id];
		emit('users', next);
	}
</script>

<div class="text-sm">
	<label for="aud-kind" class="block text-xs text-ink-soft mb-1">Who gets told</label>
	<select
		id="aud-kind"
		value={audienceKind}
		on:change={(e) => emit(e.currentTarget.value === 'users' ? 'users' : 'family', audienceKind === 'users' ? audienceIds : [])}
		class="px-2 py-1.5 border border-line rounded-md bg-surface text-ink"
		data-testid="audience-kind"
	>
		<option value="family">Everyone in the family</option>
		<option value="users">Only these caregivers</option>
	</select>

	{#if audienceKind === 'users'}
		{#if !loaded}
			<p class="text-xs text-ink-soft mt-2">Loading caregivers…</p>
		{:else if accounts.length === 0}
			<p class="text-xs text-ink-soft mt-2">
				Nobody has an account yet, so there is no one to email. Invite a caregiver first.
			</p>
		{:else}
			<div class="flex flex-wrap gap-1.5 mt-2" data-testid="audience-choices">
				{#each accounts as a (a.id)}
					<button
						type="button"
						on:click={() => toggle(a.id)}
						aria-pressed={audienceIds.includes(a.id)}
						title={a.emailVerified ? a.email : `${a.email} — address not confirmed`}
						class="px-2 py-1 rounded-full border text-xs font-semibold transition-colors
							{audienceIds.includes(a.id)
								? 'bg-primary text-on-primary border-primary'
								: 'bg-surface text-ink-soft border-line-soft'}"
					>
						{a.name}
						{#if !a.emailVerified}<span class="font-normal"> · unconfirmed</span>{/if}
					</button>
				{/each}
			</div>
			{#if audienceIds.length === 0}
				<p class="text-xs text-danger-text mt-2">Pick at least one caregiver.</p>
			{:else if unverifiedSelected.length > 0}
				<p class="text-xs text-ink-soft mt-2">
					{unverifiedSelected.map((a) => a.name).join(', ')} never confirmed an email address, so
					{unverifiedSelected.length === 1 ? 'they' : 'they'} will not be emailed.
				</p>
			{/if}
		{/if}
	{/if}
</div>
