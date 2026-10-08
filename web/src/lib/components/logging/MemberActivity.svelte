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

	export let summary: any = null;
	/** The selected member's enabled categories; drives what can be logged. */
	export let activeCategories: string[] = [];
	/** Tiles this member pinned, or null to fall back to their leading categories. */
	export let quickLinks: string[] | null = null;
	export let stage: string | null = null;
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

	const dispatch = createEventDispatcher<{ log: { kind: string }; loadmore: void; refresh: void; pin: { kind: string }; unpin: { kind: string } }>();

	$: firstQuick = activeCategories[0] || 'feeds';
</script>

<QuickActions
		categories={activeCategories}
		{quickLinks}
		on:log={(e) => dispatch('log', e.detail)}
		on:pin={(e) => dispatch('pin', e.detail)}
		on:unpin={(e) => dispatch('unpin', e.detail)}
	/>

<TodaySummary {summary} name={memberName} categories={activeCategories} {stage} on:log={(e) => dispatch('log', e.detail)} />

<!-- Trends and stock belong above the feed, not after it: the feed is the
     long scroll, so anything you want seen at a glance has to come first. -->
<slot />

<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft" id="activities">
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-lg font-display font-semibold">Activities</h3>
		<button type="button" on:click={() => dispatch('log', { kind: firstQuick })} class="text-sm font-semibold text-link hover:underline">Log activity +</button>
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
