// src/lib/logging/feedStats.ts — the quick-reports numbers under Family
// Overview. Extracted verbatim from family/+page.svelte, where the same block
// was copy-pasted into dashboard and home (settings' copy went away with its
// dead lists in the god-pages cleanup).

/** Mean of a list; null when the list is empty, so the UI can show a dash. */
export function avg(a: number[]): number | null {
	if (a.length === 0) return null;
	return a.reduce((s, x) => s + x, 0) / a.length;
}

export interface FeedReports {
	count1d: number;
	count30d: number;
	avgSize1d: number | null;
	avgSize30d: number | null;
	avgDur1d: number | null;
	avgDur30d: number | null;
}

/**
 * Feed counts and averages over the loaded feedings.
 *
 * Only breast, bottle and formula rows count as feeds — a pumping session is
 * milk logistics, not a feed, and solids are not one either. A row needs a
 * positive duration to average into the length stats (a breast feed is timed,
 * a bottle is not) and an amount to average into the size stats; the two are
 * independent. `count30d` is every feed in the list, not just the month window.
 */
export function computeFeedReports(feedings: any[]): FeedReports {
	const now = Date.now();
	const dayAgo = now - 24 * 3600 * 1000;
	const monthAgo = now - 30 * 24 * 3600 * 1000;
	const f = feedings.filter((x) => x.type === 'breast' || x.type === 'bottle' || x.type === 'formula');
	const withDuration = f.filter((x) => x.duration && x.duration > 0);
	const sizes1d = f.filter((x) => new Date(x.start_time).getTime() >= dayAgo && x.amount).map((x) => Number(x.amount));
	const sizes30d = f.filter((x) => new Date(x.start_time).getTime() >= monthAgo && x.amount).map((x) => Number(x.amount));
	const dur1d = withDuration.filter((x) => new Date(x.start_time).getTime() >= dayAgo).map((x) => Number(x.duration));
	const dur30d = withDuration.filter((x) => new Date(x.start_time).getTime() >= monthAgo).map((x) => Number(x.duration));
	return {
		count1d: f.filter((x) => new Date(x.start_time).getTime() >= dayAgo).length,
		count30d: f.length,
		avgSize1d: avg(sizes1d),
		avgSize30d: avg(sizes30d),
		avgDur1d: avg(dur1d),
		avgDur30d: avg(dur30d),
	};
}

/** "1h 05m 30s" — hours omitted until there is one, minutes/seconds padded. */
export function formatElapsed(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return `${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
