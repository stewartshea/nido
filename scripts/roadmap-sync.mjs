#!/usr/bin/env node
// scripts/roadmap-sync.mjs
//
// Rewrites the generated block in ROADMAP.md from the GitHub Projects board,
// and reports drift between the board and the issue tracker.
//
//   node scripts/roadmap-sync.mjs           # rewrite ROADMAP.md
//   node scripts/roadmap-sync.mjs --check   # fail if ROADMAP.md is stale (for CI)
//
// The board is the schedule, the issues are the conversation, and this script is
// what stops ROADMAP.md from claiming something the other two do not say.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROADMAP = join(REPO_ROOT, 'ROADMAP.md');
const PROJECT_NUMBER = process.env.NIDO_ROADMAP_PROJECT ?? '2';
const START = '<!-- roadmap:start -->';
const END = '<!-- roadmap:end -->';
const CHECK_ONLY = process.argv.includes('--check');
const ADD_INDEX = process.argv.indexOf('--add');
const ADD_ISSUE = ADD_INDEX === -1 ? null : process.argv[ADD_INDEX + 1];

function gh(args, { allowFail = false } = {}) {
	try {
		return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (err) {
		const detail = (err.stderr || err.message || '').toString().trim();
		if (allowFail) return null;
		throw new Error(`gh ${args[0]} failed: ${detail}`);
	}
}

function ghJson(args) {
	const out = gh(args);
	try {
		return JSON.parse(out);
	} catch {
		throw new Error(`gh ${args[0]} did not return JSON`);
	}
}

/** Owner login, taken from the origin remote so it is not hardcoded twice. */
function ownerFromRemote() {
	if (process.env.NIDO_ROADMAP_OWNER) return process.env.NIDO_ROADMAP_OWNER;
	try {
		const url = gh(['repo', 'view', '--json', 'owner', '--jq', '.owner.login']);
		if (url.trim()) return url.trim();
	} catch {
		/* fall through to the remote */
	}
	const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
	const m = remote.match(/github\.com[:/]+([^/]+)\//);
	if (!m) throw new Error('Could not determine the GitHub owner from the origin remote');
	return m[1];
}

const owner = ownerFromRemote();

// Put a labelled issue on the board, so the drift advice below is actionable
// rather than just telling the reader to go and do it by hand.
if (ADD_ISSUE) {
	const url = `https://github.com/stewartshea/nido/issues/${ADD_ISSUE}`;
	const added = ghJson(['project', 'item-add', PROJECT_NUMBER, '--owner', owner, '--url', url, '--format', 'json']);
	console.log(`Added #${ADD_ISSUE} to the board (${added.id}). To set its fields, look up the ids:`);
	console.log(`  gh project field-list ${PROJECT_NUMBER} --owner ${owner} --format json`);
	process.exit(0);
}

const items = ghJson(['project', 'item-list', PROJECT_NUMBER, '--owner', owner, '--format', 'json', '-L', '200']).items ?? [];
const issues = ghJson([
	'issue', 'list', '--label', 'feature request', '--state', 'all',
	'--limit', '200', '--json', 'number,title,state,labels,url',
]).map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }));

const board = items.filter((i) => i.content?.type === 'Issue');
const boardNumbers = new Set(board.map((i) => i.content.number));

// Drift: the two sides disagreeing is the whole reason this script exists.
const drift = [];
for (const issue of issues) {
	if (!boardNumbers.has(issue.number)) {
		drift.push(`- **#${issue.number}** is labelled \`feature request\` but is not on the board — run \`node scripts/roadmap-sync.mjs --add ${issue.number}\` or add it manually.`);
	}
}
for (const item of board) {
	const n = item.content.number;
	const issue = issues.find((i) => i.number === n);
	if (!issue) {
		drift.push(`- Board item **#${n}** has no \`feature request\` issue behind it.`);
		continue;
	}
	if (issue.state === 'CLOSED' && item.status !== 'Done') {
		drift.push(`- **#${n}** is closed but the board says \`${item.status}\`.`);
	}
	if (item.status === 'Done' && issue.state !== 'CLOSED') {
		drift.push(`- **#${n}** is \`Done\` on the board but the issue is still ${issue.state.toLowerCase()}.`);
	}
	// The roadmap: planned label is the one that promises a build; a mismatch
	// against the board means the README and the issue disagree with the board.
	const labels = issue.labels;
	const wantsLabel = item.status === 'In Progress' || item.status === 'Done' ? 'roadmap: planned' : null;
	if (wantsLabel && !labels.includes(wantsLabel)) {
		drift.push(`- **#${n}** is \`${item.status}\` on the board but is missing the \`${wantsLabel}\` label.`);
	}
}

const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const esc = (s) => String(s).replace(/\|/g, '\\|');

const rows = board
	.slice()
	.sort((a, b) => {
		const pa = a.priority ?? '';
		const pb = b.priority ?? '';
		if (pa !== pb) return pa < pb ? -1 : 1;
		return a.content.number - b.content.number;
	})
	.map((i) => {
		const n = i.content.number;
		const url = i.content.url ?? `https://github.com/stewartshea/nido/issues/${n}`;
		return `| [${cell(n)}](${url}) | ${esc(i.title)} | ${cell(i.status)} | ${cell(i.priority)} | ${cell(i.area)} |`;
	});

const generated = [
	START,
	'<!-- Generated by scripts/roadmap-sync.mjs. Do not edit this block by hand. -->',
	'',
	'| Issue | Capability | Status | Priority | Area |',
	'| --- | --- | --- | --- | --- |',
	rows.length ? rows.join('\n') : '| — | _No roadmap items yet_ | — | — | — |',
	'',
	drift.length
		? ['<!-- drift:start -->', '**In sync?** No. These need attention:', '', ...drift, '', '<!-- drift:end -->'].join('\n')
		: ['<!-- drift:start -->', '**In sync?** Yes — every `feature request` issue is on the board, and the board agrees with the issue states.', '', '<!-- drift:end -->'].join('\n'),
	END,
].join('\n');

const current = readFileSync(ROADMAP, 'utf8');
const startIdx = current.indexOf(START);
const endIdx = current.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
	throw new Error(`ROADMAP.md is missing the ${START} / ${END} markers`);
}
const next = current.slice(0, startIdx) + generated + current.slice(endIdx + END.length);

if (next === current) {
	console.log('ROADMAP.md is already in sync.');
} else if (CHECK_ONLY) {
	console.error('ROADMAP.md is out of sync with the board. Run: node scripts/roadmap-sync.mjs');
	if (drift.length) {
		console.error(drift.join('\n'));
		process.exit(1);
	}
	process.exit(1);
} else {
	writeFileSync(ROADMAP, next);
	console.log(`ROADMAP.md updated: ${board.length} item(s) on the board.`);
}

if (drift.length) {
	console.log('');
	console.log('Drift between the board and the issues:');
	console.log(drift.join('\n'));
}