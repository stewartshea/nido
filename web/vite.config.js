import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Comma-separated list of hostnames the dev server is allowed to respond
	// to (e.g. a public domain fronting it through a reverse proxy).
	// "localhost" and bare IP addresses are always allowed by Vite, so this
	// only needs the extra Host headers that arrive in production.
	const rawHosts = loadEnv(mode, process.cwd(), '').ALLOWED_HOSTS;
	const allowedHosts = rawHosts ? rawHosts.split(',').map((h) => h.trim()).filter(Boolean) : ['localhost'];

	// Where the dev server forwards /api/*. In the single-pod deployment the
	// api container shares the pod loopback, so localhost:3000 works there.
	// Docker Compose needs the api service name instead (set via env).
	const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';

	return {
		plugins: [sveltekit()],
		server: {
			port: 3001,
			allowedHosts,
			proxy: {
				'/api': {
					target: apiProxyTarget,
					changeOrigin: true,
				},
			},
		},
		envPrefix: 'PUBLIC_',
	};
});