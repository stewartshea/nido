<script lang="ts">
	import { todayKey, dayKeyOffset, zonedDayKey } from '$lib/logging/format';

	/**
	 * The small version of the Reports chart, for one item: how much of it left
	 * the shelf each day over a short window. Bars rather than a line, because
	 * usage is a count per day and many days are honestly zero.
	 *
	 * Buckets on the family's clock via `zonedDayKey`, the same day key the
	 * server report uses, so the sparkline and the Reports page never disagree
	 * about which day a use happened on.
	 */
	export let adjustments: Array<{ change: number | string; reason: string; created_at: string }> = [];
	export let unit = 'count';
	export let days = 30;

	const BAR_W = 2.4;
	const GAP = 1.2;
	const H = 44;

	$: keys = Array.from({ length: days }, (_, i) => dayKeyOffset(todayKey(), -(days - 1 - i)));

	// Usage only — the same "negative change with reason 'used'" the server
	// aggregates. Purchases and recounts stay out.
	$: used = (() => {
		const byDay = new Map(keys.map((k) => [k, 0]));
		for (const a of adjustments) {
			const change = Number(a.change);
			if (!(change < 0) || a.reason !== 'used') continue;
			const key = zonedDayKey(a.created_at);
			if (byDay.has(key)) byDay.set(key, byDay.get(key)! - change);
		}
		return keys.map((k) => byDay.get(k) ?? 0);
	})();

	$: total = Math.round(used.reduce((s, n) => s + n, 0) * 10) / 10;
	$: peak = Math.max(1, ...used);
	$: width = days * (BAR_W + GAP);
	$: from = keys[0] ?? '';
	$: to = keys[keys.length - 1] ?? '';

	/** "Nov 3" for the window edges; bar tooltips carry the exact day. */
	function short(date: string): string {
		if (!date) return '';
		return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

{#if adjustments.length || total > 0}
	<div data-testid="usage-sparkline">
		<svg
			viewBox="0 0 {width} {H}"
			width="100%"
			height="{H}"
			preserveAspectRatio="none"
			role="img"
			aria-label="Daily usage over the last {days} days, {total} {unit} total"
			class="block"
		>
			{#each used as value, i}
				{#if value > 0}
					<rect
						x={i * (BAR_W + GAP)}
						y={H - (value / peak) * H}
						width={BAR_W}
						height={(value / peak) * H}
						rx="0.6"
						fill="rgb(var(--c-primary))"
					>
						<title>{short(keys[i])}: {value} {unit}</title>
					</rect>
				{/if}
			{/each}
		</svg>
		<div class="flex items-center justify-between text-[11px] text-ink-soft mt-0.5">
			<span>{short(from)}</span>
			<span>{total} {unit} over {days} days</span>
			<span>{short(to)}</span>
		</div>
	</div>
{/if}
