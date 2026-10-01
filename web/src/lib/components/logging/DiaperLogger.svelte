<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { Droplet, AlertCircle, Activity } from 'lucide-svelte';
	import { diaperAPI } from '$lib/api';
	import { loadLoggingOptions, type LoggingOptions } from '$lib/logging/options';
	import { localInputToIso, toLocalInput } from '$lib/logging/format';
	import { apiError } from '$lib/logging/recent';

	export let familyId: string | null;
	export let memberId: number;

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string } }>();

	const CONSISTENCY_ICON: Record<string, string> = { mushy: '🍌', runny: '💧', formed: '🟤', soft: '☁️', blowout: '💥', other: '🧷' };
	const COLOR_ICON: Record<string, string> = { yellow: '🟨', brown: '🟫', green: '🟩', black: '⬛', red: '🟥' };
	const TYPES = [
		{ id: 'wet', label: 'Wet', icon: Droplet },
		{ id: 'dirty', label: 'Dirty', icon: AlertCircle },
		{ id: 'both', label: 'Both', icon: Activity },
	] as const;

	let options: LoggingOptions = { get: () => [] };
	let type: 'wet' | 'dirty' | 'both' = 'wet';
	let when = toLocalInput();
	let consistency = '';
	let color = '';
	let notes = '';
	let busy = false;

	onMount(async () => { options = await loadLoggingOptions(familyId); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		try {
			await diaperAPI.create({
				memberId,
				changeTime: localInputToIso(when),
				type,
				consistency: consistency || undefined,
				color: color || undefined,
				notes: notes || undefined,
			});
			dispatch('saved', { message: 'Diaper saved.' });
		} catch (err: any) {
			dispatch('error', { message: apiError(err, 'Failed to save diaper.') });
		} finally {
			busy = false;
		}
	}
</script>

<h3 class="text-xl font-display font-semibold mb-4">Log Diaper</h3>
<form on:submit={save} class="space-y-4">
	<div>
		<div class="block text-sm font-medium text-ink-soft mb-2">Type</div>
		<div class="grid grid-cols-3 gap-3">
			{#each TYPES as t}
				<button type="button" on:click={() => (type = t.id)} class="{type === t.id ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
					<svelte:component this={t.icon} class="w-6 h-6 mb-1" aria-hidden="true" /> {t.label}
				</button>
			{/each}
		</div>
	</div>
	<div class="grid grid-cols-2 gap-3">
		<div>
			<label for="diaper-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
			<input id="diaper-time" type="datetime-local" bind:value={when} class="w-full px-3 py-2 border border-line rounded-md" />
		</div>
		<div>
			<div class="block text-sm font-medium text-ink-soft mb-1">Consistency</div>
			<div class="flex flex-wrap gap-2">
				<button type="button" on:click={() => (consistency = '')} class="{consistency === '' ? 'bg-primary text-on-primary border-primary' : 'bg-surface2 text-ink-soft border-line-soft'} px-2.5 py-1.5 rounded-full border text-xs">—</button>
				{#each options.get('diapers', 'consistency') as opt}
					<button type="button" on:click={() => (consistency = opt)} class="{consistency === opt ? 'bg-primary text-on-primary border-primary' : 'bg-surface2 text-ink-soft border-line-soft'} px-2.5 py-1.5 rounded-full border text-xs inline-flex items-center gap-1"><span>{CONSISTENCY_ICON[opt] || '🧷'}</span>{opt}</button>
				{/each}
			</div>
		</div>
	</div>
	<div class="grid grid-cols-2 gap-3">
		<div>
			<div class="block text-sm font-medium text-ink-soft mb-1">Color (optional)</div>
			<div class="flex flex-wrap gap-2">
				<button type="button" on:click={() => (color = '')} class="{color === '' ? 'bg-primary text-on-primary border-primary' : 'bg-surface2 text-ink-soft border-line-soft'} px-2.5 py-1.5 rounded-full border text-xs">—</button>
				{#each options.get('diapers', 'color') as opt}
					<button type="button" on:click={() => (color = opt)} class="{color === opt ? 'bg-primary text-on-primary border-primary' : 'bg-surface2 text-ink-soft border-line-soft'} px-2.5 py-1.5 rounded-full border text-xs inline-flex items-center gap-1"><span>{COLOR_ICON[opt] || '◻︎'}</span>{opt}</button>
				{/each}
			</div>
		</div>
		<div>
			<label for="diaper-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
			<input id="diaper-notes" type="text" bind:value={notes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="rash, etc." />
		</div>
	</div>
	<button type="submit" disabled={busy} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">{busy ? 'Saving…' : 'Save Diaper'}</button>
</form>
