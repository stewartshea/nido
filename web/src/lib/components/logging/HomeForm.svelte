<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { familiesAPI, type Home } from '$lib/api/family';
	import { currentTimezone } from '$lib/stores/timezoneStore';

	// The create/edit form for a residence (issue #76): the homes registry
	// was seed-only before this, so "Primary Home" could never be renamed and
	// the cabin could never be added. Writes are owner/admin on the API; the
	// form shows the same fields to everyone and lets the API say no.
	export let familyId: string;
	export let editing: Home | null = null;
	export let canDelete = true;

	const dispatch = createEventDispatcher<{ save: void; cancel: void; delete: void }>();

	// Timezone is a native select, not free text (the UX rule for plain
	// enums) — and never free text on the server either: an unvalidated zone
	// is one `Intl` silently refuses, and every wall clock after it drifts
	// (issue #76). Options are the platform's own list; the default is the
	// family's zone, labelled honestly.
	const TIMEZONES: string[] = (() => {
		try { return Intl.supportedValuesOf('timeZone') as string[]; } catch { return []; }
	})();
	// '' = "same as the family" (send null, the API defaults it server-side).
	let timezone = editing?.timezone ?? '';

	const KINDS: { id: string; label: string }[] = [
		{ id: 'residence', label: 'Residence' },
		{ id: 'cabin', label: 'Cabin / cottage' },
		{ id: 'rental', label: 'Rental' },
		{ id: 'storage', label: 'Storage / locker' },
		{ id: 'other', label: 'Other' },
	];

	let name = editing?.name ?? '';
	let kind = editing?.kind ?? 'residence';
	let address = editing?.address ?? '';
	let isPrimary = editing?.isPrimary ?? false;
	let error = '';
	let saving = false;

	async function save() {
		if (!name.trim()) {
			error = 'Give the home a name.';
			return;
		}
		saving = true;
		error = '';
		const data = {
			name: name.trim(),
			kind,
			address: address.trim() || null,
			// '' = "same as the family": send null and let the server default it
			// from family_settings, so the client and API agree on one source.
			timezone: timezone || null,
			isPrimary,
		};
		try {
			if (editing) await familiesAPI.updateHome(familyId, editing.id, data);
			else await familiesAPI.addHome(familyId, data);
			dispatch('save');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not save the home.';
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!editing) return;
		if (!confirm(`Delete ${editing.name}? Assets that live here become family-wide; their history stays.`)) return;
		saving = true;
		error = '';
		try {
			await familiesAPI.deleteHome(familyId, editing.id);
			dispatch('delete');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not delete the home.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="bg-surface border border-line rounded-xl shadow-sm p-4 mb-4" data-testid="home-form">
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="text-sm text-ink-soft">
			Name
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={name} placeholder="The Cabin" />
		</label>
		<label class="text-sm text-ink-soft">
			Kind
			<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={kind}>
				{#each KINDS as k (k.id)}
					<option value={k.id}>{k.label}</option>
				{/each}
			</select>
		</label>
		<label class="text-sm text-ink-soft sm:col-span-2">
			Address
			<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={address} placeholder="Lake Road 12" />
		</label>
		<label class="text-sm text-ink-soft sm:col-span-2">
			Timezone
			<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={timezone}>
				<option value="">Same as the family{#if currentTimezone()}&nbsp;({currentTimezone()}){/if}</option>
				{#each TIMEZONES as tz (tz)}
					<option value={tz}>{tz}</option>
				{/each}
			</select>
		</label>
		<label class="flex items-center gap-2 text-sm text-ink-soft cursor-pointer sm:col-span-2">
			<input type="checkbox" class="accent-primary" bind:checked={isPrimary} />
			This is the family's primary home
		</label>
	</div>
	{#if error}<p class="text-sm text-danger-text mt-2">{error}</p>{/if}
	<div class="flex justify-between gap-2 mt-3">
		<div>
			{#if editing && canDelete}
				<button type="button" class="text-sm text-danger underline" on:click={remove}>Delete home</button>
			{/if}
		</div>
		<div class="flex gap-2">
			<button type="button" class="px-4 py-2 rounded-md border border-line text-sm text-ink-soft hover:text-ink" on:click={() => dispatch('cancel')}>Cancel</button>
			<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" disabled={saving} on:click={save}>
				{saving ? 'Saving…' : editing ? 'Save changes' : 'Add home'}
			</button>
		</div>
	</div>
</div>