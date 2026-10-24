// api/src/registry.ts
//
// ONE entry per category. Everything the app knows about "feeds" or
// "vitamins" — where its records are stored today, which options a log form
// offers, what a rule may filter on, whether stock can be linked to it,
// whether it can be booked as well as recorded, and the zod that validates
// its data document — is declared here and nowhere else.
//
// This is the Phase 1a consolidation from docs/event-model-design.md §3.2:
// vocabulary.ts and the SOURCES data that lived in reminder-conditions.ts are
// merged into this one registry, ahead of any schema change, so that Phase 1b
// (the events and plans tables) is mostly mechanical — the routes and forms
// read from here already. Every export the two old modules offered is
// preserved with the same values, with two deliberate exceptions recorded in
// the PR: MILESTONE_CATEGORY_IDS and the reminder catalog are now *derived*
// from entry order rather than hand-listed, so their order follows
// CATEGORIES' insertion order.
//
// What is new here and consumed by nothing yet: `tense`, `fields` and the
// per-category zod. They are the declarations Phase 1b wires up — POST
// /events validates with the schema, the log forms render from the fields —
// and a test in registry.test.ts keeps them consistent with each other so
// they cannot drift between now and then.

import { z } from 'zod';

/**
 * One dimension an inventory consumption rule can filter a logged event by.
 *
 * Declared in the registry on purpose: reminders, stock rules and log forms
 * all read the same tables and the same option lists, so a value ('dry', a
 * custom sleep location) means the same thing everywhere. A `kind: 'number'`
 * attribute reserves room for range conditions later; the evaluator is
 * enum-only until a journey asks for more.
 */
export interface ActivityAttribute {
	/** What a condition's `attr` names, e.g. 'type'. */
	key: string;
	/** The table column it reads, e.g. 'type'. */
	column: string;
	kind: 'enum' | 'number' | 'text';
	/** Enum values from the vocabulary, before a family's own values merge in. */
	values?: string[];
	/** (category, optionKey) pairs whose family-custom values also count. */
	customKeys?: Array<[string, string]>;
}

/** A condition on one logged event: attribute values it must carry to bill. */
export interface ConsumptionCondition {
	attr: string;
	values?: string[];
}

export interface ReminderCatalogCategory {
	id: string;
	label: string;
	/** Option values this category can be narrowed to; empty when it has none. */
	options: string[];
}

/**
 * One control the log form renders for a category.
 *
 * Enum values here are the defaults, before a family's own merge in through
 * `optionKey` — the same merge the reminders catalog has always done.
 */
export interface FieldDescriptor {
	key: string;
	kind: 'enum' | 'number' | 'text';
	/** Enum values for kind: 'enum'; absent for free-form fields. */
	options?: string[];
}

/** Whether a category is recorded (it happened) or can also be booked (§3.6). */
export type Tense = 'record' | 'book';

/**
 * The dimension a reminder or consumption rule may narrow this category by:
 * the column the filter reads and the values it may name. Sleep filters on
 * location, a routine on its option value — each entry says which.
 */
export interface CategoryFilter {
	/** The table column the condition's values filter on. */
	column: string;
	/** What a condition's attr names for this category. */
	key: string;
	/** Values the column may hold, before a family's own merge in. */
	values: string[];
	/** The family-settings option key whose custom values also count. */
	customKey?: string;
}

export interface CategoryEntry {
	/** The noun a rule or picker shows ('Feed', 'Vitamin'). */
	label: string;
	/**
	 * Where records land today. `kind` is the milestones table's discriminator
	 * — the catch-all this registry exists to retire, deleted in Phase 1c
	 * along with this field when every kind becomes a category of `events`.
	 */
	storage: { table: string; time: string; where?: string; kind?: string };
	/** What a rule may narrow on; absent when there is nothing to filter by. */
	filter?: CategoryFilter;
	/**
	 * Explicit consumption dimensions, overriding the one derived from
	 * `filter`. Milestones is one table with two ('kind' and 'category'); the
	 * empty array on growth, vaccinations and journal says "filterable in a
	 * reminder, but not billable by attribute" — journal_entries has no type
	 * column to read, so a derived one would be a phantom.
	 */
	attributes?: ActivityAttribute[];
	/** Inventory: events of this category can bill stock. */
	consumable?: boolean;
	/** The option lists the log form offers, by field key. */
	options: Record<string, string[]>;
	/** The key a family's own option values merge under (settings UI). */
	optionKey: string;
	/** §3.6: 'record' only, or record and book. */
	tense: Tense[];
	/** What the log form renders, in order. */
	fields: FieldDescriptor[];
	/** The data document's shape, derived from `fields` so the two cannot drift. */
	schema: z.ZodObject<z.ZodRawShape>;
}

/**
 * How far past "now" a record's timestamp may sit and still be a record —
 * clock drift between devices must not turn into rejections (§3.6). A constant
 * in the registry, deliberately not a setting: it exists to keep honest logs
 * honest, not to be tuned.
 */
export const RECORD_SKEW_MS = 5 * 60 * 1000;

/**
 * Builds the data-document zod from the form fields, so shape cannot drift.
 *
 * It validates *shape*, not membership: an enum field's `options` are the
 * built-in suggestions, and a family's own values merge in at the edges —
 * the settings UI, the pickers, the rule validators — exactly as option
 * lists have always worked. Closing the zod over the built-ins would reject
 * a custom routine the household invented, which is the opposite of what
 * the option merge exists for.
 */
function schemaOf(fields: FieldDescriptor[]): z.ZodObject<z.ZodRawShape> {
	const shape: z.ZodRawShape = {};
	for (const field of fields) {
		if (field.kind === 'number') shape[field.key] = z.number().optional();
		else shape[field.key] = z.string().optional();
	}
	return z.object(shape);
}

/** Declares a category from its form fields; the schema follows from them. */
function category(fields: FieldDescriptor[], entry: Omit<CategoryEntry, 'fields' | 'schema'>): CategoryEntry {
	return { ...entry, fields, schema: schemaOf(fields) };
}

// The order here is the vocabulary's order: CATEGORY_IDS is its key order, so
// "most important first" — what Quick Actions fall back to — survives
// anywhere the order is read.
export const CATEGORIES = {
	// A feed is when the BABY ate: a bottle, formula or solids count, a pump
	// does not. Pumping is its own category below, and `breast_or_pump` is the
	// supply question — a reminder view (REMINDER_VIEWS), not a category.
	feeds: category(
		[
			{ key: 'type', kind: 'enum', options: ['breast', 'formula', 'bottle', 'pump', 'solid'] },
			{ key: 'side', kind: 'enum', options: ['left', 'right', 'both'] },
			{ key: 'amount', kind: 'number' },
			{ key: 'duration', kind: 'number' },
		],
		{
			label: 'Feed',
			storage: { table: 'feedings', time: 'start_time', where: "type != 'pump'" },
			filter: { column: 'type', key: 'type', values: ['breast', 'formula', 'bottle', 'solid'], customKey: 'type' },
			consumable: true,
			options: { type: ['breast', 'formula', 'bottle', 'pump', 'solid'], side: ['left', 'right', 'both'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	diapers: category(
		[
			// 'type' is the form's main choice; consistency and colour are the
			// details. The filter names 'dry' too — a rule that cannot name it
			// would silently miss those changes.
			{ key: 'type', kind: 'enum', options: ['wet', 'dirty', 'both', 'dry'] },
			{ key: 'consistency', kind: 'enum', options: ['mushy', 'runny', 'formed', 'soft', 'blowout', 'other'] },
			{ key: 'color', kind: 'enum', options: ['yellow', 'brown', 'green', 'black', 'red'] },
		],
		{
			label: 'Diaper change',
			storage: { table: 'diapers', time: 'change_time' },
			filter: { column: 'type', key: 'type', values: ['wet', 'dirty', 'both', 'dry'] },
			consumable: true,
			options: { consistency: ['mushy', 'runny', 'formed', 'soft', 'blowout', 'other'], color: ['yellow', 'brown', 'green', 'black', 'red'] },
			optionKey: 'consistency',
			tense: ['record'],
		},
	),
	sleep: category(
		[
			{ key: 'location', kind: 'enum', options: ['crib', 'bassinet', 'stroller', 'carrier', 'other'] },
			{ key: 'duration', kind: 'number' },
		],
		{
			label: 'Sleep',
			storage: { table: 'sleep', time: 'start_time' },
			filter: { column: 'location', key: 'location', values: ['crib', 'bassinet', 'stroller', 'carrier', 'other'], customKey: 'location' },
			consumable: true,
			options: { location: ['crib', 'bassinet', 'stroller', 'carrier', 'other'] },
			optionKey: 'location',
			tense: ['record'],
		},
	),
	growth: category(
		[
			{ key: 'unit', kind: 'enum', options: ['metric', 'imperial'] },
			{ key: 'weight', kind: 'number' },
			{ key: 'height', kind: 'number' },
			{ key: 'head_circumference', kind: 'number' },
		],
		{
			label: 'Growth',
			storage: { table: 'growth', time: 'measurement_date' },
			attributes: [],
			consumable: true,
			options: { unit: ['metric', 'imperial'] },
			optionKey: 'unit',
			tense: ['record'],
		},
	),
	pumping: category(
		[{ key: 'type', kind: 'enum', options: ['left', 'right', 'both'] }],
		{
			label: 'Pump',
			storage: { table: 'feedings', time: 'start_time', where: "type = 'pump'" },
			options: { type: ['left', 'right', 'both'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	// The milestone-backed kinds, in vocabulary order. `storage.kind` is the
	// milestones table's discriminator and dies in Phase 1c; the filter is the
	// option value the kind stores in its `category` column, under its own
	// option key, so a family's own routine counts here as anywhere else.
	routines: category(
		[{ key: 'type', kind: 'enum', options: ['tummy time', 'bath', 'story time', 'walk', 'other'] }],
		{
			label: 'Routine',
			storage: { table: 'events', time: 'occurred_at', kind: 'routines' },
			filter: { column: 'category', key: 'type', values: ['tummy time', 'bath', 'story time', 'walk', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['tummy time', 'bath', 'story time', 'walk', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	firsts: category(
		[{ key: 'type', kind: 'enum', options: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'] }],
		{
			label: 'First',
			storage: { table: 'events', time: 'occurred_at', kind: 'firsts' },
			filter: { column: 'category', key: 'type', values: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	// The generic milestone entry: any milestone at all, for rules that do not
	// care which kind. The `kind` filter dimension it used to declare is gone —
	// the kinds are categories of their own now, so a rule names 'vitamins'
	// instead of "milestones where kind is vitamins".
	milestones: category(
		[{ key: 'category', kind: 'enum', options: ['physical', 'social', 'language', 'cognitive', 'other'] }],
		{
			label: 'Milestone',
			storage: { table: 'events', time: 'occurred_at', kind: 'milestones' },
			filter: { column: 'category', key: 'category', values: ['physical', 'social', 'language', 'cognitive', 'other'], customKey: 'category' },
			consumable: true,
			options: { category: ['physical', 'social', 'language', 'cognitive', 'other'] },
			optionKey: 'category',
			tense: ['record'],
		},
	),
	medical: category(
		[{ key: 'visitType', kind: 'enum', options: ['wellness', 'sick visit', 'follow-up', 'other'] }],
		{
			label: 'Medical entry',
			storage: { table: 'events', time: 'occurred_at', kind: 'medical' },
			filter: { column: 'category', key: 'visitType', values: ['wellness', 'sick visit', 'follow-up', 'other'], customKey: 'visitType' },
			consumable: true,
			options: { visitType: ['wellness', 'sick visit', 'follow-up', 'other'] },
			optionKey: 'visitType',
			tense: ['record', 'book'],
		},
	),
	vaccines: category(
		[{ key: 'route', kind: 'enum', options: ['oral', 'intramuscular', 'subcutaneous', 'dermal'] }],
		{
			label: 'Vaccination',
			storage: { table: 'vaccinations', time: 'date_given' },
			attributes: [],
			consumable: true,
			// nextDue is deliberately not a field: Phase 1b schedules the next
			// dose as a plan (design §3.6), so it stops being a promoted field.
			options: { route: ['oral', 'intramuscular', 'subcutaneous', 'dermal'] },
			optionKey: 'route',
			tense: ['record', 'book'],
		},
	),
	moods: category(
		[{ key: 'mood', kind: 'enum', options: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'] }],
		{
			label: 'Mood',
			storage: { table: 'moods', time: 'recorded_at' },
			filter: { column: 'mood', key: 'mood', values: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'], customKey: 'mood' },
			consumable: true,
			options: { mood: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'] },
			optionKey: 'mood',
			tense: ['record'],
		},
	),
	journal: category(
		[{ key: 'type', kind: 'enum', options: ['note', 'memory', 'question', 'other'] }],
		{
			label: 'Journal entry',
			storage: { table: 'journal_entries', time: 'entry_date' },
			filter: { column: 'type', key: 'type', values: ['note', 'memory', 'question', 'other'], customKey: 'type' },
			// journal_entries has no `type` column to bill by; the empty
			// override keeps a reminder-narrowable category from offering a
			// phantom consumption filter.
			attributes: [],
			consumable: true,
			options: { type: ['note', 'memory', 'question', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	medication: category(
		[
			{ key: 'type', kind: 'enum', options: ['dose', 'refill', 'missed', 'other'] },
			{ key: 'amount', kind: 'number' },
		],
		{
			label: 'Medication',
			storage: { table: 'events', time: 'occurred_at', kind: 'medication' },
			filter: { column: 'category', key: 'type', values: ['dose', 'refill', 'missed', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['dose', 'refill', 'missed', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	vitamins: category(
		[
			{ key: 'type', kind: 'enum', options: ['dose', 'refill', 'missed', 'other'] },
			{ key: 'amount', kind: 'number' },
		],
		{
			label: 'Vitamin',
			storage: { table: 'events', time: 'occurred_at', kind: 'vitamins' },
			filter: { column: 'category', key: 'type', values: ['dose', 'refill', 'missed', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['dose', 'refill', 'missed', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
	appointments: category(
		[{ key: 'type', kind: 'enum', options: ['checkup', 'vaccination', 'follow-up', 'emergency', 'other'] }],
		{
			label: 'Appointment',
			storage: { table: 'events', time: 'occurred_at', kind: 'appointments' },
			filter: { column: 'category', key: 'type', values: ['checkup', 'vaccination', 'follow-up', 'emergency', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['checkup', 'vaccination', 'follow-up', 'emergency', 'other'] },
			optionKey: 'type',
			tense: ['record', 'book'],
		},
	),
	grooming: category(
		[{ key: 'type', kind: 'enum', options: ['bath', 'brush', 'nails', 'trim', 'other'] }],
		{
			label: 'Grooming',
			storage: { table: 'events', time: 'occurred_at', kind: 'grooming' },
			filter: { column: 'category', key: 'type', values: ['bath', 'brush', 'nails', 'trim', 'other'], customKey: 'type' },
			consumable: true,
			options: { type: ['bath', 'brush', 'nails', 'trim', 'other'] },
			optionKey: 'type',
			tense: ['record'],
		},
	),
} satisfies Record<string, CategoryEntry>;

export type CategoryId = keyof typeof CATEGORIES;

// ── The vocabulary projections, preserved exactly ──────────────────────

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

/**
 * The categories stored as milestone rows rather than their own entity.
 *
 * Derived, not listed: "milestone-backed" is a storage fact (§3.2), and the
 * list it replaces was one more hand-kept thing to forget to update. It dies
 * entirely in Phase 1c, when the last `storage.kind` does. The tuple cast is
 * the non-empty promise z.enum needs — true as long as any category declares
 * a `storage.kind`, which the test suite holds.
 */
export const MILESTONE_CATEGORY_IDS = CATEGORY_IDS.filter(
	(id) => CATEGORIES[id].storage.kind !== undefined,
) as unknown as readonly [CategoryId, ...CategoryId[]];

/**
 * The categories stored on the events table — the kinds the catch-all used to
 * hold. Derived from `storage.kind` while the alias route and the milestones
 * table still exist; Phase 1c deletes both and this becomes every events
 * category's plain storage fact.
 */
export const EVENT_KIND_CATEGORIES = MILESTONE_CATEGORY_IDS;

const optionKeyRecord: Record<CategoryId, string> = {} as Record<CategoryId, string>;
const optionsRecord: Record<CategoryId, Record<string, string[]>> = {} as Record<CategoryId, Record<string, string[]>>;
for (const id of CATEGORY_IDS) {
	optionKeyRecord[id] = CATEGORIES[id].optionKey;
	optionsRecord[id] = CATEGORIES[id].options;
}
export const CATEGORY_OPTION_KEY: Record<CategoryId, string> = optionKeyRecord;
export const CATEGORY_OPTIONS: Record<string, Record<string, string[]>> = optionsRecord;

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

/**
 * How often a family wants the digest email.
 *
 * 'hourly' is the default because it is what the scheduler already did before
 * the setting existed, so nothing changes for a family that never opens the
 * setting.
 */
export const DIGEST_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const DIGEST_FREQUENCY_MS: Record<DigestFrequency, number> = {
	hourly: 60 * 60 * 1000,
	daily: 24 * 60 * 60 * 1000,
	weekly: 7 * 24 * 60 * 60 * 1000,
};

// ── Reminder sources: categories, plus views over their tables ─────────
//
// A reminder can watch a category, or a *view* of one: 'pumping' is the
// feedings table seen through `type = 'pump'`, and 'breast_or_pump' is the
// supply question — neither is a category of its own, so it lives here as a
// view rather than in CATEGORIES.

export interface Source {
	label: string;
	table: string;
	time: string;
	/** Fixed predicate over the source table's columns. */
	baseWhere?: string;
	/** Column a condition's values filter on. */
	optionColumn?: string;
	/**
	 * A whole SQL expression for the same job, when the value is not a plain
	 * column — the events table keeps option values in the data document:
	 * json_extract(data, '$.type'). Used as-is in WHERE; still parameterised
	 * for the values.
	 */
	optionExpr?: string;
	/** Default values for that column, before a family customises them. */
	options?: string[];
	/**
	 * The fixed category value an events-backed source narrows to — what the
	 * milestones `kind` column used to encode, now a plain `category = ?`
	 * predicate on the events table.
	 */
	eventsCategory?: string;
	/** The family-settings option key, so a family's own values can be merged in. */
	optionKey?: string;
	/** Inventory consumption: events from this table can bill stock. */
	consumable?: boolean;
	/** Overrides the attribute derived from optionColumn/options, for a table needing more. */
	attributes?: ActivityAttribute[];
}

function sourceOf(id: string, entry: CategoryEntry): Source {
	const events = entry.storage.table === 'events';
	return {
		label: entry.label,
		table: entry.storage.table,
		time: entry.storage.time,
		baseWhere: entry.storage.where,
		// On the events table the option value lives in the data document
		// under the category's own key, so the filter is a whole expression
		// rather than a bare column.
		optionColumn: events ? undefined : entry.filter?.column,
		optionExpr: events ? `json_extract(data, '$.${entry.optionKey}')` : undefined,
		options: entry.filter?.values && [...entry.filter.values],
		eventsCategory: events ? id : undefined,
		optionKey: entry.filter?.customKey,
		consumable: entry.consumable,
		attributes: entry.attributes,
	};
}

/** Reminder views that are not categories: named predicates over a table. */
export const REMINDER_VIEWS: Record<string, Source> = {
	// The supply question — the same three-way split feeds and pumping encode,
	// as one watchable thing.
	breast_or_pump: {
		label: 'Breast feed or pump',
		table: 'feedings',
		time: 'start_time',
		baseWhere: "type IN ('breast', 'pump')",
	},
};

export const SOURCES: Record<string, Source> = {};
for (const id of CATEGORY_IDS) SOURCES[id] = sourceOf(id, CATEGORIES[id]);
Object.assign(SOURCES, REMINDER_VIEWS);

export function isKnownReminderCategory(category: string): boolean {
	return Object.prototype.hasOwnProperty.call(SOURCES, category);
}

/**
 * The categories a rule can watch, with the option values each accepts. A
 * family's own option values are merged over the defaults, so a routine the
 * household invented is selectable like any built-in one.
 */
export function reminderCatalog(
	custom: Record<string, Record<string, string[]>> = {},
): ReminderCatalogCategory[] {
	return Object.entries(SOURCES).map(([id, src]) => {
		const customValues = src.optionKey ? custom[id]?.[src.optionKey] ?? [] : [];
		return {
			id,
			label: src.label,
			options: [...new Set([...(src.options ?? []), ...customValues])],
		};
	});
}

// ── Inventory consumption projections ──────────────────────────────────

/** A logged category an inventory item can be consumed by, with the dimensions a rule can filter on. */
export interface ConsumableSource {
	/** The category id, e.g. 'feeds' — what a rule's source_category stores. */
	id: string;
	/** The table the category's records land in — what the gate's ref_table stores. */
	table: string;
	label: string;
	attributes: ActivityAttribute[];
}

/**
 * Every category that can bill stock, one entry per category.
 *
 * The honest list the inventory picker and `emitActivity` are both built from:
 * a category appears here only when its registry entry declares `consumable`,
 * and a conformance test posts a record through each one's route to keep that
 * declaration true. Phase 1b made this per-category — a rule stores the
 * category id ('vitamins'), not the table plus a smuggled kind — which is what
 * deleted the picker's `presetConditions` folding.
 */
export function consumableCategories(
	custom: Record<string, Record<string, string[]>> = {},
): ConsumableSource[] {
	const out: ConsumableSource[] = [];
	for (const id of CATEGORY_IDS) {
		const entry = CATEGORIES[id];
		if (!entry.consumable) continue;
		// The dimension a rule may narrow by. Explicit attributes win (growth,
		// vaccinations and journal declare none worth billing by); an
		// events-backed category is narrowed by its data-document fields, whose
		// column is a JSON path; a typed category by its filter column.
		const attributes: ActivityAttribute[] =
			entry.attributes !== undefined
				? entry.attributes
				: entry.storage.table === 'events'
					? entry.fields
						.filter((f) => f.kind === 'enum' && f.options?.length)
						.map((f) => ({
							key: f.key,
							column: `$.${f.key}`,
							kind: 'enum' as const,
							values: [...(f.options ?? [])],
							customKeys: [[id, entry.optionKey] as [string, string]],
						}))
					: entry.filter
						? [{
							key: entry.filter.key,
							column: entry.filter.column,
							kind: 'enum' as const,
							values: [...entry.filter.values],
							customKeys: entry.filter.customKey ? [[id, entry.filter.customKey] as [string, string]] : [],
						}]
						: [];
		out.push({
			id,
			table: entry.storage.table,
			label: entry.label,
			attributes: attributes.map((attr) => ({
				...attr,
				values: attr.values
					? [...new Set([...attr.values, ...(attr.customKeys ?? []).flatMap(([cat, key]) => custom[cat]?.[key] ?? [])])]
					: undefined,
			})),
		});
	}
	return out;
}

/**
 * Check a rule's conditions against the registry, or return the reason it is
 * refused. An unknown category, an unknown attribute or a value outside the
 * vocabulary would silently never match, so all three are named at the edge.
 */
export function validateConsumptionConditions(
	sourceCategory: string,
	conditions: ConsumptionCondition[],
	custom: Record<string, Record<string, string[]>> = {},
): string | null {
	const activity = consumableCategories(custom).find((a) => a.id === sourceCategory);
	if (!activity) return `"${sourceCategory}" is not something Nido can bill stock from.`;
	for (const condition of conditions) {
		const attr = activity.attributes.find((at) => at.key === condition.attr);
		if (!attr) return `"${condition.attr}" is not something ${activity.label.toLowerCase()}s can be filtered by.`;
		if (condition.values?.length && attr.values) {
			const allowed = new Set(attr.values);
			for (const value of condition.values) {
				if (!allowed.has(value)) return `"${value}" is not a valid ${attr.key} option for ${activity.label.toLowerCase()}s.`;
			}
		}
	}
	return null;
}
