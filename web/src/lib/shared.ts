import { Milk, Baby, Moon, TrendingUp, Calendar, Star, Trophy, Stethoscope, Syringe, Smile, Book, Pill, Scissors, CalendarClock, Sparkles } from 'lucide-svelte';
import { authStore } from '$lib/stores/authStore';
import { get } from 'svelte/store';

import {
	CATEGORY_IDS,
	MILESTONE_CATEGORY_IDS,
	CATEGORY_OPTION_KEY,
	CATEGORY_OPTIONS,
	type CategoryId,
	type MilestoneCategoryId,
} from './vocabulary.generated';

/**
 * How each category is shown. The vocabulary — which categories exist — comes
 * from vocabulary.generated.ts, which comes from api/src/vocabulary.ts.
 *
 * This map is keyed by that union, so adding a category there fails to compile
 * here until it has a label and an icon. That is deliberate: the failure used to
 * be silent, and surfaced as a log form with no fields.
 */
const PRESENTATION: Record<CategoryId, { label: string; icon: typeof Milk }> = {
	feeds: { label: 'Feeds', icon: Milk },
	diapers: { label: 'Diapers', icon: Baby },
	sleep: { label: 'Sleep', icon: Moon },
	growth: { label: 'Growth', icon: TrendingUp },
	pumping: { label: 'Pumping', icon: Milk },
	routines: { label: 'Routines', icon: Calendar },
	firsts: { label: 'Firsts', icon: Star },
	milestones: { label: 'Milestones', icon: Trophy },
	medical: { label: 'Medical', icon: Stethoscope },
	vaccines: { label: 'Vaccines', icon: Syringe },
	moods: { label: 'Moods', icon: Smile },
	journal: { label: 'Journal', icon: Book },
	medication: { label: 'Medication', icon: Pill },
	vitamins: { label: 'Vitamins', icon: Sparkles },
	appointments: { label: 'Appointments', icon: CalendarClock },
	grooming: { label: 'Grooming', icon: Scissors },
};

export const CATEGORIES = CATEGORY_IDS.map((id) => ({ id, ...PRESENTATION[id] }));

/**
 * The profile to open on when the family has not saved a default.
 *
 * Tracking categories (feeds, sleep, diapers) only apply to a trackable
 * profile, and the account that created the household is an adult member of it
 * now, so "the first member in the list" is routinely the parent rather than the
 * baby. Prefer a trackable profile; fall back to anybody so an adult-only
 * household still has something to select.
 */
/**
 * How a reminder's category reads in a sentence: "no <noun> in 6h".
 *
 * One function rather than a ternary per component. There were three copies of
 * that ternary and adding a category fell through all of them to "feed", which
 * is how a supply reminder would have been labelled as a baby missed a meal.
 */
export function reminderNoun(category: string | null | undefined): string {
	switch (category) {
		case 'feeds':
			return 'feed';
		case 'pumping':
			return 'pump';
		case 'breast_or_pump':
			return 'breast feed or pump';
		case 'diapers':
			return 'diaper change';
		case 'sleep':
			return 'sleep';
		case 'routines':
			return 'routine';
		case 'firsts':
			return 'first';
		case 'milestones':
			return 'milestone';
		case 'medical':
			return 'medical entry';
		case 'vaccines':
			return 'vaccination';
		case 'moods':
			return 'mood';
		case 'journal':
			return 'journal entry';
		case 'medication':
			return 'medication';
		case 'vitamins':
			return 'vitamin';
		case 'appointments':
			return 'appointment';
		case 'grooming':
			return 'grooming';
		default:
			return category ? String(category) : 'entry';
	}
}

export function conditionNoun(condition: { category: string; values?: string[] }): string {
	if (condition.values && condition.values.length) return condition.values.join(' or ');
	return reminderNoun(condition.category);
}

export function reminderPhrase(
	conditions: { category: string; values?: string[] }[],
	match: 'any' | 'all' = 'any',
): string {
	return conditions.map(conditionNoun).join(match === 'all' ? ' and ' : ' or ');
}

export function defaultMemberId<T extends { id: number | string; trackable?: boolean }>(members: T[]): number | null {
	if (!members.length) return null;
	const trackable = members.find((m) => m.trackable !== false);
	return Number((trackable ?? members[0]).id);
}


/** Categories stored as milestone rows. Defined in api/src/vocabulary.ts. */
export type MilestoneKind = MilestoneCategoryId;

/**
 * Per-kind category vocabularies. The logger and the edit dialog both draw
 * their choices from here, so a category is always one of a known set and can
 * be reported on. These mirror DEFAULT_CATEGORY_OPTIONS on the API.
 */
export const DEFAULT_CATEGORY_OPTIONS: Record<string, Record<string, string[]>> = CATEGORY_OPTIONS;

/** Which option list holds a kind's categories. */
export const MILESTONE_KIND_IDS = MILESTONE_CATEGORY_IDS;

export function milestoneCategoryKey(kind: MilestoneKind): string {
    return CATEGORY_OPTION_KEY[kind] ?? 'type';
}

export function isMilestoneKind(value: string): value is MilestoneKind {
    return (MILESTONE_KIND_IDS as readonly string[]).includes(value);
}

/**
 * Which tab a stored row belongs to. The row's own kind is authoritative;
 * older rows without one are classified from their category word so existing
 * data keeps showing up in the right place.
 */
export function milestoneCategory(r: { kind?: string | null; category?: string | null }): string {
    if (r?.kind && isMilestoneKind(String(r.kind))) return String(r.kind);
    const c = String(r?.category || '').toLowerCase();
    if (c === 'firsts') return 'firsts';
    if (c === 'vitamin' || c === 'medication' || c === 'bath' || c === 'tummy time'
        || c === 'story time' || c === 'walk' || c === 'appointment') return 'routines';
    if (c === 'medical') return 'medical';
    return 'milestones';
}

