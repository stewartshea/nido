// AUTO-GENERATED — do not edit.
//
// Source: api/src/vocabulary.ts
// Regenerate: npx tsx scripts/generate-vocabulary.ts
//
// Hand-editing this file will be undone, and a test fails if it is out of date.
// Add a category in the API module instead.

export const CATEGORY_IDS = [
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
	'medication',
	'vitamins',
	'appointments',
	'grooming',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

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

export const STAGES = [
	'infant',
	'child',
	'adult',
	'pet',
] as const;

export type Stage = (typeof STAGES)[number];

export const DIGEST_FREQUENCIES = [
	'hourly',
	'daily',
	'weekly',
] as const;

export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const CATEGORY_OPTION_KEY = {
	"feeds": "type",
	"diapers": "consistency",
	"sleep": "location",
	"growth": "unit",
	"pumping": "type",
	"routines": "type",
	"firsts": "type",
	"milestones": "category",
	"medical": "visitType",
	"vaccines": "route",
	"moods": "mood",
	"journal": "type",
	"medication": "type",
	"vitamins": "type",
	"appointments": "type",
	"grooming": "type"
};

export const CATEGORY_OPTIONS = {
	"feeds": {
		"type": [
			"breast",
			"formula",
			"bottle",
			"pump",
			"solid"
		],
		"side": [
			"left",
			"right",
			"both"
		]
	},
	"diapers": {
		"consistency": [
			"mushy",
			"runny",
			"formed",
			"soft",
			"blowout",
			"other"
		],
		"color": [
			"yellow",
			"brown",
			"green",
			"black",
			"red"
		]
	},
	"sleep": {
		"location": [
			"crib",
			"bassinet",
			"stroller",
			"carrier",
			"other"
		]
	},
	"growth": {
		"unit": [
			"metric",
			"imperial"
		]
	},
	"pumping": {
		"type": [
			"left",
			"right",
			"both"
		]
	},
	"routines": {
		"type": [
			"tummy time",
			"bath",
			"story time",
			"walk",
			"other"
		]
	},
	"firsts": {
		"type": [
			"smile",
			"roll over",
			"crawl",
			"first step",
			"tooth",
			"other"
		]
	},
	"milestones": {
		"category": [
			"physical",
			"social",
			"language",
			"cognitive",
			"other"
		]
	},
	"medical": {
		"visitType": [
			"wellness",
			"sick visit",
			"follow-up",
			"other"
		]
	},
	"vaccines": {
		"route": [
			"oral",
			"intramuscular",
			"subcutaneous",
			"dermal"
		]
	},
	"moods": {
		"mood": [
			"happy",
			"fussy",
			"sleepy",
			"unwell",
			"content",
			"unsettled"
		]
	},
	"journal": {
		"type": [
			"note",
			"memory",
			"question",
			"other"
		]
	},
	"medication": {
		"type": [
			"dose",
			"refill",
			"missed",
			"other"
		]
	},
	"vitamins": {
		"type": [
			"dose",
			"refill",
			"missed",
			"other"
		]
	},
	"appointments": {
		"type": [
			"checkup",
			"vaccination",
			"follow-up",
			"emergency",
			"other"
		]
	},
	"grooming": {
		"type": [
			"bath",
			"brush",
			"nails",
			"trim",
			"other"
		]
	}
};
