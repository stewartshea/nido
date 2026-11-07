#!/usr/bin/env node
/**
 * Keep the "New in <release>" highlights at the top of the docs honest.
 *
 *   node scripts/docs-release.mjs --check [--strict]
 *   node scripts/docs-release.mjs --release [tag]
 *
 * `--check` is the CI gate. It fails on a broken block, a title that disagrees
 * with its marker, or a tag that does not exist. A highlight older than 60 days
 * is a warning; `--strict` turns that warning into a failure.
 *
 * `--release` is the hand-off from a release. It prints the merged pull
 * requests since the previous tag, the highlights that are live now, and the
 * checklist for writing the next one. The release workflow appends its output
 * to the run summary, so the docs update starts from the release rather than
 * from memory.
 *
 * The writing rules live in `.agents/skills/feature-update/SKILL.md`. This
 * script only checks the shape; it cannot judge whether the why is true.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(ROOT, 'site/src/content/docs');
const MAX_AGE_DAYS = 60;

const TAG = /^v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;
const OPEN = /^<!--\s*feature-update:\s*(v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)\s*-->$/;
const CLOSE = /^<!--\s*\/feature-update\s*-->$/;
const TITLE = /^:::note\[New in (v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?): .+\]$/;

function git(args) {
	return execFileSync('git', args, {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 16 * 1024 * 1024,
	}).trim();
}

function walk(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walk(path));
		else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) files.push(path);
	}
	return files;
}

function tagDates() {
	const dates = new Map();
	try {
		for (const line of git(['for-each-ref', '--format=%(refname:short) %(creatordate:short)', 'refs/tags']).split('\n')) {
			const [tag, date] = line.trim().split(/\s+/);
			if (TAG.test(tag) && date) dates.set(tag, date);
		}
	} catch {
		// Not a git checkout, or no tags. Existence checks below will say so.
	}
	return dates;
}

function ageInDays(date) {
	const then = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isFinite(then)) return null;
	return Math.floor((Date.now() - then) / 86_400_000);
}

function parseFile(file) {
	const text = readFileSync(file, 'utf8');
	const lines = text.split('\n');
	const blocks = [];
	const errors = [];
	const firstHeading = lines.findIndex((line) => /^##\s+/.test(line));

	for (let i = 0; i < lines.length; i += 1) {
		const open = lines[i].match(OPEN);
		if (!open) {
			if (CLOSE.test(lines[i])) errors.push(`closing marker without an opening marker`);
			continue;
		}

		const version = open[1];
		let end = -1;
		for (let j = i + 1; j < lines.length; j += 1) {
			if (OPEN.test(lines[j])) {
				errors.push(`a second feature-update starts before the first one closes`);
				break;
			}
			if (CLOSE.test(lines[j])) {
				end = j;
				break;
			}
		}

		if (end === -1) {
			errors.push(`opening marker for ${version} has no closing marker`);
			continue;
		}

		const firstContent = lines.slice(i + 1, end).find((line) => line.trim() !== '');
		const title = firstContent?.match(TITLE);
		if (!firstContent) {
			errors.push(`block for ${version} is empty`);
		} else if (!title) {
			errors.push(`block for ${version} does not start with ":::note[New in ${version}: …]"`);
		} else if (title[1] !== version) {
			errors.push(`marker says ${version} but the title says ${title[1]}`);
		}

		if (firstHeading !== -1 && i > firstHeading) {
			errors.push(`block for ${version} sits below the first section heading; put it above the page intro`);
		}

		blocks.push({ file, version, start: i, end });
		i = end;
	}

	if (blocks.length > 1) {
		errors.push(`${blocks.length} feature-update blocks; one page gets one highlight`);
	}

	return { blocks, errors };
}

function collect() {
	const dates = tagDates();
	const shallow = (() => {
		try {
			return git(['rev-parse', '--is-shallow-repository']) === 'true';
		} catch {
			return false;
		}
	})();

	const files = walk(DOCS).sort();
	const blocks = [];
	const errors = [];
	const warnings = [];

	for (const file of files) {
		const parsed = parseFile(file);
		const page = relative(ROOT, file);
		for (const error of parsed.errors) errors.push(`${page}: ${error}`);
		for (const block of parsed.blocks) {
			const date = dates.get(block.version);
			if (!date) {
				if (shallow && dates.size === 0) {
					warnings.push(`${page}: cannot verify tag ${block.version} in a shallow checkout`);
				} else {
					errors.push(`${page}: ${block.version} is not a tag in this repository`);
				}
				blocks.push({ ...block, page });
				continue;
			}
			const age = ageInDays(date);
			if (age !== null && age > MAX_AGE_DAYS) {
				warnings.push(`${page}: ${block.version} is ${age} days old; fold it into the page and remove it`);
			}
			blocks.push({ ...block, page, date, age });
		}
	}

	return { blocks, errors, warnings };
}

function check(strict) {
	const { blocks, errors, warnings } = collect();

	for (const block of blocks) {
		const age = block.age == null ? 'unknown age' : `${block.age} day${block.age === 1 ? '' : 's'} old`;
		console.log(`  ${block.page}  ${block.version}  (${age})`);
	}
	if (blocks.length === 0) console.log('  none');

	console.log('');
	console.log(`${blocks.length} highlight${blocks.length === 1 ? '' : 's'}, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`);

	for (const warning of warnings) console.warn(`warning: ${warning}`);
	for (const error of errors) console.error(`error: ${error}`);

	if (errors.length > 0 || (strict && warnings.length > 0)) process.exit(1);
}

function releaseNotes(tag, previous) {
	try {
		return execFileSync('gh', ['release', 'view', tag, '--json', 'body', '--jq', '.body'], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 16 * 1024 * 1024,
		}).trim();
	} catch {
		if (!previous) return '';
		try {
			return git(['log', '--no-decorate', '--pretty=format:- %s (%h)', `${previous}..${tag}`]);
		} catch {
			return '';
		}
	}
}

function release(tagArg) {
	const tag = tagArg || (() => {
		try {
			return git(['describe', '--tags', '--abbrev=0']);
		} catch {
			return '';
		}
	})();

	if (!TAG.test(tag)) {
		console.error(`error: "${tag || '(none)'}" is not a release tag. Pass one, or tag the release first.`);
		process.exit(1);
	}

	let previous = '';
	try {
		previous = git(['describe', '--tags', '--abbrev=0', `${tag}^`]);
	} catch {
		// The first release has no previous tag.
	}

	const notes = releaseNotes(tag, previous);
	const { blocks } = collect();

	console.log(`## Docs feature update for ${tag}`);
	console.log('');
	if (previous) console.log(`Changes since ${previous}:`);
	else console.log('This is the first tagged release, so every change is new.');

	if (notes) {
		console.log('');
		console.log(notes);
	} else {
		console.log('');
		console.log('_Could not read the release notes here. Use `git log` and the GitHub release page._');
	}

	console.log('');
	console.log('### Highlights live now');
	console.log('');
	if (blocks.length === 0) {
		console.log('_None._');
	} else {
		console.log('| Page | Version | Age |');
		console.log('| --- | --- | --- |');
		for (const block of blocks) {
			console.log(`| \`${block.page}\` | ${block.version} | ${block.age == null ? 'unknown' : `${block.age}d`} |`);
		}
	}

	console.log('');
	console.log('### Checklist');
	console.log('');
	console.log('- [ ] Read the merged changes above and pick the one a reader would act on.');
	console.log('- [ ] Add a `feature-update` block to the page that change lives on.');
	console.log('- [ ] Replace the old block on that page; fold durable detail into the body.');
	console.log('- [ ] Update the latest-release card in `site/src/content/docs/index.mdx`.');
	console.log('- [ ] Run `npm run docs:check`, then open the docs PR.');
	console.log('');
	console.log('The writing rules are in `.agents/skills/feature-update/SKILL.md`.');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
	console.log('Usage: node scripts/docs-release.mjs --check [--strict]');
	console.log('       node scripts/docs-release.mjs --release [tag]');
	process.exit(0);
}

if (args.includes('--release')) {
	const index = args.indexOf('--release');
	release(args[index + 1]);
} else if (args.includes('--check')) {
	check(args.includes('--strict'));
} else {
	console.error('Usage: node scripts/docs-release.mjs --check [--strict]');
	console.error('       node scripts/docs-release.mjs --release [tag]');
	process.exit(1);
}
