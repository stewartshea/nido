<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ActivityHistory from '$lib/components/ActivityHistory.svelte';
	import QuickActions from './QuickActions.svelte';
	import TodaySummary from './TodaySummary.svelte';

	/**
	 * Everything shown for one member on both the dashboard and the family
	 * page: quick log tiles, today's summary and the activity history. Having
	 * a single copy is what keeps the two pages' logging identical.
	 */
	export let memberName = 'Selected';
	export let quickLinks: string[] = [];
	export let summary: any = null;
	export let activeCategories: string[] = [];
	export let feedings: any[] = [];
	export let diapers: any[] = [];
	export let sleeps: any[] = [];
	export let growths: any[] = [];
	export let milestones: any[] = [];
	export let vaccinations: any[] = [];
	export let moods: any[] = [];
	export let journalEntries: any[] = [];
	export let totals: Record<string, number> = {};
	export let loadingMore = false;

	const dispatch = createEventDispatcher<{ log: { kind: string }; loadmore: void; refresh: void }>();

	$: firstQuick = quickLinks[0] || 'feeds';
</script>

<QuickActions {quickLinks} on:log={(e) => dispatch('log', e.detail)} />

<TodaySummary {summary} name={memberName} on:log={(e) => dispatch('log', e.detail)} />

<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft" id="activities">
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-lg font-display font-semibold">Activities</h3>
		<button type="button" on:click={() => dispatch('log', { kind: firstQuick })} class="text-sm font-semibold text-primary hover:underline">Log activity +</button>
	</div>
	<ActivityHistory
		{feedings} {diapers} {sleeps} {growths}
		{milestones} {vaccinations} {moods} {journalEntries}
		{activeCategories}
		{totals}
		{loadingMore}
		on:loadmore={() => dispatch('loadmore')}
		on:refresh={() => dispatch('refresh')}
	/>
</div>
