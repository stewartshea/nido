// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { satteri } from '@astrojs/markdown-satteri';

import { REPO, SITE_BASE } from './src/site.config.ts';
import { baseRelativeLinks } from './src/satteri-base-links.mjs';

/**
 * The repository is `stewartshea/nido`, so GitHub Pages serves it as a
 * **project** site at `nido.stewartshea.github.io` and every asset needs the
 * `/nido` prefix. Override `SITE_BASE` (and `SITE_URL`) to publish the same
 * build as a user site at `stewartshea.github.io` or from a custom domain
 * without touching this file. `SITE_BASE` itself is defined in
 * `src/site.config.ts` so page content can build base-prefixed URLs from the
 * same single source.
 */
const ORIGIN =
	process.env.SITE_URL ?? `https://${REPO.split('/')[0]}.github.io${SITE_BASE === '/' ? '' : SITE_BASE}`;

export default defineConfig({
	site: ORIGIN,
	base: SITE_BASE,
	trailingSlash: 'ignore',
	redirects: {
		// The hosted page launched as /hosted/ and was renamed when the service
		// got its own name. Astro writes the destination verbatim into the
		// meta-refresh page, so it needs the base prefix baked in.
		'/hosted': SITE_BASE === '/' ? '/my-nido' : `${SITE_BASE}/my-nido`,
	},
	markdown: {
		processor: satteri({ hastPlugins: [baseRelativeLinks(SITE_BASE)] }),
	},
	integrations: [
		starlight({
			title: 'Nido',
			description:
				'A free, open source tracker for the things you care for and keep — starting with your baby, and growing to cover the whole home. Self-host it, or use My Nido — hosted in Canada, free.',
			logo: {
				light: './src/assets/crest.svg',
				dark: './src/assets/crest-dark.svg',
				alt: 'Nido nest mark',
			},
			customCss: ['./src/styles/global.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: `https://github.com/${REPO}` },
			],
			// Starlight appends the entry path relative to the *project root*
			// (`src/content/docs/<slug>`), not relative to the docs collection, so
			// `baseUrl` has to stop at `site/`. Ending it at `src/content/docs/`
			// duplicates that segment in every page's "Edit page" link.
			editLink: {
				baseUrl: `https://github.com/${REPO}/edit/main/site/`,
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Overview', slug: 'index' },
						{ label: 'Self-hosting', slug: 'self-host' },
						{ label: 'My Nido (hosted)', slug: 'my-nido' },
						{ label: 'Privacy policy', slug: 'privacy' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'First run', slug: 'getting-started/first-run' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Backup & restore', slug: 'guides/backup-and-restore' },
						{ label: 'Upgrading', slug: 'guides/upgrading' },
						{ label: 'Reverse proxy & TLS', slug: 'guides/reverse-proxy-and-tls' },
						{ label: 'Kubernetes', slug: 'guides/kubernetes' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Configuration', slug: 'reference/configuration' },
						{ label: 'Architecture', slug: 'reference/architecture' },
						{ label: 'Security model', slug: 'reference/security' },
						{ label: 'Containers & volumes', slug: 'reference/containers' },
					],
				},
				{
					label: 'Project',
					items: [
						{ label: 'Roadmap', slug: 'project/roadmap' },
						{ label: 'Contributing', slug: 'project/contributing' },
						{ label: 'Funding', slug: 'project/funding' },
						{ label: 'Support Nido', slug: 'support' },
						{
							label: 'Sponsor on Ko-fi',
							link: 'https://ko-fi.com/sheastewart0494',
							attrs: { target: '_blank', rel: 'noopener' },
						},
					],
				},
			],
		}),
		mdx(),
		sitemap(),
	],
});
