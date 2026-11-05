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
 * A *paused* feed timer nobody touched for hours is an abandoned one, not a
 * feed in progress. Reviving it is what made old timings reappear at the next
 * feed.
 *
 * A timer that is still running is never stale, however old its start looks.
 * The phone can be parked mid-feed for a long time — a nap, a night wake-up,
 * a screen that locked and came back hours later — and deleting the one timer
 * that was genuinely running is exactly how a caregiver loses the feed they
 * were recording. An abandoned running timer stays on screen and can be
 * cancelled; a silently discarded one cannot be recovered.
 */
export function isStaleTimer(s: BreastTimerState, now: number, maxMs = BREAST_TIMER_STALE_MS): boolean {
	if (!timerHasTime(s)) return false;
	if (timerIsRunning(s)) return false;
	const last = lastActivityAt(s);
	return last !== null && now - last > maxMs;
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function numOrNull(v: unknown): number | null {
	return isFiniteNumber(v) && v > 0 ? v : null;
}

/**
 * Parse a stored breast/pump timer without judging it.
 *
 * Reads must not mutate: the "In progress" strip re-reads these keys every
 * second, and a listing that deletes is a listing that can lose a timer the
 * caregiver never opened. Staleness is applied by the callers that own the
 * decision — `loadBreastTimer` (opening the logger) and `storedTimers`
 * (filtering the list, read-only).
 */
export function readBreastTimer(store: KeyValueStore, key: string): BreastTimerState {
	try {
		const raw = store.getItem(key);
		if (!raw) return emptyBreastTimer();
		const p = JSON.parse(raw);
		return {
			leftElapsed: isFiniteNumber(p.leftElapsed) && p.leftElapsed > 0 ? p.leftElapsed : 0,
			rightElapsed: isFiniteNumber(p.rightElapsed) && p.rightElapsed > 0 ? p.rightElapsed : 0,
			leftStartedAt: numOrNull(p.leftStartedAt),
			rightStartedAt: numOrNull(p.rightStartedAt),
			leftLastAt: numOrNull(p.leftLastAt),
			rightLastAt: numOrNull(p.rightLastAt),
		};
	} catch {
		return emptyBreastTimer();
	}
}

export function loadBreastTimer(
	store: KeyValueStore,
	key: string,
	now: number,
): { state: BreastTimerState; discarded: boolean } {
	const state = readBreastTimer(store, key);
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

/** Fired on `window` whenever a stored timer starts, stops, or is cleared. */
export const TIMERS_CHANGED_EVENT = 'nido:timers-changed';

export function notifyTimersChanged(): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new Event(TIMERS_CHANGED_EVENT));
}

export type TimerKind = 'feeds' | 'pumping' | 'sleep';

export interface StoredTimer {
	kind: TimerKind;
	elapsedMs: number;
	/** A paused timer still holds banked time and can be resumed. */
	running: boolean;
}

/**
 * The timers still on the device for one member, in the order a caregiver is
 * likely to look for them.
 *
 * Timers live in localStorage precisely so they survive the sheet being
 * closed. Reading them back here gives the page something to show while the
 * sheet is away — without it a parked feed timer is invisible until you open
 * Feeds and happen to pick the right kind.
 *
 * This is a pure read. It used to go through `loadBreastTimer`, which deletes
 * a stale timer — so simply rendering the strip could destroy one. Paused
 * timers past the stale limit are filtered out here instead, and cleaned up
 * the next time their logger is opened.
 */
export function storedTimers(store: KeyValueStore, memberId: number | null, now: number): StoredTimer[] {
	const timers: StoredTimer[] = [];

	for (const [kind, key] of [
		['feeds', feedTimerKey(memberId)],
		['pumping', pumpTimerKey(memberId)],
	] as const) {
		const state = readBreastTimer(store, key);
		if (!timerHasTime(state) || isStaleTimer(state, now)) continue;
		timers.push({
			kind,
			elapsedMs: sideTotals(state, now).totalMs,
			running: timerIsRunning(state),
		});
	}

	let sleepStartedAt: number | null = null;
	try {
		const raw = store.getItem(sleepTimerKey(memberId));
		const startedAt = raw ? Number(JSON.parse(raw).startedAt) : NaN;
		if (isFiniteNumber(startedAt) && startedAt > 0) sleepStartedAt = startedAt;
	} catch { /* corrupt or unavailable */ }
	if (sleepStartedAt !== null) {
		timers.push({ kind: 'sleep', elapsedMs: Math.max(0, now - sleepStartedAt), running: true });
	}

	return timers;
}
