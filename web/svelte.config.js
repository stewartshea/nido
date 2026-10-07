import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter(),

		// Origin checking exists to stop a cross-site form post riding a cookie
		// the browser attaches automatically. This app has no cookies: the session
		// is a bearer token read from localStorage and sent in an Authorization
		// header, which a cross-site page cannot cause to be attached. So the
		// check protects nothing here, and it breaks every multipart upload —
		// attachment and avatar both came back 403 "Cross-site POST form
		// submissions are forbidden".
		csrf: { checkOrigin: false }
	}
};

export default config;