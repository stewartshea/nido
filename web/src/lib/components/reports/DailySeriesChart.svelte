<script lang="ts">
	import { Line } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Tooltip,
		Legend,
		Filler,
	} from 'chart.js';
	import type { ChartData, ChartOptions } from 'chart.js';
	import type { DailyReport } from '$lib/api/types';
	import { categoryColorVar } from './categoryColors';

	// Only the pieces this chart uses; pulling the whole chart.js barrel in
	// would bloat the client bundle that GrowthChart already pays part of.
	ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Filler);

	export let report: DailyReport;
	/** Which series to draw, keyed by the series ids below. */
	export let enabled: Record<string, boolean> = { pumpedOz: true, formulaOz: true, used: true };
	/** Inventory categories to overlay, by category name. Off unless asked for. */
	export let enabledCategories: Record<string, boolean> = {};
	/** Fired with the tapped day's date, or null when the tap missed a point. */
	export let onSelectDay: ((date: string | null) => void) | undefined = undefined;

	/**
	 * A theme color as `rgb(...)`, read from the same `--c-*` variables the rest
	 * of the app is painted from. A hardcoded hex renders wrong (or invisibly) in
	 * every palette but the one that was eyeballed, so nothing here is literal.
	 */
	function themeColor(varName: string, fallback: string): string {
		if (typeof window === 'undefined') return fallback;
		const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
		return raw ? `rgb(${raw})` : fallback;
	}

	const SERIES = [
		{ key: 'pumpedOz', label: 'Pumped', unit: 'oz', color: '--c-primary', axis: 'y' as const },
		{ key: 'formulaOz', label: 'Formula', unit: 'oz', color: '--c-accent', axis: 'y' as const },
		{ key: 'bottleOz', label: 'Bottled milk', unit: 'oz', color: '--c-ok-text', axis: 'y' as const },
		{ key: 'used', label: 'Inventory used', unit: 'units', color: '--c-danger-text', axis: 'y1' as const },
	];

	/** "Nov 3" for the axis; the year is in the page range, not each tick. */
	function shortDate(date: string): string {
		const [y, m, d] = date.split('-').map(Number);
		return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-CA', {
			month: 'short', day: 'numeric', timeZone: 'UTC',
		});
	}

	let chartData: ChartData<'line', number[]>;
	let chartOptions: ChartOptions<'line'>;

	const pointSize = () => (report.days.length > 45 ? 0 : 2.5);

	$: baseDatasets = SERIES.filter((s) => enabled[s.key]).map((s) => ({
		label: `${s.label} (${s.unit})`,
		data: report.days.map((d) => (d as any)[s.key] as number),
		borderColor: themeColor(s.color, '#666'),
		backgroundColor: themeColor(s.color, '#666'),
		yAxisID: s.axis,
		borderWidth: 2,
		pointRadius: pointSize(),
		pointHoverRadius: 5,
		tension: 0.25,
		borderDash: s.key === 'used' ? [5, 4] : [],
		spanGaps: true,
	}));

	// One line per category, on the inventory (units) axis beside the totals.
	// A day a category does not appear in is a real zero, not a gap, because
	// usage is a per-day count.
	$: categoryDatasets = (report.categories ?? [])
		.filter((c) => enabledCategories[c.category])
		.map((c) => ({
			label: `${c.category} (${c.unit})`,
			data: report.days.map((d) => c.daily[d.date] ?? 0),
			borderColor: themeColor(categoryColorVar(report.categories, c.category), '#666'),
			backgroundColor: themeColor(categoryColorVar(report.categories, c.category), '#666'),
			yAxisID: 'y1' as const,
			borderWidth: 1.5,
			pointRadius: report.days.length > 45 ? 0 : 2,
			pointHoverRadius: 5,
			tension: 0.25,
			spanGaps: true,
		}));

	$: chartData = {
		labels: report.days.map((d) => shortDate(d.date)),
		datasets: [...baseDatasets, ...categoryDatasets],
	};

	$: chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		interaction: { mode: 'index', intersect: false },
		onClick: (_event, elements) => {
			if (!onSelectDay) return;
			const idx = elements[0]?.index;
			onSelectDay(idx == null ? null : report.days[idx]?.date ?? null);
		},
		scales: {
			x: {
				grid: { display: false },
				ticks: { maxRotation: 0, autoSkipPadding: 16 },
			},
			y: {
				position: 'left',
				title: { display: true, text: 'Volume (oz)' },
				beginAtZero: true,
			},
			y1: {
				position: 'right',
				title: { display: true, text: 'Inventory used (units)' },
				beginAtZero: true,
				grid: { drawOnChartArea: false },
			},
		},
		plugins: {
			legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
		},
	};
</script>

<div class="h-72" data-testid="daily-series-chart">
	<Line data={chartData} options={chartOptions} />
</div>
