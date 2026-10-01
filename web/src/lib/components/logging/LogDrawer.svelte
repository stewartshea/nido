<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import LogSheet from '$lib/components/LogSheet.svelte';
	import ActivityLogger from './ActivityLogger.svelte';
	import { CATEGORIES } from '$lib/shared';

	export let open = false;
	export let kind: string;
	export let familyId: string | null;
	export let memberId: number | null;
	export let members: { id: number | string; name: string }[] = [];

	const dispatch = createEventDispatcher<{ saved: { message: string }; error: { message: string }; notice: { message: string } }>();

	$: label = CATEGORIES.find((c) => c.id === kind)?.label || 'Activity';

	function saved(e: CustomEvent<{ message: string }>) {
		open = false;
		dispatch('saved', e.detail);
	}
</script>

<LogSheet bind:open title="Log {label}">
	{#if open}
		{#if memberId !== null}
			<ActivityLogger {kind} {familyId} {memberId} {members} on:saved={saved} on:error={(e) => dispatch('error', e.detail)} on:notice={(e) => dispatch('notice', e.detail)} />
		{:else}
			<p class="text-sm text-ink-soft">Choose a family member first.</p>
		{/if}
	{/if}
</LogSheet>
