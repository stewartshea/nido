export const BREAST_TIMER_STALE_MS = 3 * 60 * 60 * 1000;

export type Side = 'left' | 'right';

export interface BreastTimerState {
	leftElapsed: number;
	rightElapsed: number;
	leftStartedAt: number | null;
	rightStartedAt: number | null;
	leftLastAt: number | null;
	rightLastAt: number | null;
}

export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function emptyBreastTimer(): BreastTimerState {
	return {
		leftElapsed: 0,
		rightElapsed: 0,
		leftStartedAt: null,
		rightStartedAt: null,
		leftLastAt: null,
		rightLastAt: null,
	};
}

/** Start the side if idle, pause it (banking elapsed time) if running. */
export function toggleSide(s: BreastTimerState, side: Side, now: number): BreastTimerState {
	const next = { ...s };
	if (side === 'left') {
		if (next.leftStartedAt) {
			next.leftElapsed += now - next.leftStartedAt;
			next.leftStartedAt = null;
		} else {
			next.leftStartedAt = now;
		}
		next.leftLastAt = now;
	} else {
		if (next.rightStartedAt) {
			next.rightElapsed += now - next.rightStartedAt;
			next.rightStartedAt = null;
		} else {
			next.rightStartedAt = now;
		}
		next.rightLastAt = now;
	}
	return next;
}

export function timerHasTime(s: BreastTimerState): boolean {
	return s.leftElapsed > 0 || s.rightElapsed > 0 || s.leftStartedAt !== null || s.rightStartedAt !== null;
}

export function timerIsRunning(s: BreastTimerState): boolean {
	return s.leftStartedAt !== null || s.rightStartedAt !== null;
}

export function sideTotals(s: BreastTimerState, now: number): { leftMs: number; rightMs: number; totalMs: number } {
	const leftMs = s.leftElapsed + (s.leftStartedAt ? now - s.leftStartedAt : 0);
	const rightMs = s.rightElapsed + (s.rightStartedAt ? now - s.rightStartedAt : 0);
	return { leftMs, rightMs, totalMs: leftMs + rightMs };
}

function lastActivityAt(s: BreastTimerState): number | null {
	const marks = [s.leftLastAt, s.rightLastAt, s.leftStartedAt, s.rightStartedAt].filter((m): m is number => m !== null);
	return marks.length ? Math.max(...marks) : null;
}

/**
 * A feed timer nobody touched for hours (or a side left running that long) is
 * an abandoned one, not a feed in progress. Reviving it is what made old
 * timings reappear at the next feed.
 */
export function isStaleTimer(s: BreastTimerState, now: number, maxMs = BREAST_TIMER_STALE_MS): boolean {
	if (!timerHasTime(s)) return false;
	if (s.leftStartedAt !== null && now - s.leftStartedAt > maxMs) return true;
	if (s.rightStartedAt !== null && now - s.rightStartedAt > maxMs) return true;
	const last = lastActivityAt(s);
	return last !== null && now - last > maxMs;
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function numOrNull(v: unknown): number | null {
	return isFiniteNumber(v) && v > 0 ? v : null;
}

export function loadBreastTimer(
	store: KeyValueStore,
	key: string,
	now: number,
): { state: BreastTimerState; discarded: boolean } {
	let state = emptyBreastTimer();
	try {
		const raw = store.getItem(key);
		if (raw) {
			const p = JSON.parse(raw);
			state = {
				leftElapsed: isFiniteNumber(p.leftElapsed) && p.leftElapsed > 0 ? p.leftElapsed : 0,
				rightElapsed: isFiniteNumber(p.rightElapsed) && p.rightElapsed > 0 ? p.rightElapsed : 0,
				leftStartedAt: numOrNull(p.leftStartedAt),
				rightStartedAt: numOrNull(p.rightStartedAt),
				leftLastAt: numOrNull(p.leftLastAt),
				rightLastAt: numOrNull(p.rightLastAt),
			};
		}
	} catch {
		state = emptyBreastTimer();
	}
	if (isStaleTimer(state, now)) {
		try { store.removeItem(key); } catch { /* storage unavailable */ }
		return { state: emptyBreastTimer(), discarded: true };
	}
	return { state, discarded: false };
}

export function saveBreastTimer(store: KeyValueStore, key: string, s: BreastTimerState): void {
	try {
		if (timerHasTime(s)) store.setItem(key, JSON.stringify(s));
		else store.removeItem(key);
	} catch { /* storage full or unavailable */ }
}

export function clearBreastTimer(store: KeyValueStore, key: string): void {
	try { store.removeItem(key); } catch { /* storage unavailable */ }
}

export function feedTimerKey(memberId: number | null): string {
	return `nido.timer.feed.${memberId ?? 0}`;
}

export function pumpTimerKey(memberId: number | null): string {
	return `nido.timer.pump.${memberId ?? 0}`;
}

export function sleepTimerKey(memberId: number | null): string {
	return `nido.timer.sleep.${memberId ?? 0}`;
}
