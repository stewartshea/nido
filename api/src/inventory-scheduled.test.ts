// src/inventory-scheduled.test.ts
import { describe, it, expect } from 'vitest';
import { dueCycles, nextConsumptionAt } from './inventory';
import { MS_PER_DAY } from './inventory';

const T0 = Date.parse('2026-10-01T09:00:00.000Z');
const days = (n: number) => T0 + n * MS_PER_DAY;

describe('dueCycles', () => {
	it('is silent for an item with no cadence', () => {
		expect(dueCycles({}, T0)).toEqual({ due: 0, alreadyApplied: 0, total: 0 });
		expect(dueCycles({ consume_interval_days: null, consume_started_at: null }, T0).due).toBe(0);
	});

	it('is silent before the first cycle completes', () => {
		expect(dueCycles({ consume_interval_days: 1, consume_started_at: new Date(T0).toISOString() }, T0).due).toBe(0);
		expect(dueCycles({ consume_interval_days: 1, consume_started_at: new Date(T0).toISOString() }, days(1) - 1000).due).toBe(0);
	});

	it('reports one cycle the moment it completes', () => {
		expect(dueCycles({ consume_interval_days: 1, consume_started_at: new Date(T0).toISOString() }, days(1)).due).toBe(1);
	});

	it('counts whole cycles only', () => {
		const anchor = { consume_interval_days: 14, consume_started_at: new Date(T0).toISOString() };
		expect(dueCycles(anchor, days(13)).due).toBe(0);
		expect(dueCycles(anchor, days(14)).due).toBe(1);
		expect(dueCycles(anchor, days(27)).due).toBe(1);
		expect(dueCycles(anchor, days(28)).due).toBe(2);
	});

	it('catches up every missed cycle after a long gap', () => {
		// Ten days of a daily item, opened only now: all ten are recorded, not one.
		const anchor = { consume_interval_days: 1, consume_started_at: new Date(days(-10)).toISOString() };
		expect(dueCycles(anchor, T0).due).toBe(10);
	});

	it('does not re-report cycles already applied', () => {
		// A daily item started three days ago whose three cycles are all recorded.
		const anchor = { consume_interval_days: 1, consume_started_at: new Date(days(-3)).toISOString(), consume_cycles_applied: 3 };
		expect(dueCycles(anchor, T0)).toEqual({ due: 0, alreadyApplied: 3, total: 3 });
		// Two more days pass, so exactly two become outstanding.
		expect(dueCycles(anchor, days(2)).due).toBe(2);
	});
});

describe('nextConsumptionAt', () => {
	it('gives the next due date once catch-up is settled', () => {
		// Started three hours ago on a daily cadence: nothing outstanding yet, so
		// the next due date is one interval after the anchor.
		const item = { consume_interval_days: 1, consume_started_at: new Date(T0 - 3 * 3600 * 1000).toISOString() };
		expect(nextConsumptionAt(item, T0)).toBe(new Date(T0 - 3 * 3600 * 1000 + MS_PER_DAY).toISOString());
	});

	it('is null while catch-up is still outstanding, to avoid promising a stale date', () => {
		const item = { consume_interval_days: 1, consume_started_at: new Date(days(-5)).toISOString(), consume_cycles_applied: 0 };
		expect(nextConsumptionAt(item, T0)).toBeNull();
	});

	it('is null for an item with no cadence', () => {
		expect(nextConsumptionAt({}, T0)).toBeNull();
	});
});
