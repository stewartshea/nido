/**
 * Single source of truth for the URLs the site chrome and the funding panels
 * read, so those are edited in one place rather than in `astro.config.mjs` and
 * the MDX that renders them. Funding channels still marked `null` render as a
 * visibly inactive control rather than a dead link, so a half-configured deploy
 * never ships a 404 to a supporter.
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
 * Funding channels, in priority order. See the "Why not Patreon" section of
 * `src/content/docs/support.mdx` for why the ordering and the platform choice
 * are what they are.
 */
export const funding = {
	/**
	 * Primary. Recurring, and it sits alongside the GitHub billing the target
	 * audience already uses, so supporting costs no extra account. It also
	 * handles the cross-border tax withholding and reporting that a solo
	 * maintainer would otherwise own.
	 */
	githubSponsors: 'https://github.com/sponsors/stewartshea',
	/** Secondary. Non-profit operated, recurring, an alternative to a single vendor. */
	liberapay: null as string | null,
	/**
	 * Tip jar for people who want to give once without creating a GitHub
	 * account. One-time by design, so it is last and never the default.
	 */
	buyMeACoffee: null as string | null,
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
	funding,
	isLive,
} as const;

export default SITE;
