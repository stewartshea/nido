import { describe, it, expect } from 'vitest';
import { lastSide, latestBySide, buildTimerFeed, oppositeSide, sideTotalMs, breastDetail } from './breast';

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
		expect(breastDetail({ left_duration: 8 * 60000, right_duration: 12 * 60000 + 5000, left_breast_at: 'x', right_breast_at: 'y' })).toBe('L 8m · R 12m 5s');
		expect(breastDetail({ left_breast_at: '2026-09-29T10:00:00.000Z' })).toBe('L');
		expect(breastDetail({})).toBe('');
	});
});
