// src/vocabulary.test.ts
//
// Guards the one thing the vocabulary consolidation is for: a category added in
// api/src/vocabulary.ts cannot silently fail to reach the web.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_IDS, MILESTONE_CATEGORY_IDS, CATEGORY_OPTION_KEY, CATEGORY_OPTIONS, STAGE_CATEGORIES } from './vocabulary';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the vocabulary is well formed', () => {
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
