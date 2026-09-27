import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DOCS_DIR = fileURLToPath(new URL('./content/docs/', import.meta.url));

/**
 * Rewrites relative links in docs to absolute, base-prefixed URLs.
 *
 * Relative links are written file-relative: from `getting-started/first-run.md`,
 * `../reference/security/` means `src/content/docs/reference/security`. A
 * browser cannot apply that rule. It resolves relative URLs against the page's
 * *route* directory, which sits one level deeper than the file's own directory,
 * so the identical string resolves to `/nido/getting-started/reference/security/`
 * and 404s.
 *
 * Resolving at build time is what makes the two agree, and it keeps links
 * base-agnostic: they stay correct at `/nido`, at a custom domain, or at a
 * user-site root. Only files under the docs collection are touched, and the
 * factory returns `false` for anything else so the plugin costs nothing
 * elsewhere in the build.
 */
export function baseRelativeLinks(base) {
	return ({ fileURL }) => {
		if (!fileURL) return false;

		const relativePath = path.relative(DOCS_DIR, fileURLToPath(fileURL));
		if (!relativePath || relativePath.startsWith('..')) return false;

		const fromDir = path.posix.dirname(relativePath.split(path.sep).join('/'));

		// `base` is `/nido` in production and `/` for a user site, so strip the
		// trailing slash once and re-add exactly one when joining. Concatenating
		// the raw base would emit `///` for a user-site build.
		const prefix = base.replace(/\/$/, '');

		const rewrite = (url) => {
			if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return url;
			const boundary = url.search(/[#?]/);
			const pathname = boundary === -1 ? url : url.slice(0, boundary);
			const rest = boundary === -1 ? '' : url.slice(boundary);

			const resolved = path.posix.normalize(path.posix.join(fromDir, pathname));
			const trailingSlash = resolved.endsWith('/');

			// Clamp at the collection root: `..` that runs past `docs/` is dropped
			// rather than emitted, so a link can never escape the site base.
			const segments = [];
			for (const segment of resolved.split('/')) {
				if (segment === '' || segment === '.') continue;
				if (segment === '..') {
					segments.pop();
					continue;
				}
				segments.push(segment);
			}

			// Starlight serves `index` as the collection root, not a nested page.
			if (segments.length === 1 && /^index(\.mdx?)?$/.test(segments[0])) segments.length = 0;

			const route = segments.join('/');
			const suffix = trailingSlash ? '/' : '';
			// An empty route is the collection root. It must collapse to `${prefix}/`
			// rather than `${prefix}//`, which a browser would read as a
			// protocol-relative URL to a host named after the fragment.
			const target = route === '' ? `${prefix}/` : `${prefix}/${route}${suffix}`;
			return `${target}${rest}`;
		};

		return {
			name: 'nido:base-relative-links',
			element: {
				filter: ['a', 'img', 'source', 'link'],
				visit(node, ctx) {
					for (const attribute of ['href', 'src']) {
						const value = node.properties?.[attribute];
						if (typeof value === 'string') ctx.setProperty(node, attribute, rewrite(value));
					}
				},
			},
		};
	};
}
