// src/registry.test.ts
//
// Guards the one thing the registry consolidation is for: a category declared
// in api/src/registry.ts cannot silently fail to reach the web, the log forms,
// or the rules — and the declarations Phase 1b will wire up (tense, fields,
// schema) cannot drift from each other in the meantime.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CATEGORIES,
	CATEGORY_IDS,
	CATEGORY_OPTION_KEY,
	CATEGORY_OPTIONS,
	MILESTONE_CATEGORY_IDS,
	STAGE_CATEGORIES,
	type CategoryId,
} from './registry';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the registry is well formed', () => {
	it('has no duplicate categories', () => {
		expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
	});

	it('only stores milestone-backed categories that exist', () => {
		const known = new Set<string>(CATEGORY_IDS);
		for (const id of MILESTONE_CATEGORY_IDS) expect(known.has(id)).toBe(true);
	});

	it('gives every category an option key and an option list', () => {
		// The failure this prevents: a category with no options renders a form with
		// nothing in it, which is exactly how the last four categories went wrong.
		for (const id of CATEGORY_IDS) {
			expect(CATEGORY_OPTION_KEY[id], `${id} has no option key`).toBeTruthy();
			expect(CATEGORY_OPTIONS[id], `${id} has no options`).toBeTruthy();
		}
	});

	it('names an option key that the category actually offers', () => {
		for (const id of CATEGORY_IDS) {
			const key = CATEGORY_OPTION_KEY[id]!;
			expect(Object.keys(CATEGORY_OPTIONS[id]!), `${id} does not offer its own option key "${key}"`).toContain(key);
		}
	});

	it('only puts real categories in a stage', () => {
		const known = new Set<string>(CATEGORY_IDS);
		for (const [stage, ids] of Object.entries(STAGE_CATEGORIES)) {
			for (const id of ids) expect(known.has(id), `${stage} lists unknown category ${id}`).toBe(true);
		}
	});

	it('gives every stage something to track', () => {
		for (const [stage, ids] of Object.entries(STAGE_CATEGORIES)) {
			expect(ids.length, `${stage} tracks nothing`).toBeGreaterThan(0);
		}
	});
});

describe('the Phase 1b declarations cannot drift', () => {
	// These are consumed by nothing yet — POST /events, the registry-driven
	// forms and the booking gesture arrive in Phase 1b — so the guard is the
	// contract between now and then: every category declares a tense, its form
	// fields and its data-document zod agree with each other, and an exemplar
	// built from the fields parses.

	it('declares a tense for every category, and record is always allowed', () => {
		for (const id of CATEGORY_IDS) {
			const tense = CATEGORIES[id as CategoryId].tense;
			expect(tense.length, `${id} declares no tense`).toBeGreaterThan(0);
			expect(tense, `${id} cannot be recorded`).toContain('record');
		}
	});

	it('offers book exactly where the design says it should', () => {
		// docs/event-model-design.md §9: the obvious three ship bookable;
		// routines and grooming stay record-only until a journey asks.
		const bookable = CATEGORY_IDS.filter((id) => CATEGORIES[id as CategoryId].tense.includes('book'));
		expect(bookable).toEqual(['medical', 'vaccines', 'appointments']);
	});

	it('derives every data schema from its form fields', () => {
		for (const id of CATEGORY_IDS) {
			const entry = CATEGORIES[id as CategoryId];
			const shape = entry.schema.shape;
			for (const field of entry.fields) {
				expect(shape[field.key], `${id}'s schema is missing form field "${field.key}"`).toBeTruthy();
				if (field.kind === 'enum' && field.options) {
					const allowed = new Set(field.options);
					// Every enum option the form offers must satisfy the schema.
					for (const value of field.options) {
						expect(entry.schema.parse({ [field.key]: value }), `${id}: "${value}" rejected`).toBeTruthy();
					}
					// And nothing outside the list should be.
					expect(entry.schema.safeParse({ [field.key]: '__not_an_option__' }).success, `${id}: a bogus ${field.key} parsed`).toBe(false);
				}
				if (field.kind === 'number') {
					expect(entry.schema.parse({ [field.key]: 1 }), `${id}: a numeric ${field.key} was rejected`).toBeTruthy();
				}
			}
		}
	});

	it('keeps the inventory filterable dimensions inside the form fields', () => {
		// A consumption rule can only narrow by what a log form can actually
		// offer — the drift this prevents is a picker value that no form ever
		// writes. (The filter key may differ from the field key for
		// milestone-backed kinds: the form says 'type', the milestones table
		// stores it in its `category` column.)
		for (const id of CATEGORY_IDS) {
			const entry = CATEGORIES[id as CategoryId];
			if (!entry.filter) continue;
			const fieldKeys = new Set(entry.fields.map((f) => f.key));
			expect(
				fieldKeys.has(entry.filter.key),
				`${id} filters on "${entry.filter.key}" but no form field offers it`,
			).toBe(true);
		}
	});
});

describe('the web copy cannot drift from the source', () => {
	it('has a generated vocabulary that is up to date', () => {
		// Fails with the command to run, so the fix is obvious.
		expect(() =>
			execFileSync('npx', ['tsx', 'scripts/generate-vocabulary.ts', '--check'], {
				cwd: REPO_ROOT,
				stdio: 'pipe',
			}),
		).not.toThrow();
	}, 60_000);
});
