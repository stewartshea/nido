import type { APIRoute } from 'astro';

// Crawl policy. Everything on this site is public documentation for a free,
// open source project, so crawlers and AI agents are explicitly welcome — the
// named allowances make that intent legible to the ones that read it. Generated
// so the Sitemap line follows the configured origin.
export const prerender = true;

const site = (import.meta.env.SITE ?? '').replace(/\/$/, '');

const AI_AGENTS = [
	'GPTBot',
	'OAI-SearchBot',
	'ChatGPT-User',
	'ClaudeBot',
	'Claude-Web',
	'anthropic-ai',
	'PerplexityBot',
	'Google-Extended',
	'Applebot-Extended',
	'CCBot',
	'cohere-ai',
];

const BODY = `# Nido — https://www.nido-app.ca
# Public documentation for a free, open source project. Crawlers and AI agents
# are explicitly welcome; nothing here is private.

User-agent: *
Allow: /

${AI_AGENTS.map((agent) => `User-agent: ${agent}\nAllow: /`).join('\n\n')}

Sitemap: ${site}/sitemap-index.xml
`;

export const GET: APIRoute = () =>
	new Response(BODY, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
