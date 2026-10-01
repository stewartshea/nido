import { describe, it, expect } from 'vitest';
import { lastSide, latestBySide, buildTimerFeed, oppositeSide, sideTotalMs, breastDetail, buildManualBreastFeed } from './breast';

describe('lastSide', () => {
	it('is the side with the newest per-breast timestamp, even on a "both" feed', () => {
		const rows = [
			{ type: 'breast', side: 'both', start_time: '2026-09-29T10:00:00.000Z', left_breast_at: '2026-09-29T10:08:00.000Z', right_breast_at: '2026-09-29T10:20:00.000Z' },
			{ type: 'breast', side: 'left', start_time: '2026-09-29T06:00:00.000Z', end_time: '2026-09-29T06:10:00.000Z' },
		];
		expect(lastSide(rows)).toBe('right');
	});

	it('flips to left when left was the second breast of the newest feed', () => {
		const rows = [
			{ type: 'breast', side: 'both', start_time: '2026-09-29T10:00:00.000Z', right_breast_at: '2026-09-29T10:08:00.000Z', left_breast_at: '2026-09-29T10:20:00.000Z' },
		];
		expect(lastSide(rows)).toBe('left');
	});

	it('falls back to start/end time for legacy single-side rows', () => {
		const rows = [
			{ type: 'breast', side: 'left', start_time: '2026-09-29T08:00:00.000Z' },
			{ type: 'breast', side: 'right', start_time: '2026-09-29T11:00:00.000Z' },
		];
		expect(lastSide(rows)).toBe('right');
	});

	it('ignores legacy "both" rows that carry no per-breast timestamps', () => {
		expect(lastSide([{ side: 'both', start_time: '2026-09-29T08:00:00.000Z' }])).toBeNull();
		expect(latestBySide([])).toEqual({ left: null, right: null });
	});

	it('says unknown, not an older side, when the newest feed is a legacy two-sided record', () => {
		const rows = [
			{ type: 'breast', side: 'left', start_time: '2026-09-29T06:00:00.000Z', end_time: '2026-09-29T06:10:00.000Z' },
			{ type: 'breast', side: 'both', start_time: '2026-09-29T10:00:00.000Z', end_time: '2026-09-29T10:20:00.000Z' },
		];
		expect(lastSide(rows)).toBeNull();
	});

	it('suggests the opposite breast', () => {
		expect(oppositeSide('left')).toBe('right');
		expect(oppositeSide('right')).toBe('left');
		expect(oppositeSide(null)).toBe('left');
	});
});

describe('buildTimerFeed', () => {
	const T0 = Date.parse('2026-09-29T10:00:00.000Z');

	it('returns null when nothing was timed', () => {
		expect(buildTimerFeed({ nowMs: T0, leftElapsed: 0, rightElapsed: 0, leftStartedAt: null, rightStartedAt: null, leftLastAt: null, rightLastAt: null })).toBeNull();
	});

	it('records both breasts with the still-running side last', () => {
		const p = buildTimerFeed({
			nowMs: T0 + 20 * 60000,
			leftElapsed: 8 * 60000,
			rightElapsed: 0,
			leftStartedAt: null,
			rightStartedAt: T0 + 8 * 60000,
			leftLastAt: T0 + 8 * 60000,
			rightLastAt: null,
		})!;
		expect(p.side).toBe('both');
		expect(p.startTime).toBe(new Date(T0).toISOString());
		expect(p.leftDuration).toBe(8 * 60000);
		expect(p.rightDuration).toBe(12 * 60000);
		expect(p.leftBreastAt).toBe(new Date(T0 + 8 * 60000).toISOString());
		expect(p.rightBreastAt).toBe(new Date(T0 + 20 * 60000).toISOString());
		expect(lastSide([{ type: 'breast', side: p.side, start_time: p.startTime, end_time: p.endTime, left_breast_at: p.leftBreastAt, right_breast_at: p.rightBreastAt }])).toBe('right');
	});

	it('is single-sided when only one breast was used', () => {
		const p = buildTimerFeed({ nowMs: T0 + 5 * 60000, leftElapsed: 0, rightElapsed: 0, leftStartedAt: T0, rightStartedAt: null, leftLastAt: T0, rightLastAt: null })!;
		expect(p.side).toBe('left');
		expect(p.rightBreastAt).toBeUndefined();
	});
});

describe('sideTotalMs', () => {
	it('counts per-breast durations from both-side feeds and falls back to duration for legacy rows', () => {
		const rows = [
			{ side: 'both', duration: 20 * 60000, left_duration: 8 * 60000, right_duration: 12 * 60000 },
			{ side: 'left', duration: 5 * 60000 },
			{ side: 'right', duration: 3 * 60000 },
		];
		expect(sideTotalMs(rows, 'left')).toBe(13 * 60000);
		expect(sideTotalMs(rows, 'right')).toBe(15 * 60000);
	});
});

describe('breastDetail', () => {
	it('shows each breast with its own timing', () => {
		expect(breastDetail({ left_duration: 8 * 60000, right_duration: 12 * 60000 + 5000 })).toBe('L 8m · R 12m 5s');
		expect(breastDetail({ left_breast_at: '2026-09-29T10:00:00.000Z' })).toBe('L');
		expect(breastDetail({})).toBe('');
	});

	it('marks the breast used last on a two-sided feed', () => {
		expect(breastDetail({
			left_duration: 2000, right_duration: 3000,
			left_breast_at: '2026-10-01T13:55:38.000Z', right_breast_at: '2026-10-01T13:55:36.000Z',
		})).toBe('L 2s (last) · R 3s');
		expect(breastDetail({
			left_duration: 2000, right_duration: 3000,
			left_breast_at: '2026-09-30T00:40:52.000Z', right_breast_at: '2026-09-30T00:41:05.000Z',
		})).toBe('L 2s · R 3s (last)');
	});

	it('marks the last breast even without durations', () => {
		expect(breastDetail({
			left_breast_at: '2026-10-01T10:00:00.000Z', right_breast_at: '2026-10-01T10:05:00.000Z',
		})).toBe('L · R (last)');
	});

	it('does not mark a one-sided feed, where the side is already unambiguous', () => {
		expect(breastDetail({ left_duration: 5000, left_breast_at: '2026-10-01T10:00:00.000Z' })).toBe('L 5s');
	});

	it('does not mark when both timestamps are equal', () => {
		const at = '2026-10-01T10:00:00.000Z';
		expect(breastDetail({ left_duration: 1000, right_duration: 1000, left_breast_at: at, right_breast_at: at })).toBe('L 1s · R 1s');
	});
});

describe('buildManualBreastFeed', () => {
	const S = Date.parse('2026-09-29T10:00:00.000Z');
	const at = (ms: number) => new Date(ms).toISOString();

	it('records a timed single-side feed', () => {
		const f = buildManualBreastFeed({ startMs: S, side: 'right', rightMin: 12 });
		expect(f).toEqual({ startTime: at(S), endTime: at(S + 12 * 60000), side: 'right', rightBreastAt: at(S + 12 * 60000), rightDuration: 12 * 60000 });
	});

	it('records an untimed single-side feed with no end time', () => {
		const f = buildManualBreastFeed({ startMs: S, side: 'left' });
		expect(f).toEqual({ startTime: at(S), side: 'left', leftBreastAt: at(S) });
	});

	it('orders a two-sided feed so the chosen breast is last, with both durations', () => {
		const f = buildManualBreastFeed({ startMs: S, side: 'both', endsOn: 'left', leftMin: 5, rightMin: 10 });
		expect(f.rightBreastAt).toBe(at(S + 10 * 60000));
		expect(f.leftBreastAt).toBe(at(S + 15 * 60000));
		expect(f.endTime).toBe(at(S + 15 * 60000));
		expect(f.leftDuration).toBe(5 * 60000);
		expect(f.rightDuration).toBe(10 * 60000);
		expect(lastSide([{ type: 'breast', side: f.side, start_time: f.startTime, end_time: f.endTime, left_breast_at: f.leftBreastAt, right_breast_at: f.rightBreastAt }])).toBe('left');
	});

	it('still orders an untimed two-sided feed', () => {
		const f = buildManualBreastFeed({ startMs: S, side: 'both' });
		expect(lastSide([{ type: 'breast', side: f.side, start_time: f.startTime, left_breast_at: f.leftBreastAt, right_breast_at: f.rightBreastAt }])).toBe('right');
		expect(f.endTime).toBeUndefined();
	});

	it('ignores minutes entered for a side that was not used', () => {
		const f = buildManualBreastFeed({ startMs: S, side: 'left', leftMin: 4, rightMin: 9 });
		expect(f.rightDuration).toBeUndefined();
		expect(f.leftDuration).toBe(4 * 60000);
	});
});
