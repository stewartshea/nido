// api/src/inventory-signals.ts
//
// The open-ended half of inventory.
//
// A **signal** is a named numeric fact the system derives from an item's data:
// days of cover, days until you run out, days until the child outgrows this
// size. A **rule** is the household saying "tell me when that signal crosses a
// line". Adding a signal is a new entry in SIGNALS; adding a rule or a category
// is data, never a migration. The diaper "size up" case is therefore one signal
// rather than a special-cased table, and the next rule someone invents needs no
// code change at all.

import { consumptionRate, coverForecast, cadenceRate, weightTrendPerDay, MS_PER_DAY } from './inventory';
import { sizeForWeight, weightKg } from './diaper-size';

export type Comparator = 'lt' | 'lte' | 'gt' | 'gte';

export interface AdjustmentLike {
	change: number;
	reason: string;
	created_at: string;
	/** 'scheduled' rows are the app's own cadence; anything else was told to us. */
	source?: string | null;
}
export interface DiaperSizeLike {
	size: string;
	itemId: number | null;
	active: boolean;
	/** Weight at which this size begins. */
	weightBandMinKg: number | null;
	/** Weight at which the child grows out of it — the number the forecast wants. */
	weightBandMaxKg: number | null;
}
export interface GrowthLike {
	date: string;
	weight: number | null;
	/** The unit the weight was typed in; bands are kilograms. */
	unitSystem?: string | null;
}

export interface SignalContext {
	item: any;
	adjustments: AdjustmentLike[];
	nowMs: number;
	/** Already-expired items have no useful days-to-expiry left. */
	expiresAt?: string | null;
	/** Per-member inputs, absent when not relevant to the item. */
	diaperSizes?: DiaperSizeLike[];
	growth?: GrowthLike[];
}

export interface SignalDefinition {
	name: string;
	label: string;
	unit: 'days' | 'units' | string;
	higherIsWorse: boolean;
	describe: string;
	compute: (ctx: SignalContext) => number | null;
}

function daysOfCover(ctx: SignalContext): number | null {
	const rate = cadenceRate(ctx.item, consumptionRate(ctx.adjustments, ctx.nowMs));
	return coverForecast(rate, Number(ctx.item.quantity ?? 0), ctx.nowMs).daysOfCover;
}

export const SIGNALS: SignalDefinition[] = [
	{
		name: 'days_of_cover',
		label: 'Days of cover left',
		unit: 'days',
		higherIsWorse: false,
		describe: 'How long the current stock lasts at the recent rate of use. Set the limit to how many days of warning you want.',
		compute: daysOfCover,
	},
	{
		name: 'runout_in_days',
		label: 'Days until you run out',
		unit: 'days',
		higherIsWorse: false,
		describe: 'The same number as days of cover, named for the thing you care about.',
		compute: daysOfCover,
	},
	{
		name: 'quantity',
		label: 'Amount on hand',
		unit: 'units',
		higherIsWorse: false,
		describe: 'Raw stock. Useful for "tell me when I am down to one left".',
		compute: (ctx) =>
			ctx.item.quantity === null || ctx.item.quantity === undefined ? null : Number(ctx.item.quantity),
	},
	{
		name: 'days_to_expiry',
		label: 'Days until this expires',
		unit: 'days',
		higherIsWorse: false,
		describe: 'Needs an expiry date on the item. Only reported while the date is still in the future.',
		compute: (ctx) => {
			const iso = ctx.expiresAt ?? ctx.item.expires_at ?? null;
			if (!iso) return null;
			const t = new Date(String(iso)).getTime();
			if (!Number.isFinite(t)) return null;
			const days = (t - ctx.nowMs) / MS_PER_DAY;
			return days > 0 ? Math.round(days) : null;   // expired is not "expires soon"
		},
	},
	{
		name: 'days_since_user_recorded_use',
		label: 'Days since you recorded using this',
		unit: 'days',
		higherIsWorse: false,
		describe:
			'Ignores the automatic cadence rows, so it only rises when you have not recorded usage yourself. ' +
			'Use it to nudge someone to check a count they are not logging.',
		compute: (ctx) => {
			const confirmed = ctx.adjustments.filter((a) => a.source !== 'scheduled' && Number(a.change) < 0);
			if (confirmed.length === 0) return null;
			const latest = Math.max(...confirmed.map((a) => new Date(a.created_at).getTime()));
			if (!Number.isFinite(latest)) return null;
			return Math.max(0, Math.floor((ctx.nowMs - latest) / MS_PER_DAY));
		},
	},
	{
		name: 'size_up_in_days',
		label: 'Days until this size is outgrown',
		unit: 'days',
		higherIsWorse: false,
		describe:
			'Needs a size ladder with weight ranges, and at least two weight records. ' +
			'Meant for size-based stock such as diapers.',
		compute: (ctx) => {
			const sizes = ctx.diaperSizes ?? [];
			const growth = ctx.growth ?? [];
			if (sizes.length < 2) return null;
			// Bands are kilograms; records keep the unit they were typed in.
			const kilograms = growth
				.filter((g) => g.weight !== null && Number.isFinite(Number(g.weight)))
				.map((g) => ({ date: g.date, weight: weightKg(Number(g.weight), g.unitSystem) }));
			const trend = weightTrendPerDay(kilograms);
			if (!trend) return null;
			const weight = kilograms.map((g) => g.weight).sort((a, b) => a - b).pop();
			if (weight === undefined) return null;

			const sorted = sizes
				.filter((s) => s.weightBandMinKg !== null)
				.sort((a, b) => a.weightBandMinKg! - b.weightBandMinKg!);
			// The size in use is the last one whose floor the child has reached, not
			// the next one up. Below every floor — a very small baby — they are in
			// the smallest size available. Shared with the diaper route, so a
			// change bills the same size this forecast is talking about.
			const current = sizeForWeight(sorted, weight);
			if (!current) return null;
			const index = sorted.indexOf(current);

			// Growing out of a size means reaching its ceiling. A ladder recorded
			// before ceilings existed has none, so fall back to the next size's
			// floor, which is how this behaved before and is correct when the
			// bands are contiguous.
			const next = sorted[index + 1];
			const target = current.weightBandMaxKg ?? next?.weightBandMinKg ?? null;
			if (target === null) return null;

			return Math.max(0, Math.round((target - weight) / trend));
		},
	},
];

export function signalByName(name: string): SignalDefinition | undefined {
	return SIGNALS.find((s) => s.name === name);
}

export function unitSuffix(count: number, unit: string): string {
	if (!unit) return '';
	return count === 1 ? ` ${unit.replace(/s$/, '')}` : ` ${unit}`;
}

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
	switch (comparator) {
		case 'lt': return value < threshold;
		case 'lte': return value <= threshold;
		case 'gt': return value > threshold;
		case 'gte': return value >= threshold;
		default: return false;
	}
}

export interface InventoryRule {
	id: number;
	/** null applies to every item, which is how "tell me about any filter" works. */
	itemId: number | null;
	category: string | null;
	signal: string;
	comparator: Comparator;
	threshold: number;
	/** Remind again every N days while the rule keeps firing; null fires once until it clears. */
	repeatDays: number | null;
	enabled: boolean;
	/** Who the rule is addressed to. 'users' with an empty list means nobody. */
	audienceKind: 'family' | 'users';
	audienceIds: string[];
}

export interface Alert {
	ruleId: number;
	itemId: number;
	itemName: string;
	signal: string;
	signalLabel: string;
	comparator: Comparator;
	threshold: number;
	value: number;
	unit: string;
	message: string;
}

export interface Evaluation {
	alerts: Alert[];
	/** Rules whose signal cannot be computed for this item. Surfaced, never hidden. */
	unknown: { ruleId: number; itemId: number; signal: string }[];
}

/**
 * Work out which rules are firing right now.
 *
 * Every rule that currently matches is reported, so the UI can show what is
 * firing right now rather than only what changed since the last look.
 *
 * This is deliberately a pure function of current values. Whether anyone has
 * been emailed lives in `inventory_rule_recipients` and is decided per recipient
 * at delivery time, because that is not a property of the condition. Keeping the
 * two apart also means reading this page can never consume the notification.
 */
export function evaluateRules(input: {
	rules: InventoryRule[];
	valuesByItem: Map<number, Map<string, number | null>>;
	namesByItem: Map<number, string>;
	nowMs: number;
}): Evaluation {
	const { rules, valuesByItem, namesByItem } = input;
	const alerts: Alert[] = [];
	const unknown: { ruleId: number; itemId: number; signal: string }[] = [];

	for (const rule of rules) {
		if (!rule.enabled) continue;
		const def = signalByName(rule.signal);
		if (!def) continue;

		for (const [itemId, values] of valuesByItem) {
			const value = values.get(rule.signal);

			if (value === null || value === undefined) {
				// A rule on a signal this item cannot produce is not "fine".
				unknown.push({ ruleId: rule.id, itemId, signal: rule.signal });
				continue;
			}

			if (!compare(value, rule.comparator, rule.threshold)) continue;

			alerts.push({
				ruleId: rule.id,
				itemId,
				itemName: namesByItem.get(itemId) ?? `Item ${itemId}`,
				signal: rule.signal,
				signalLabel: def.label,
				comparator: rule.comparator,
				threshold: rule.threshold,
				value,
				unit: def.unit,
				message: phrase(def, rule, value),
			});
		}
	}
	return { alerts, unknown };
}

function phrase(def: SignalDefinition, rule: InventoryRule, value: number): string {
	const n = Math.round(value * 10) / 10;
	const atOrUnder = rule.comparator === 'lte' || rule.comparator === 'lt';
	return `${def.label}: ${n}${unitSuffix(n, def.unit)}, ${atOrUnder ? 'at or under' : 'over'} your limit of ${rule.threshold}.`;
}
