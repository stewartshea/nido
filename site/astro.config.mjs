// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { satteri } from '@astrojs/markdown-satteri';

import { REPO } from './src/site.config.ts';
import { baseRelativeLinks } from './src/satteri-base-links.mjs';

/**
 * The repository is `stewartshea/nido`, so GitHub Pages serves it as a
 * **project** site at `nido.stewartshea.github.io` and every asset needs the
 * `/nido` prefix. Override `SITE_BASE` (and `SITE_URL`) to publish the same
 * build as a user site at `stewartshea.github.io` or from a custom domain
 * without touching this file.
 */
const BASE = process.env.SITE_BASE ?? '/nido';
const ORIGIN =
	process.env.SITE_URL ?? `https://${REPO.split('/')[0]}.github.io${BASE === '/' ? '' : BASE}`;

export default defineConfig({
	site: ORIGIN,
	base: BASE,
	trailingSlash: 'ignore',
	markdown: {
		processor: satteri({ hastPlugins: [baseRelativeLinks(BASE)] }),
	},
	integrations: [
		starlight({
			title: 'Nido',
			description:
				'A self-hosted newborn and infant tracker. Feeds, diapers, sleep, growth, milestones and vaccinations — on your own hardware, free forever.',
			logo: {
				src: './src/assets/crest.svg',
			},
			customCss: ['./src/styles/global.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: `https://github.com/${REPO}` },
			],
			editLink: {
				baseUrl: `https://github.com/${REPO}/edit/main/site/src/content/docs/`,
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Overview', slug: 'index' },
						{ label: 'Self-hosting', slug: 'self-host' },
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
					],
				},
			],
		}),
		mdx(),
		sitemap(),
	],
});
