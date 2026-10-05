// src/inventory-signals.test.ts
import { describe, it, expect } from 'vitest';
import {
	SIGNALS, signalByName, compare, evaluateRules, type InventoryRule, type RuleState, type SignalContext,
} from './inventory-signals';
import { MS_PER_DAY } from './inventory';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * MS_PER_DAY).toISOString();

const rule = (over: Partial<InventoryRule> = {}): InventoryRule => ({
	id: 1, itemId: 10, category: null, signal: 'days_of_cover', comparator: 'lte',
	threshold: 7, repeatDays: null, enabled: true, ...over,
});

function values(map: Record<number, Record<string, number | null>>): Map<number, Map<string, number | null>> {
	return new Map(Object.entries(map).map(([k, v]) => [Number(k), new Map(Object.entries(v))]));
}

function ctx(over: Partial<SignalContext> = {}): SignalContext {
	return {
		item: { quantity: 10 },
		adjustments: [],
		nowMs: NOW,
		...over,
	};
}

describe('signal registry', () => {
	it('publishes every signal with a label and an explanation, so the picker is self-describing', () => {
		expect(SIGNALS.length).toBeGreaterThanOrEqual(4);
		for (const s of SIGNALS) {
			expect(s.name).toMatch(/^[a-z0-9_]+$/);
			expect(s.label.length).toBeGreaterThan(0);
			expect(s.describe.length).toBeGreaterThan(0);
		}
		expect(signalByName('size_up_in_days')).toBeTruthy();
		expect(signalByName('nope')).toBeUndefined();
	});

	it('returns null when the child has not yet outgrown the smallest size', () => {
		// Both bands are above the current weight, so there is no "next" size.
		const none = SIGNALS.find((s) => s.name === 'size_up_in_days')!.compute(ctx({
			diaperSizes: [
				{ size: '3', itemId: 10, active: true, weightBandKg: 6.5 },
				{ size: '4', itemId: null, active: false, weightBandKg: 7.5 },
			],
			growth: [{ date: daysAgo(60), weight: 5.4 }, { date: daysAgo(3), weight: 6.3 }],
		}));
		expect(none).toBeNull();
	});

	it('returns null, not a guess, when a signal cannot be computed', () => {
		expect(SIGNALS.find((s) => s.name === 'days_of_cover')!.compute(ctx())).toBeNull();
		expect(SIGNALS.find((s) => s.name === 'quantity')!.compute(ctx({ item: { quantity: 3 } }))).toBe(3);
		// size-up needs bands and a growth series
		expect(SIGNALS.find((s) => s.name === 'size_up_in_days')!.compute(ctx())).toBeNull();
	});

	it('forecasts growth-out at the ceiling of the size they are in, not the next floor', () => {
		const value = SIGNALS.find((s) => s.name === 'size_up_in_days')!.compute(ctx({
			// 7.4kg is inside Size 3 (7.3-12.7). Growing out of it means reaching
			// 12.7. Reading the next size's floor instead would say 10.0 and fire
			// while the child is still comfortably in Size 3.
			diaperSizes: [
				{ size: '3', itemId: 10, active: true, weightBandMinKg: 7.3, weightBandMaxKg: 12.7 },
				{ size: '4', itemId: null, active: false, weightBandMinKg: 10.0, weightBandMaxKg: 16.8 },
			],
			growth: [
				{ date: daysAgo(60), weight: 7.0 },
				{ date: daysAgo(3), weight: 7.4 },
			],
		}));
		const perDay = (7.4 - 7.0) / 57;
		expect(value).toBe(Math.round((12.7 - 7.4) / perDay));
	});

	it('falls back to the next floor when a ladder has no ceilings recorded', () => {
		const value = SIGNALS.find((s) => s.name === 'size_up_in_days')!.compute(ctx({
			// Ladders recorded before ceilings existed must keep working unchanged.
			diaperSizes: [
				{ size: '3', itemId: 10, active: true, weightBandMinKg: 6.0, weightBandMaxKg: null },
				{ size: '4', itemId: null, active: false, weightBandMinKg: 7.0, weightBandMaxKg: null },
			],
			growth: [
				{ date: daysAgo(60), weight: 5.4 },
				{ date: daysAgo(3), weight: 6.3 },
			],
		}));
		const perDay = (6.3 - 5.4) / 57;
		expect(value).toBe(Math.round((7.0 - 6.3) / perDay));
	});

	it('reports nothing when the top size has no ceiling and nothing above it', () => {
		const value = SIGNALS.find((s) => s.name === 'size_up_in_days')!.compute(ctx({
			diaperSizes: [
				{ size: '3', itemId: 10, active: true, weightBandMinKg: 7.3, weightBandMaxKg: 12.7 },
				{ size: '4', itemId: null, active: false, weightBandMinKg: 10.0, weightBandMaxKg: null },
			],
			growth: [
				{ date: daysAgo(60), weight: 10.5 },
				{ date: daysAgo(3), weight: 11.0 },
			],
		}));
		expect(value).toBeNull();
	});
});

describe('compare', () => {
	it('applies each comparator', () => {
		expect(compare(5, 'lte', 7)).toBe(true);
		expect(compare(7, 'lte', 7)).toBe(true);
		expect(compare(8, 'lte', 7)).toBe(false);
		expect(compare(8, 'lt', 7)).toBe(false);
		expect(compare(6, 'lt', 7)).toBe(true);
		expect(compare(9, 'gte', 7)).toBe(true);
		expect(compare(6, 'gt', 7)).toBe(false);
	});
});

describe('evaluateRules', () => {
	const names = new Map([[10, 'Diapers']]);

	it('fires a rule whose signal is inside the limit', () => {
		const { alerts } = evaluateRules({
			rules: [rule()], valuesByItem: values({ 10: { days_of_cover: 4 } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(1);
		expect(alerts[0].itemName).toBe('Diapers');
		expect(alerts[0].value).toBe(4);
		expect(alerts[0].message).toMatch(/days of cover left: 4 days/i);
	});

	it('does not fire when the signal is outside the limit', () => {
		const { alerts } = evaluateRules({
			rules: [rule()], valuesByItem: values({ 10: { days_of_cover: 30 } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(0);
	});

	it('is a pure function of current values, so reading can never consume a notification', () => {
		const first = evaluateRules({
			rules: [rule()], valuesByItem: values({ 10: { days_of_cover: 4 } }),
			namesByItem: names, nowMs: NOW,
		});
		const second = evaluateRules({
			rules: [rule()], valuesByItem: values({ 10: { days_of_cover: 4 } }),
			namesByItem: names, nowMs: NOW,
		});
		expect(first.alerts.length).toBe(1);
		expect(second.alerts.length).toBe(1);
	});

	it('stops reporting once the value clears', () => {
		const cleared = evaluateRules({
			rules: [rule()], valuesByItem: values({ 10: { days_of_cover: 30 } }),
			namesByItem: names, nowMs: NOW,
		});
		expect(cleared.alerts.length).toBe(0);
	});

it('reports an uncomputable signal as unknown rather than passing silently', () => {
		const { alerts, unknown } = evaluateRules({
			rules: [rule({ signal: 'size_up_in_days' })],
			valuesByItem: values({ 10: { size_up_in_days: null } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(0);
		expect(unknown.length).toBe(1);
		expect(unknown[0].signal).toBe('size_up_in_days');
	});

	it('applies one rule across every item, which is how a category-wide rule works', () => {
		const { alerts } = evaluateRules({
			rules: [rule({ itemId: null })],
			valuesByItem: values({ 10: { days_of_cover: 4 }, 11: { days_of_cover: 40 } }),
			namesByItem: new Map([[10, 'Diapers'], [11, 'Filters']]),
			state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(1);
		expect(alerts[0].itemName).toBe('Diapers');
	});

	it('ignores a disabled rule', () => {
		const { alerts } = evaluateRules({
			rules: [rule({ enabled: false })], valuesByItem: values({ 10: { days_of_cover: 1 } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(0);
	});

	it('supports a non-days signal, so the engine is not diaper-shaped', () => {
		const { alerts } = evaluateRules({
			rules: [rule({ signal: 'quantity', comparator: 'lte', threshold: 2 })],
			valuesByItem: values({ 10: { quantity: 2 } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts.length).toBe(1);
		expect(alerts[0].unit).toBe('units');
		expect(alerts[0].message).toMatch(/amount on hand: 2 units/i);
	});

	it('agrees in number with the value it is reporting', () => {
		const { alerts } = evaluateRules({
			rules: [rule({ signal: 'quantity', comparator: 'lte', threshold: 4 })],
			valuesByItem: values({ 10: { quantity: 1 } }),
			namesByItem: names, state: [], nowMs: NOW,
		});
		expect(alerts[0].message).toMatch(/amount on hand: 1 unit,/i);
	});
});

describe('days_to_expiry', () => {
	const def = signalByName('days_to_expiry')!;
	const NOW2 = Date.parse('2026-10-01T12:00:00.000Z');
	const days = (n: number) => new Date(NOW2 + n * MS_PER_DAY).toISOString();

	it('is null without an expiry date', () => {
		expect(def.compute({ item: {}, adjustments: [], nowMs: NOW2 })).toBeNull();
		expect(def.compute({ item: { expires_at: 'not a date' }, adjustments: [], nowMs: NOW2 })).toBeNull();
	});

	it('counts down to a future date', () => {
		expect(def.compute({ item: { expires_at: days(7) }, adjustments: [], nowMs: NOW2 })).toBe(7);
		expect(def.compute({ item: { expires_at: days(1) }, adjustments: [], nowMs: NOW2 })).toBe(1);
	});

	it('stops reporting once expired, so "expires soon" cannot nag forever', () => {
		expect(def.compute({ item: { expires_at: days(-1) }, adjustments: [], nowMs: NOW2 })).toBeNull();
		expect(def.compute({ item: { expires_at: days(-400) }, adjustments: [], nowMs: NOW2 })).toBeNull();
	});
});

describe('days_since_user_recorded_use', () => {
	const def = signalByName('days_since_user_recorded_use')!;
	const NOW3 = Date.parse('2026-10-01T12:00:00.000Z');
	const ago = (n: number) => new Date(NOW3 - n * MS_PER_DAY).toISOString();

	it('ignores the automatic cadence rows', () => {
		// Ten days of scheduled use, nothing from the user: still unknown, not "10".
		const adjustments = Array.from({ length: 10 }, (_, i) => ({
			change: -1, reason: 'used', created_at: ago(i), source: 'scheduled',
		}));
		expect(def.compute({ item: {}, adjustments, nowMs: NOW3 })).toBeNull();
	});

	it('counts from the most recent confirmed use', () => {
		const adjustments = [
			{ change: -1, reason: 'used', created_at: ago(20), source: 'scheduled' },
			{ change: -1, reason: 'used', created_at: ago(6), source: 'event' },
			{ change: -1, reason: 'used', created_at: ago(2), source: 'manual' },
		];
		expect(def.compute({ item: {}, adjustments, nowMs: NOW3 })).toBe(2);
	});

	it('does not count purchases as usage', () => {
		const adjustments = [{ change: 10, reason: 'purchase', created_at: ago(1), source: 'manual' }];
		expect(def.compute({ item: {}, adjustments, nowMs: NOW3 })).toBeNull();
	});
});
