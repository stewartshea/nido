import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_BASE } from '../site.config';

// Every docs page concatenated into one plain-text file, so an agent can read
// the whole documentation in a single fetch. Generated from the docs collection
// so it cannot drift from the pages.
export const prerender = true;

const site = (import.meta.env.SITE ?? '').replace(/\/$/, '');
const base = SITE_BASE.replace(/\/$/, '');

/** MDX bodies can carry import statements; they are not documentation prose. */
function stripNonProse(body: string): string {
	return body
		.split('\n')
		.filter((line) => !/^\s*import\s.+from\s+['"]/.test(line))
		.join('\n')
		.trim();
}

export const GET: APIRoute = async () => {
	const docs = (await getCollection('docs'))
		.slice()
		.sort((a, b) => a.id.localeCompare(b.id));

	const parts = docs.map((entry) => {
		const title = entry.data.title;
		const description = entry.data.description ? `> ${entry.data.description}\n\n` : '';
		const body = stripNonProse(entry.body ?? '');
		return `# ${title}\n\n${description}${body}\n\nSource: ${site}${base}/${entry.id === 'index' ? '' : `${entry.id}/`}`;
	});

	const header = `# Nido — full documentation\n\n> A free, open source tracker for the things you care for and keep — feeds, diapers, sleep, growth, milestones, vaccinations, appointments, journal, inventory, and home asset maintenance, plus an embedded MCP server for AI agents.\n>\n> This file concatenates the Nido documentation. Source: https://github.com/stewartshea/nido — License: Apache-2.0.`;

	const text = [header, ...parts].join('\n\n---\n\n');
	return new Response(`${text}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
