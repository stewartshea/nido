<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api/client';
	import { familiesAPI } from '$lib/api/family';
	import { reportsAPI } from '$lib/api/reports';
	import type { DailyReport, ReportDay } from '$lib/api/types';
	import DailySeriesChart from '$lib/components/reports/DailySeriesChart.svelte';

	// The overlay view the quick reports on Family Overview cannot be: the same
	// numbers as per-day series, side by side, with a day openable into the rows
	// behind it. Family-wide by default; picking a person narrows the feeding
	// series (inventory stays the household's ledger).

	let members: { id: number; name: string }[] = [];
	let loaded = false;
	let loading = false;
	let error = '';

	let days = 30;
	let memberId: number | null = null;
	let report: DailyReport | null = null;
	let selectedDate: string | null = null;

	// Toggles for the overlay. Kept on the page so the chart stays a dumb view.
	let enabled: Record<string, boolean> = { pumpedOz: true, formulaOz: true, bottleOz: false, used: true };

	const RANGES = [7, 30, 90];
	const SERIES_LABELS: [string, string][] = [
		['pumpedOz', 'Pumped'],
		['formulaOz', 'Formula'],
		['bottleOz', 'Bottled milk'],
		['used', 'Inventory used'],
	];

	function shortDate(date: string): string {
		const [y, m, d] = date.split('-').map(Number);
		return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-CA', {
			weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
		});
	}

	async function loadReport() {
		loading = true;
		error = '';
		try {
			const res = await reportsAPI.daily({ days, memberId });
			report = res.data.report;
			selectedDate = null;
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not load the report.';
			report = null;
		} finally {
			loading = false;
		}
	}

	async function load() {
		try {
			const token = localStorage.getItem('token');
			if (!token || tokenExpired()) {
				await goto('/login');
				return;
			}
			const res = await familiesAPI.list();
			const families = res.data.families ?? [];
			const familyId = localStorage.getItem('nido.defaultFamily') ?? families[0]?.familyId;
			if (familyId) {
				const membersRes = await familiesAPI.members(familyId);
				members = (membersRes.data.members ?? [])
					.filter((m: any) => m.trackable !== false)
					.map((m: any) => ({ id: Number(m.id), name: m.name }));
			}
			await loadReport();
		} catch (e: any) {
			if (e?.response?.status === 401) await goto('/login');
			else error = e?.response?.data?.error || 'Could not load your family.';
		} finally {
			loaded = true;
		}
	}

	onMount(load);

	$: totals = report
		? {
			pumpedOz: report.days.reduce((s, d) => s + d.pumpedOz, 0),
			formulaOz: report.days.reduce((s, d) => s + d.formulaOz, 0),
			bottleOz: report.days.reduce((s, d) => s + d.bottleOz, 0),
			used: report.days.reduce((s, d) => s + d.used, 0),
			corrected: report.days.reduce((s, d) => s + d.corrected, 0),
		}
		: null;

	$: selected = report && selectedDate ? report.days.find((d) => d.date === selectedDate) ?? null : null;
	$: selectedItems = report && selectedDate
		? report.items.filter((i) => i.daily[selectedDate!] != null)
		: [];

	function itemTotal(daily: Record<string, number>): number {
		return Math.round(Object.values(daily).reduce((s, n) => s + n, 0) * 100) / 100;
	}

	async function onRange(next: number) {
		days = next;
		await loadReport();
	}
	async function onMember(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		memberId = value ? Number(value) : null;
		await loadReport();
	}
</script>

<svelte:head><title>Reports · Nido</title></svelte:head>

<div class="max-w-6xl mx-auto px-4 py-4 md:py-6">
	<div class="mb-4">
		<h1 class="text-2xl font-display font-semibold text-ink">Reports</h1>
		<p class="text-sm text-ink-soft mt-1">
			Per-day volume and inventory use over time. Tap a day on the chart to see
			what made it up. Days follow the family's timezone.
		</p>
	</div>

	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

	{#if loaded}
		<div class="flex flex-wrap items-center gap-3 mb-4">
			<div class="segmented inline-flex rounded-lg border border-line-soft overflow-hidden" role="group" aria-label="Range">
				{#each RANGES as r (r)}
					<button
						type="button"
						aria-pressed={days === r}
						class="h-9 px-3 text-sm font-semibold {days === r ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft hover:bg-surface2'}"
						on:click={() => onRange(r)}
					>{r}d</button>
				{/each}
			</div>

			<label class="flex items-center gap-2 text-sm text-ink-soft">
				<span>For</span>
				<select class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm" on:change={onMember}>
					<option value="" selected={memberId === null}>Whole family</option>
					{#each members as m (m.id)}
						<option value={m.id} selected={memberId === m.id}>{m.name}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if totals}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
				<div class="bg-surface rounded-lg border border-line-soft px-3 py-2.5">
					<p class="text-xs text-ink-soft leading-tight">Pumped</p>
					<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{totals.pumpedOz.toFixed(1)} oz</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{(totals.pumpedOz / days).toFixed(1)} oz / day</p>
				</div>
				<div class="bg-surface rounded-lg border border-line-soft px-3 py-2.5">
					<p class="text-xs text-ink-soft leading-tight">Formula</p>
					<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{totals.formulaOz.toFixed(1)} oz</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{(totals.formulaOz / days).toFixed(1)} oz / day</p>
				</div>
				<div class="bg-surface rounded-lg border border-line-soft px-3 py-2.5">
					<p class="text-xs text-ink-soft leading-tight">Bottled milk</p>
					<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{totals.bottleOz.toFixed(1)} oz</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{(totals.bottleOz / days).toFixed(1)} oz / day</p>
				</div>
				<div class="bg-surface rounded-lg border border-line-soft px-3 py-2.5">
					<p class="text-xs text-ink-soft leading-tight">Inventory used</p>
					<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{totals.used.toFixed(1)}</p>
					<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{(totals.used / days).toFixed(1)} / day</p>
				</div>
			</div>
		{/if}

		<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-4">
			<div class="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Series">
				{#each SERIES_LABELS as [key, label] (key)}
					<button
						type="button"
						aria-pressed={enabled[key]}
						class="h-8 px-3 rounded-full text-xs font-semibold border {enabled[key] ? 'bg-accent-soft border-accent text-ink' : 'bg-surface2 border-line-soft text-ink-soft'}"
						on:click={() => (enabled = { ...enabled, [key]: !enabled[key] })}
					>{label}</button>
				{/each}
			</div>

			{#if loading}
				<p class="text-sm text-ink-soft py-8">Loading…</p>
			{:else if report && report.days.some((d) => d.pumpedOz || d.formulaOz || d.bottleOz || d.used)}
				<DailySeriesChart {report} {enabled} onSelectDay={(date) => (selectedDate = date)} />
				<p class="text-xs text-ink-soft mt-2">Volume is on the left axis (oz); inventory units on the right. Dashed is inventory.</p>
			{:else if report}
				<p class="text-sm text-ink-soft py-8">Nothing recorded in this window yet.</p>
			{/if}
		</div>

		{#if selected}
			<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-4" data-testid="day-detail">
				<div class="flex items-baseline justify-between gap-3 mb-2">
					<h2 class="text-lg font-display font-semibold text-ink">{shortDate(selected.date)}</h2>
					<button type="button" class="text-xs text-ink-soft hover:text-ink" on:click={() => (selectedDate = null)}>Close</button>
				</div>
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
					<p><span class="text-ink-soft">Pumped</span><br /><span class="font-semibold text-ink">{selected.pumpedOz.toFixed(1)} oz</span></p>
					<p><span class="text-ink-soft">Formula</span><br /><span class="font-semibold text-ink">{selected.formulaOz.toFixed(1)} oz</span></p>
					<p><span class="text-ink-soft">Bottled milk</span><br /><span class="font-semibold text-ink">{selected.bottleOz.toFixed(1)} oz</span></p>
					<p><span class="text-ink-soft">Inventory used</span><br /><span class="font-semibold text-ink">{selected.used.toFixed(1)}</span></p>
				</div>
				{#if selectedItems.length}
					<ul class="mt-3 text-sm text-ink-soft border-t border-line-soft pt-2">
						{#each selectedItems as item (item.itemId)}
							<li>{item.name} — {item.daily[selected.date].toFixed(1)} {item.unit}</li>
						{/each}
					</ul>
				{/if}
				{#if selected.corrected !== 0}
					<p class="mt-2 text-xs text-ink-soft">Also recounted: net {selected.corrected > 0 ? '+' : ''}{selected.corrected.toFixed(1)} units (a correction, not use).</p>
				{/if}
			</div>
		{/if}

		{#if report && report.items.length}
			<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4">
				<h2 class="text-lg font-display font-semibold text-ink mb-3">What got used</h2>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-ink-soft">
								<th class="py-1 pr-3 font-medium">Item</th>
								<th class="py-1 pr-3 font-medium">Category</th>
								<th class="py-1 pr-3 font-medium text-right">Total used</th>
								<th class="py-1 font-medium text-right">Per day</th>
							</tr>
						</thead>
						<tbody>
							{#each report.items as item (item.itemId)}
								{@const total = itemTotal(item.daily)}
								<tr class="border-t border-line-soft">
									<td class="py-1.5 pr-3 text-ink">{item.name}</td>
									<td class="py-1.5 pr-3 text-ink-soft">{item.category}</td>
									<td class="py-1.5 pr-3 text-right text-ink">{total.toFixed(1)} {item.unit}</td>
									<td class="py-1.5 text-right text-ink-soft">{(total / days).toFixed(1)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}
</div>
