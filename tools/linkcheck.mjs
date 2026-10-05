// Validates every internal link in a built Astro/Starlight site: does the
// target exist, and does any #fragment match an id in that target?
//
// Written for the docs-site build, which uses trailingSlash: 'ignore' and is
// deployed at base '/', but it resolves against `base` so it also works for
// the /nido-prefixed project-site build.
//
//   node tools/linkcheck.mjs <distDir> [base]
//
// Exits non-zero and prints each broken link, so it can gate a commit.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, dirname, resolve, sep } from 'node:path';

const distDir = resolve(process.argv[2] ?? 'dist');
const base = (process.argv[3] ?? '/').replace(/\/*$/, '/');

/** Every .html file in the build, as posix-style paths relative to distDir. */
async function htmlFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
		else if (entry.name.endsWith('.html')) out.push(full);
	}
	return out;
}

const files = await htmlFiles(distDir);
const relOf = (abs) => relative(distDir, abs).split(sep).join('/');
const byRelPath = new Set(files.map(relOf));

/** All element ids in a page, so fragment links can be checked. */
const idsByFile = new Map();
async function idsIn(abs) {
	if (idsByFile.has(abs)) return idsByFile.get(abs);
	const ids = new Set();
	for (const m of (await readFile(abs, 'utf8')).matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
	// Named anchors written the old way.
	for (const m of (await readFile(abs, 'utf8')).matchAll(/<a[^>]+name="([^"]+)"/g)) ids.add(m[1]);
	idsByFile.set(abs, ids);
	return ids;
}

/** Resolve a page path (e.g. /guides/user-guide/) to a built .html file. */
function toHtmlFile(urlPath) {
	const clean = urlPath.replace(/^\/+/, '');
	if (clean === '' || urlPath.endsWith('/')) return join(distDir, clean, 'index.html');
	if (!clean.endsWith('.html') && !/\.[a-z0-9]+$/i.test(clean)) return join(distDir, `${clean}/index.html`);
	return join(distDir, clean);
}

const problems = [];
let checked = 0;

for (const abs of files) {
	const from = relOf(abs);
	const html = await readFile(abs, 'utf8');
	const dir = dirname(from);

	for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
		const href = m[1];
		if (/^(?:[a-z]+:|\/\/|#|data:|mailto:)/i.test(href)) continue; // external or same-page

		let url = href;
		// Strip the configured base prefix so project-site builds resolve too.
		if (base !== '/' && url.startsWith(base)) url = '/' + url.slice(base.length);
		else if (base !== '/' && url.startsWith('/')) url = '/' + url.replace(/^\//, '');

		const [urlPath, fragment] = url.split('#');
		if (!urlPath) continue; // pure fragment

		// Relative hrefs resolve against the containing page's directory.
		const target = urlPath.startsWith('/') ? toHtmlFile(urlPath) : resolve(distDir, dir, toHtmlFile(urlPath));

		checked++;
		let exists = false;
		try {
			exists = (await stat(target)).isFile();
		} catch {
			exists = false;
		}

		if (!exists) {
			problems.push(`${from}: ${href}  ->  missing target ${relOf(target)}`);
			continue;
		}

		if (fragment) {
			const ids = await idsIn(target);
			if (!ids.has(fragment)) {
				problems.push(`${from}: ${href}  ->  no id "${fragment}" in ${relOf(target)}`);
			}
		}
	}
}

console.log(`${files.length} pages, ${checked} internal links checked at base ${base}`);
if (problems.length) {
	console.error(`\n${problems.length} broken:\n`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log('all internal links and anchors resolve');