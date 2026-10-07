// vocabulary.ts
//
// The single source of truth for what this app tracks.
//
// Every category, the stage that decides which categories a profile starts
// with, which categories are stored as milestone rows, and the option lists each
// one offers — all of it lives here, and nowhere else.
//
// It lives here because adding a category used to mean editing four hand-kept
// lists across two codebases (STAGE_CATEGORIES and MILESTONE_KINDS and
// DEFAULT_CATEGORY_OPTIONS on the API, CATEGORIES and MilestoneKind on the web).
// Any list written before a category existed was a trap: the new category would
// simply fall out of it, and the symptom was a log form with no fields, or a
// category that could not be recorded at all. The two copies had already drifted
// — the API's option list was missing the four most recently added categories.
//
// The web cannot import this file directly: it builds in its own container from
// its own directory. So scripts/generate-vocabulary.mjs reads this module and
// writes web/src/lib/vocabulary.generated.ts, and a test fails if that file is
// stale. Adding a category is now: edit this file, run the generator.

export const CATEGORY_IDS = [
	// The original infant vocabulary.
	'feeds',
	'diapers',
	'sleep',
	'growth',
	'pumping',
	'routines',
	'firsts',
	'milestones',
	'medical',
	'vaccines',
	'moods',
	'journal',
	// Shared beyond infancy: a pet's vet visit and an adult's GP appointment are
	// the same record, and medication is the same shape for both.
	'medication',
	'vitamins',
	'appointments',
	'grooming',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/**
 * Categories stored as milestone rows rather than their own entity.
 *
 * Adding an id here is what makes the web render the milestone log form for it,
 * so a category cannot be added to a stage without also being loggable.
 */
export const MILESTONE_CATEGORY_IDS = [
	'milestones',
	'firsts',
	'routines',
	'medical',
	'medication',
	'vitamins',
	'appointments',
	'grooming',
] as const;

export type MilestoneCategoryId = (typeof MILESTONE_CATEGORY_IDS)[number];

/**
 * Which option list a milestone category's values are stored under.
 *
 * Older rows were written under these keys, so the mapping is part of the data
 * contract, not a display choice.
 */
export const CATEGORY_OPTION_KEY: Record<CategoryId, string> = {
	feeds: 'type',
	diapers: 'consistency',
	sleep: 'location',
	growth: 'unit',
	pumping: 'type',
	routines: 'type',
	firsts: 'type',
	milestones: 'category',
	medical: 'visitType',
	vaccines: 'route',
	moods: 'mood',
	journal: 'type',
	medication: 'type',
	vitamins: 'type',
	appointments: 'type',
	grooming: 'type',
};

/** The values offered when logging each category. */
export const CATEGORY_OPTIONS: Record<string, Record<string, string[]>> = {
	feeds: { type: ['breast', 'formula', 'bottle', 'pump', 'solid'], side: ['left', 'right', 'both'] },
	diapers: {
		consistency: ['mushy', 'runny', 'formed', 'soft', 'blowout', 'other'],
		color: ['yellow', 'brown', 'green', 'black', 'red'],
	},
	sleep: { location: ['crib', 'bassinet', 'stroller', 'carrier', 'other'] },
	growth: { unit: ['metric', 'imperial'] },
	pumping: { type: ['left', 'right', 'both'] },
	routines: { type: ['tummy time', 'bath', 'story time', 'walk', 'other'] },
	firsts: { type: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'] },
	milestones: { category: ['physical', 'social', 'language', 'cognitive', 'other'] },
	medical: { visitType: ['wellness', 'sick visit', 'follow-up', 'other'] },
	vaccines: { route: ['oral', 'intramuscular', 'subcutaneous', 'dermal'] },
	moods: { mood: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'] },
	journal: { type: ['note', 'memory', 'question', 'other'] },
	medication: { type: ['dose', 'refill', 'missed', 'other'] },
	vitamins: { type: ['dose', 'refill', 'missed', 'other'] },
	appointments: { type: ['checkup', 'vaccination', 'follow-up', 'emergency', 'other'] },
	grooming: { type: ['bath', 'brush', 'nails', 'trim', 'other'] },
};

export const STAGES = ['infant', 'child', 'adult', 'pet'] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(value: unknown): value is Stage {
	return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

/**
 * What each stage tracks.
 *
 * One vocabulary with different subsets, not a vocabulary per species: a pet's
 * vaccination and an adult's immunisation are the same record, and a pet eats on
 * the same `feeds` a baby does.
 */
export const STAGE_CATEGORIES: Record<Stage, CategoryId[]> = {
	infant: ['feeds', 'diapers', 'sleep', 'growth', 'pumping', 'routines', 'medical', 'vaccines', 'moods', 'journal'],
	child: ['growth', 'routines', 'firsts', 'milestones', 'medical', 'vaccines', 'moods', 'journal'],
	adult: ['medication', 'vitamins', 'appointments', 'medical', 'vaccines', 'growth', 'routines', 'moods', 'journal'],
	pet: ['feeds', 'medication', 'appointments', 'grooming', 'vaccines', 'medical', 'growth', 'routines', 'moods', 'journal'],
};

/** What a profile with no stage at all falls back to. */
export const DEFAULT_CATEGORIES: CategoryId[] = [
	'feeds', 'diapers', 'sleep', 'growth', 'pumping', 'routines', 'firsts', 'milestones', 'medical', 'vaccines', 'moods', 'journal',
];

/**
 * The stage a member type implies without the family choosing one.
 *
 * A pet is unambiguously a pet and an adult an adult. A child is not: an infant
 * and a ten-year-old are both children, and guessing either way is wrong for
 * half of them, so it returns null and the caller uses DEFAULT_CATEGORIES.
 */
export function defaultStage(memberType: string): Stage | null {
	if (memberType === 'adult') return 'adult';
	if (memberType === 'pet') return 'pet';
	return null;
}

/** The category set a new profile starts with. */
export function categoryTemplate(stage: string | null | undefined): string[] {
	return isStage(stage) ? [...STAGE_CATEGORIES[stage]] : [...DEFAULT_CATEGORIES];
}
