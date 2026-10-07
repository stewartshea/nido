<script lang="ts">
	import FeedLogger from './FeedLogger.svelte';
	import PumpLogger from './PumpLogger.svelte';
	import DiaperLogger from './DiaperLogger.svelte';
	import SleepLogger from './SleepLogger.svelte';
	import GrowthLogger from './GrowthLogger.svelte';
	import MilestoneLogger from './MilestoneLogger.svelte';
	import VaccineLogger from './VaccineLogger.svelte';
	import MoodLogger from './MoodLogger.svelte';
	import JournalLogger from './JournalLogger.svelte';
	import { isMilestoneKind } from '$lib/shared';

	/** The one place every log action goes through, whichever page opened it. */
	export let kind: string;
	export let familyId: string | null;
	export let memberId: number;
	export let members: { id: number | string; name: string }[] = [];
</script>

{#key `${kind}:${memberId}`}
	{#if kind === 'feeds'}
		<FeedLogger {familyId} {memberId} on:saved on:error on:notice />
	{:else if kind === 'pumping'}
		<PumpLogger {memberId} {members} on:saved on:error on:notice />
	{:else if kind === 'diapers'}
		<DiaperLogger {familyId} {memberId} on:saved on:error />
	{:else if kind === 'sleep'}
		<SleepLogger {memberId} on:saved on:error />
	{:else if kind === 'growth'}
		<GrowthLogger {memberId} on:saved on:error />
	{:else if isMilestoneKind(kind)}
		<!-- Every milestone-backed kind renders here. Listing them by hand is what
		     left medication, vitamins, appointments and grooming with no form at
		     all: they were simply not in the list. -->
		<MilestoneLogger {kind} {familyId} {memberId} on:saved on:error />
	{:else if kind === 'vaccines'}
		<VaccineLogger {memberId} on:saved on:error />
	{:else if kind === 'moods'}
		<MoodLogger {familyId} {memberId} on:saved on:error />
	{:else if kind === 'journal'}
		<JournalLogger {memberId} on:saved on:error />
	{/if}
{/key}
