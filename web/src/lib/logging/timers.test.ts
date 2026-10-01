import { describe, it, expect } from 'vitest';
import {
	emptyBreastTimer, toggleSide, timerHasTime, sideTotals, isStaleTimer,
	loadBreastTimer, saveBreastTimer, clearBreastTimer, BREAST_TIMER_STALE_MS, type KeyValueStore,
} from './timers';

function memoryStore(): KeyValueStore & { data: Record<string, string> } {
	const data: Record<string, string> = {};
	return {
		data,
		getItem: (k) => (k in data ? data[k] : null),
		setItem: (k, v) => { data[k] = v; },
		removeItem: (k) => { delete data[k]; },
	};
}

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
const MIN = 60000;

describe('toggleSide', () => {
	it('starts then pauses a side, banking elapsed time', () => {
		let s = toggleSide(emptyBreastTimer(), 'left', T0);
		expect(s.leftStartedAt).toBe(T0);
		expect(timerHasTime(s)).toBe(true);
		s = toggleSide(s, 'left', T0 + 5 * MIN);
		expect(s.leftStartedAt).toBeNull();
		expect(s.leftElapsed).toBe(5 * MIN);
		expect(s.leftLastAt).toBe(T0 + 5 * MIN);
	});

	it('does not mutate the previous state', () => {
		const before = emptyBreastTimer();
		toggleSide(before, 'right', T0);
		expect(before.rightStartedAt).toBeNull();
	});
});

describe('sideTotals', () => {
	it('includes the running side live', () => {
		let s = toggleSide(emptyBreastTimer(), 'left', T0);
		s = toggleSide(s, 'left', T0 + 4 * MIN);
		s = toggleSide(s, 'right', T0 + 4 * MIN);
		const t = sideTotals(s, T0 + 10 * MIN);
		expect(t.leftMs).toBe(4 * MIN);
		expect(t.rightMs).toBe(6 * MIN);
		expect(t.totalMs).toBe(10 * MIN);
	});
});

describe('isStaleTimer', () => {
	it('is not stale while recently active', () => {
		const s = toggleSide(emptyBreastTimer(), 'left', T0);
		expect(isStaleTimer(s, T0 + MIN)).toBe(false);
	});

	it('treats an idle paused timer older than the limit as abandoned', () => {
		let s = toggleSide(emptyBreastTimer(), 'left', T0);
		s = toggleSide(s, 'left', T0 + 8 * MIN);
		expect(isStaleTimer(s, T0 + 8 * MIN + BREAST_TIMER_STALE_MS + 1)).toBe(true);
		expect(isStaleTimer(s, T0 + 8 * MIN + BREAST_TIMER_STALE_MS - 1)).toBe(false);
	});

	it('treats a side left running for hours as abandoned even if the other side was touched recently', () => {
		let s = toggleSide(emptyBreastTimer(), 'right', T0);
		const now = T0 + BREAST_TIMER_STALE_MS + 10 * MIN;
		s = toggleSide(s, 'left', now - MIN);
		s = toggleSide(s, 'left', now);
		expect(isStaleTimer(s, now)).toBe(true);
	});

	it('an empty timer is never stale', () => {
		expect(isStaleTimer(emptyBreastTimer(), T0 + 99 * BREAST_TIMER_STALE_MS)).toBe(false);
	});
});

describe('persistence', () => {
	it('round-trips a live timer', () => {
		const store = memoryStore();
		let s = toggleSide(emptyBreastTimer(), 'left', T0);
		s = toggleSide(s, 'left', T0 + 3 * MIN);
		saveBreastTimer(store, 'k', s);
		const loaded = loadBreastTimer(store, 'k', T0 + 5 * MIN);
		expect(loaded.discarded).toBe(false);
		expect(loaded.state).toEqual(s);
	});

	it('discards and removes a stale stored timer instead of reviving it', () => {
		const store = memoryStore();
		let s = toggleSide(emptyBreastTimer(), 'left', T0);
		s = toggleSide(s, 'left', T0 + 3 * MIN);
		saveBreastTimer(store, 'k', s);
		const loaded = loadBreastTimer(store, 'k', T0 + 6 * 60 * MIN);
		expect(loaded.discarded).toBe(true);
		expect(loaded.state).toEqual(emptyBreastTimer());
		expect(store.getItem('k')).toBeNull();
	});

	it('saving an empty timer clears the key', () => {
		const store = memoryStore();
		store.setItem('k', '{"leftElapsed":5}');
		saveBreastTimer(store, 'k', emptyBreastTimer());
		expect(store.getItem('k')).toBeNull();
	});

	it('ignores corrupt storage', () => {
		const store = memoryStore();
		store.setItem('k', 'not json');
		expect(loadBreastTimer(store, 'k', T0)).toEqual({ state: emptyBreastTimer(), discarded: false });
		clearBreastTimer(store, 'k');
		expect(store.getItem('k')).toBeNull();
	});
});
