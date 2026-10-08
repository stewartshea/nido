// scripts/generate-vocabulary.ts
//
// Writes web/src/lib/vocabulary.generated.ts from api/src/vocabulary.ts.
//
//   npx tsx scripts/generate-vocabulary.ts            # write it
//   npx tsx scripts/generate-vocabulary.ts --check    # fail if it is stale
//
// The web builds from its own directory in its own container, so it cannot
// import the API's module. Generating a file inside web/src keeps the build
// untouched while leaving one place — api/src/vocabulary.ts — where a category
// is actually defined. The generated file is checked in so the web build never
// depends on this script having run, and --check (run by a test) means it cannot
// silently drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CATEGORY_IDS,
	MILESTONE_CATEGORY_IDS,
	CATEGORY_OPTION_KEY,
	CATEGORY_OPTIONS,
	STAGES,
	DIGEST_FREQUENCIES,
} from '../api/src/vocabulary';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/src/lib/vocabulary.generated.ts');

const list = (name: string, values: readonly string[]) =>
	`export const ${name} = [\n${values.map((v) => `\t'${v}',`).join('\n')}\n] as const;`;

// Not `as const`: these are data, and making the string arrays readonly only
// forces every consumer to widen them back.
const record = (name: string, value: unknown) =>
	`export const ${name} = ${JSON.stringify(value, null, '\t')};`;

const rendered = `// AUTO-GENERATED — do not edit.
//
// Source: api/src/vocabulary.ts
// Regenerate: npx tsx scripts/generate-vocabulary.ts
//
// Hand-editing this file will be undone, and a test fails if it is out of date.
// Add a category in the API module instead.

${list('CATEGORY_IDS', CATEGORY_IDS)}

export type CategoryId = (typeof CATEGORY_IDS)[number];

${list('MILESTONE_CATEGORY_IDS', MILESTONE_CATEGORY_IDS)}

export type MilestoneCategoryId = (typeof MILESTONE_CATEGORY_IDS)[number];

${list('STAGES', STAGES)}

export type Stage = (typeof STAGES)[number];

${list('DIGEST_FREQUENCIES', DIGEST_FREQUENCIES)}

export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

${record('CATEGORY_OPTION_KEY', CATEGORY_OPTION_KEY)}

${record('CATEGORY_OPTIONS', CATEGORY_OPTIONS)}
`;

const stale = (() => {
	try {
		return readFileSync(OUT, 'utf8') !== rendered;
	} catch {
		return true;
	}
})();

if (process.argv.includes('--check')) {
	if (stale) {
		console.error(
			'web/src/lib/vocabulary.generated.ts is out of date with api/src/vocabulary.ts.\n' +
				'Run: npx tsx scripts/generate-vocabulary.ts',
		);
		process.exit(1);
	}
	console.log('generated vocabulary is in sync.');
} else if (stale) {
	writeFileSync(OUT, rendered);
	console.log(`wrote ${OUT}`);
} else {
	console.log('generated vocabulary is already in sync.');
}
