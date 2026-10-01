export type BreastSide = 'left' | 'right';

export interface BreastRow {
	type?: string | null;
	side?: string | null;
	start_time?: string | null;
	end_time?: string | null;
	left_breast_at?: string | null;
	right_breast_at?: string | null;
}

function ms(value: string | null | undefined): number | null {
	if (!value) return null;
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? null : t;
}

/**
 * Most recent time each breast was used across the given feedings. Prefers the
 * explicit per-breast timestamps; for older single-side rows falls back to the
 * row's own end/start time. A legacy "both" row has no way to say which side
 * was last, so it contributes nothing.
 */
export function latestBySide(rows: BreastRow[]): { left: number | null; right: number | null } {
	let left: number | null = null;
	let right: number | null = null;
	const bump = (cur: number | null, next: number | null) => (next !== null && (cur === null || next > cur) ? next : cur);
	for (const f of rows) {
		const fallback = ms(f.end_time) ?? ms(f.start_time);
		left = bump(left, ms(f.left_breast_at) ?? (f.side === 'left' ? fallback : null));
		right = bump(right, ms(f.right_breast_at) ?? (f.side === 'right' ? fallback : null));
	}
	return { left, right };
}

/**
 * The breast used most recently. The newest feed decides: if it carries no
 * way to tell which side came last (an old two-sided record), the answer is
 * "unknown" rather than a guess from an older feed.
 */
export function lastSide(rows: BreastRow[]): BreastSide | null {
	let newest: { at: number; left: number | null; right: number | null } | null = null;
	for (const f of rows) {
		const { left, right } = latestBySide([f]);
		const at = Math.max(left ?? -Infinity, right ?? -Infinity, ms(f.end_time) ?? -Infinity, ms(f.start_time) ?? -Infinity);
		if (at === -Infinity) continue;
		if (!newest || at > newest.at) newest = { at, left, right };
	}
	if (!newest) return null;
	if (newest.left === null && newest.right === null) return null;
	if (newest.left === null) return 'right';
	if (newest.right === null) return 'left';
	return newest.right > newest.left ? 'right' : 'left';
}

export function oppositeSide(side: BreastSide | null): BreastSide {
	return side === 'left' ? 'right' : 'left';
}

export interface TimerSnapshot {
	nowMs: number;
	leftElapsed: number;
	rightElapsed: number;
	leftStartedAt: number | null;
	rightStartedAt: number | null;
	leftLastAt: number | null;
	rightLastAt: number | null;
}

export interface BreastFeedFields {
	startTime: string;
	endTime?: string;
	side: 'left' | 'right' | 'both';
	leftBreastAt?: string;
	rightBreastAt?: string;
	leftDuration?: number;
	rightDuration?: number;
}

export type TimerFeedPayload = BreastFeedFields & { endTime: string };

/** Fold any still-running side into its elapsed time and describe the feed. */
export function buildTimerFeed(t: TimerSnapshot): TimerFeedPayload | null {
	const leftMs = t.leftElapsed + (t.leftStartedAt ? t.nowMs - t.leftStartedAt : 0);
	const rightMs = t.rightElapsed + (t.rightStartedAt ? t.nowMs - t.rightStartedAt : 0);
	if (leftMs <= 0 && rightMs <= 0 && !t.leftStartedAt && !t.rightStartedAt) return null;

	const leftUsed = leftMs > 0 || !!t.leftStartedAt;
	const rightUsed = rightMs > 0 || !!t.rightStartedAt;
	const leftLast = t.leftStartedAt ? t.nowMs : t.leftLastAt;
	const rightLast = t.rightStartedAt ? t.nowMs : t.rightLastAt;

	const starts: number[] = [];
	if (leftUsed) starts.push((leftLast ?? t.nowMs) - leftMs);
	if (rightUsed) starts.push((rightLast ?? t.nowMs) - rightMs);

	const payload: TimerFeedPayload = {
		startTime: new Date(Math.min(...starts)).toISOString(),
		endTime: new Date(t.nowMs).toISOString(),
		side: leftUsed && rightUsed ? 'both' : leftUsed ? 'left' : 'right',
	};
	if (leftUsed) {
		payload.leftBreastAt = new Date(leftLast ?? t.nowMs).toISOString();
		payload.leftDuration = Math.round(leftMs);
	}
	if (rightUsed) {
		payload.rightBreastAt = new Date(rightLast ?? t.nowMs).toISOString();
		payload.rightDuration = Math.round(rightMs);
	}
	return payload;
}

/** Total milliseconds fed from one breast, counting both single-side and "both" feeds. */
export function sideTotalMs(rows: (BreastRow & { duration?: number | null; left_duration?: number | null; right_duration?: number | null })[], side: BreastSide): number {
	return rows.reduce((sum, f) => {
		const per = side === 'left' ? f.left_duration : f.right_duration;
		if (per !== null && per !== undefined) return sum + per;
		return sum + (f.side === side ? f.duration || 0 : 0);
	}, 0);
}

function fmtDur(ms: number): string {
	const total = Math.round(ms / 1000);
	const m = Math.floor(total / 60);
	const sec = total % 60;
	return m > 0 ? `${m}m${sec ? ` ${sec}s` : ''}` : `${sec}s`;
}

/**
 * Per-breast summary for a record, e.g. "L 8m · R 12m (last)". The breast used
 * last is marked so a two-sided feed still says which side finished it — that
 * is the one to start from next time. Only marked when both sides have a
 * timestamp to compare, so a one-sided feed is not labelled redundantly.
 */
export function breastDetail(f: BreastRow & { left_duration?: number | null; right_duration?: number | null }): string {
	const leftMs = f.left_breast_at ? new Date(f.left_breast_at).getTime() : null;
	const rightMs = f.right_breast_at ? new Date(f.right_breast_at).getTime() : null;
	const last: 'left' | 'right' | null =
		leftMs !== null && rightMs !== null ? (leftMs > rightMs ? 'left' : rightMs > leftMs ? 'right' : null) : null;
	const mark = (side: 'left' | 'right') => (last === side ? ' (last)' : '');

	const parts: string[] = [];
	if (f.left_duration != null) parts.push(`L ${fmtDur(f.left_duration)}${mark('left')}`);
	else if (f.left_breast_at) parts.push(`L${mark('left')}`);
	if (f.right_duration != null) parts.push(`R ${fmtDur(f.right_duration)}${mark('right')}`);
	else if (f.right_breast_at) parts.push(`R${mark('right')}`);
	return parts.join(' · ');
}

export interface ManualBreastInput {
	startMs: number;
	side: 'left' | 'right' | 'both';
	/** For a two-sided feed: the breast that came second. Defaults to right. */
	endsOn?: BreastSide;
	leftMin?: number | null;
	rightMin?: number | null;
}

function minutesToMs(min: number | null | undefined): number | undefined {
	return min && min > 0 ? Math.round(min * 60000) : undefined;
}

/**
 * Describe a hand-entered breast feed (or pump) the same way the timer does,
 * so a backfilled record still says which breast came last and for how long.
 */
export function buildManualBreastFeed(i: ManualBreastInput): BreastFeedFields {
	const dur: Record<BreastSide, number | undefined> = {
		left: i.side === 'right' ? undefined : minutesToMs(i.leftMin),
		right: i.side === 'left' ? undefined : minutesToMs(i.rightMin),
	};
	const iso = (t: number) => new Date(t).toISOString();

	if (i.side !== 'both') {
		const d = dur[i.side];
		const at = i.startMs + (d ?? 0);
		const out: BreastFeedFields = { startTime: iso(i.startMs), side: i.side };
		if (d !== undefined) out.endTime = iso(at);
		if (i.side === 'left') {
			out.leftBreastAt = iso(at);
			if (d !== undefined) out.leftDuration = d;
		} else {
			out.rightBreastAt = iso(at);
			if (d !== undefined) out.rightDuration = d;
		}
		return out;
	}

	const second: BreastSide = i.endsOn ?? 'right';
	const first: BreastSide = second === 'left' ? 'right' : 'left';
	const firstMs = dur[first] ?? 0;
	const secondMs = dur[second] ?? 0;
	const timed = firstMs + secondMs > 0;
	const firstAt = i.startMs + firstMs;
	const secondAt = timed ? firstAt + secondMs : i.startMs + 1000;
	const out: BreastFeedFields = {
		startTime: iso(i.startMs),
		side: 'both',
		[`${first}BreastAt`]: iso(firstAt),
		[`${second}BreastAt`]: iso(secondAt),
	} as BreastFeedFields;
	if (timed) out.endTime = iso(secondAt);
	if (dur.left !== undefined) out.leftDuration = dur.left;
	if (dur.right !== undefined) out.rightDuration = dur.right;
	return out;
}
