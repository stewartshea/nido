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

export function lastSide(rows: BreastRow[]): BreastSide | null {
	const { left, right } = latestBySide(rows);
	if (left === null && right === null) return null;
	if (left === null) return 'right';
	if (right === null) return 'left';
	return right > left ? 'right' : 'left';
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

export interface TimerFeedPayload {
	startTime: string;
	endTime: string;
	side: 'left' | 'right' | 'both';
	leftBreastAt?: string;
	rightBreastAt?: string;
	leftDuration?: number;
	rightDuration?: number;
}

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

/** e.g. "L 8m · R 12m" for a timed feed, or "pumped left" for a pump session. */
export function breastDetail(f: BreastRow & { left_duration?: number | null; right_duration?: number | null }): string {
	const parts: string[] = [];
	if (f.left_duration != null) parts.push(`L ${fmtDur(f.left_duration)}`);
	else if (f.left_breast_at) parts.push('L');
	if (f.right_duration != null) parts.push(`R ${fmtDur(f.right_duration)}`);
	else if (f.right_breast_at) parts.push('R');
	return parts.join(' · ');
}
