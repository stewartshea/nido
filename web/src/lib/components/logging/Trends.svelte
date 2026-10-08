<script lang="ts">
	import { onMount } from 'svelte';
	import { healthAPI } from '$lib/api';

	/**
	 * A week of rates rather than a week of totals.
	 *
	 * The numbers here are all per day, because that is the form a parent can
	 * act on: "14 changes last week" says nothing, "2 a day" tells you whether
	 * something has changed. Weight is the exception — it is measured rarely, so
	 * it is reported as a rate over whatever span the readings actually cover.
	 */
	export let memberId: number;
	export let memberName = 'This child';
	/** The member's enabled categories; a trend only shows for what they track. */
	export let categories: string[] = [];

	let loading = true;
	let error = '';
	let trends: any = null;

	$: has = (id: string) => categories.length === 0 || categories.includes(id);
	$: showsAnything = has('feeds') || has('diapers') || has('sleep') || has('growth');

	async function load() {
		if (!memberId) return;
		loading = true;
		error = '';
		try {
			const res = await healthAPI.getInsights(memberId);
			trends = res.data?.insights?.trends ?? null;
		} catch (err: any) {
			error = err.response?.data?.error || 'Could not load trends.';
			trends = null;
		} finally {
			loading = false;
		}
	}

	onMount(load);
	$: if (memberId) load();

	/** Grams read better than kilograms at this scale: 32 g/day, not 0.032. */
	$: weight = trends?.weight ?? null;
	$: weightPerDayG = weight ? Math.round(weight.changePerDayKg * 1000) : 0;
	$: weightPerWeekG = weight ? Math.round(weight.changePerWeekKg * 1000) : 0;
	$: weightDirection = weightPerDayG > 5 ? 'gaining' : weightPerDayG < -5 ? 'losing' : 'holding steady';
</script>

{#if showsAnything}
	<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft mb-6" data-testid="trends">
		<h3 class="text-lg font-display font-semibold mb-3">Trends for {memberName}</h3>

		{#if loading}
			<p class="text-sm text-ink-soft py-4">Loading trends…</p>
		{:else if error}
			<p class="text-sm text-danger-text py-2">{error}</p>
		{:else if trends}
			<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
				{#if has('feeds')}
					<div>
						<p class="text-xs text-ink-soft uppercase font-semibold">Feeds</p>
						<p class="text-xl font-display font-semibold text-ink">{trends.feedsPerDay} <span class="text-sm font-sans font-normal text-ink-soft">/ day</span></p>
					</div>
				{/if}
				{#if has('diapers')}
					<div>
						<p class="text-xs text-ink-soft uppercase font-semibold">Diapers</p>
						<p class="text-xl font-display font-semibold text-ink">{trends.diapersPerDay} <span class="text-sm font-sans font-normal text-ink-soft">/ day</span></p>
					</div>
				{/if}
				{#if has('sleep')}
					<div>
						<p class="text-xs text-ink-soft uppercase font-semibold">Sleep</p>
						<p class="text-xl font-display font-semibold text-ink">{trends.sleepHoursPerDay} <span class="text-sm font-sans font-normal text-ink-soft">h / day</span></p>
					</div>
				{/if}
				{#if has('growth') && weight}
					<div>
						<p class="text-xs text-ink-soft uppercase font-semibold">Weight</p>
						{#if weight.measurements < 2}
							<p class="text-xl font-display font-semibold text-ink">{weight.latestKg} <span class="text-sm font-sans font-normal text-ink-soft">kg</span></p>
							<p class="text-xs text-ink-soft mt-0.5">one reading, no trend yet</p>
						{:else}
							<p class="text-xl font-display font-semibold text-ink">
								{weightPerDayG > 0 ? '+' : ''}{weightPerDayG} <span class="text-sm font-sans font-normal text-ink-soft">g / day</span>
							</p>
							<p class="text-xs text-ink-soft mt-0.5">
								{#if weightDirection === 'holding steady'}
									holding steady over {weight.spanDays} days
								{:else}
									{weightDirection} {Math.abs(weightPerWeekG)} g/week over {weight.spanDays} days
								{/if}
							</p>
						{/if}
					</div>
				{/if}
			</div>
			<p class="text-xs text-ink-soft mt-3">Rates are over the last {trends.periodDays} days. Weight uses the readings available in the last 30.</p>
		{/if}
	</div>
{/if}
