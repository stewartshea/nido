<script lang="ts">
	import { onMount } from 'svelte';
	import { Line } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		LineElement,
		LinearScale,
		PointElement,
	} from 'chart.js';
	import type { ChartData, ChartOptions } from 'chart.js';
	import { growthAPI } from '$lib/api';

	ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement);

	export let memberId: number;
	export let memberName = 'This child';
	export let metric: 'weight' | 'height' = 'weight';

	let measuring = true;
	let error = '';
	let data: any = null;

	/** The WHO bands, drawn as thin reference lines behind the child's own. */
	const BANDS = ['p3', 'p15', 'p50', 'p85', 'p97'] as const;

	$: unit = metric === 'weight' ? 'kg' : 'cm';
	$: axis = metric === 'weight' ? 'Weight (kg)' : 'Length (cm)';

	async function load() {
		if (!memberId) return;
		measuring = true;
		error = '';
		try {
			const res = await growthAPI.getChartData(memberId);
			data = res.data;
		} catch (err: any) {
			error = err.response?.data?.error || 'Could not load growth data.';
			data = null;
		} finally {
			measuring = false;
		}
	}

	onMount(load);
	// Re-fetch when the person changes; the page reuses this component.
	$: if (memberId) load();

	function pointsFor(key: 'weight_kg' | 'height_cm') {
		const rows = (data?.measurements ?? []) as any[];
		return rows
			.filter((r) => r[key] != null)
			.map((r) => ({ x: r.age_in_weeks, y: Number(r[key]) }))
			.sort((a, b) => a.x - b.x);
	}

	$: standard = data
		? metric === 'weight'
			? data.who_standards?.weight_for_age
			: data.who_standards?.height_for_age
		: null;

	$: childPoints = data ? pointsFor(metric === 'weight' ? 'weight_kg' : 'height_cm') : [];

	// Declared with a type here rather than annotated on the reactive assignment:
	// Svelte parses `$: name: Type = ...` as a labelled statement, not a typed one.
	let chartData: ChartData<'line', { x: number; y: number }[]>;
	let chartOptions: ChartOptions<'line'>;

	$: chartData = {
		datasets: [
			...(standard ?? []).length
				? BANDS.map((band, i) => ({
						label: band === 'p50' ? '50th percentile' : `${band.slice(1)}th`,
						data: standard.map((r: any) => ({ x: r.age_weeks, y: r[band] })),
						borderColor: band === 'p50' ? 'rgba(120,120,120,0.9)' : 'rgba(150,150,150,0.35)',
						borderWidth: band === 'p50' ? 1.5 : 1,
						borderDash: band === 'p50' ? [] : [4, 4],
						pointRadius: 0,
						tension: 0.3,
						order: i + 10,
					}))
				: [],
			{
				label: memberName,
				data: childPoints,
				borderColor: 'rgb(20,120,80)',
				backgroundColor: 'rgba(20,120,80,0.85)',
				borderWidth: 2.5,
				pointRadius: 4,
				pointHoverRadius: 6,
				tension: 0.2,
				order: 0,
			},
		],
	};

	$: chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		interaction: { mode: 'nearest', intersect: false },
		scales: {
			x: {
				type: 'linear',
				title: { display: true, text: 'Age (weeks)' },
				ticks: { precision: 0 },
				grid: { color: 'rgba(0,0,0,0.05)' },
			},
			y: {
				title: { display: true, text: axis },
				grid: { color: 'rgba(0,0,0,0.05)' },
			},
		},
		plugins: {
			legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
		},
	};

	/**
	 * The most recent measurement's standing.
	 *
	 * Read from the API rather than recomputed here. There used to be a second
	 * copy of the percentile logic in this file, which meant the headline and the
	 * growth list could quietly disagree.
	 */
	$: latestPercentile = (() => {
		const rows = [...((data?.measurements ?? []) as any[])]
			.filter((r) => (metric === 'weight' ? r.weight_percentile != null : r.height_percentile != null))
			.sort((a, b) => b.age_in_weeks - a.age_in_weeks);
		const last = rows[0];
		if (!last) return null;
		const percentile = metric === 'weight' ? last.weight_percentile : last.height_percentile;
		const value = metric === 'weight' ? last.weight_kg : last.height_cm;
		return { value: Number(value).toFixed(1), unit, percentile: Number(percentile), ageWeeks: last.age_in_weeks };
	})();
</script>

<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft mb-6">
	<div class="flex items-center justify-between mb-3 flex-wrap gap-2">
		<h3 class="text-lg font-display font-semibold">Growth for {memberName}</h3>
		<div class="flex bg-surface2 rounded-md p-1">
			<button type="button" on:click={() => (metric = 'weight')} class="{metric === 'weight' ? 'bg-surface text-ink' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors">Weight</button>
			<button type="button" on:click={() => (metric = 'height')} class="{metric === 'height' ? 'bg-surface text-ink' : 'text-ink-soft hover:text-ink'} h-8 px-3 rounded-md text-sm font-semibold transition-colors">Length</button>
		</div>
	</div>

	{#if measuring}
		<p class="text-sm text-ink-soft py-8 text-center">Loading growth…</p>
	{:else if error}
		<p class="text-sm text-danger-text py-4">{error}</p>
	{:else if childPoints.length === 0}
		<p class="text-sm text-ink-soft py-4">No measurements recorded yet. Add one from Quick Actions to see {memberName} against the WHO percentiles.</p>
	{:else}
		{#if latestPercentile}
			<p class="text-sm text-ink-soft mb-3">
				Latest: <span class="font-semibold text-ink">{latestPercentile.value} {latestPercentile.unit}</span>
				at <span class="font-semibold text-ink">{latestPercentile.percentile < 1 ? 'under 1st' : latestPercentile.percentile > 99 ? 'over 99th' : `${Math.round(latestPercentile.percentile)}th`} percentile</span>
				({latestPercentile.ageWeeks} weeks)
			</p>
		{/if}
		<div class="h-72" data-testid="growth-chart">
			<Line data={chartData} options={chartOptions} />
		</div>
		<p class="text-xs text-ink-soft mt-2">Dashed lines are WHO reference percentiles for age; the solid line is {memberName}. Values are converted to metric so every measurement plots on one scale.</p>
	{/if}
</div>
