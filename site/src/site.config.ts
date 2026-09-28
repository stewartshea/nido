/**
 * Single source of truth for the URLs the site chrome and the funding panels
 * read, so those are edited in one place rather than in `astro.config.mjs` and
 * the MDX that renders them. A channel left without a URL renders as a visibly
 * inactive control rather than a dead link, so a half-configured deploy never
 * ships a 404 to a supporter.
 *
 * Docs *prose* still spells out `github.com/stewartshea/...` literally; those
 * are copy, not chrome, and are not wired through here.
 */

export const REPO = 'stewartshea/nido';
export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new`;
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
export const SECURITY_ADVISORY_URL = `${REPO_URL}/security/advisories/new`;
export const IMAGES_URL = 'https://github.com/stewartshea/nido/pkgs/container/nido';

/**
 * The hosted option, for people who would rather not run Docker. It is the
 * same Apache-2.0 codebase as a self-hosted install — no feature is withheld
 * from either side — and it is free: there are no paid tiers, only an optional
 * way to support the project.
 */
export const HOSTED_URL = 'https://my.nido-app.ca';

/**
 * The path the site is served under — `/nido` for the GitHub Pages project
 * site, `/` for a user site or custom domain. Owned here so `astro.config.mjs`
 * and page content resolve the prefix from one place.
 */
export const SITE_BASE = process.env.SITE_BASE ?? '/nido';

/**
 * Build a base-prefixed URL for a docs route.
 *
 * Prefer markdown links (`[text](../self-host/)`) — those are always safe, and
 * the mechanism differs by extension:
 *
 * - In `.md`, `satteri-base-links.mjs` rewrites them at build time.
 * - In `.mdx` the hast plugin never runs, but Astro's own MDX pipeline resolves
 *   relative markdown links and `base` is applied to the result.
 *
 * An `href` written as an attribute in a raw HTML block is rewritten by neither
 * path, in either extension: in `.md` a raw HTML block is not parsed as
 * markdown, and in `.mdx` the plugin is absent. Those need `withBase` by hand
 * and silently rot to a 404 if the file moves, so prefer markdown links.
 *
 * @param route Route relative to the docs root, with or without a leading slash.
 */
export const withBase = (route: string): string => {
	const prefix = SITE_BASE.replace(/\/$/, '');
	const path = route.replace(/^\//, '');
	return path === '' ? `${prefix}/` : `${prefix}/${path}`;
};

/**
 * Funding channels, in priority order. The ordering follows platform cost and
 * account friction, not sentiment — see the "Where to sponsor" section of
 * `src/content/docs/support.mdx` for the comparison.
 */
export const funding = {
	/**
	 * Primary, recurring. It sits alongside the GitHub billing the target
	 * audience already uses, so supporting costs no extra account, and it
	 * handles the cross-border tax withholding a solo maintainer would
	 * otherwise own. GitHub takes no platform fee on sponsorship from a
	 * personal account, so it is also the cheapest option.
	 */
	githubSponsors: 'https://github.com/sponsors/stewartshea',
	/**
	 * Secondary, one-time. For people who want to give once without a GitHub
	 * account or a recurring commitment. Ko-fi takes no platform fee on tips.
	 */
	kofi: 'https://ko-fi.com/sheastewart0494',
} as const;

export type FundingKey = keyof typeof funding;

export const isLive = (channel: FundingKey): boolean =>
	typeof funding[channel] === 'string' && funding[channel]!.length > 0;

export const SITE = {
	repo: REPO,
	repoUrl: REPO_URL,
	issuesUrl: ISSUES_URL,
	newIssueUrl: NEW_ISSUE_URL,
	discussionsUrl: DISCUSSIONS_URL,
	securityAdvisoryUrl: SECURITY_ADVISORY_URL,
	imagesUrl: IMAGES_URL,
	hostedUrl: HOSTED_URL,
	funding,
	isLive,
} as const;

export default SITE;
