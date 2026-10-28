import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The suite runs against whichever system the point of the run is to test.
//
// In CI that system is the preview environment — a real deployment of this
// pull request in the cluster, built from the same immutable images
// production gets (see .github/workflows/preview.yml, which passes its
// PREVIEW_URL here as E2E_BASE_URL). Testing anything else in CI would
// re-create a parallel stack that can drift from the artifact users get,
// which is precisely the failure mode this suite exists to prevent.
//
// Locally the interesting system is the one you are editing, so with no
// E2E_BASE_URL the suite boots the pair a developer runs: the API and the
// vite dev server. Set E2E_BASE_URL to point it anywhere else (a preview,
// a staging box) without standing anything up.

const remoteUrl = process.env.E2E_BASE_URL;

// The API refuses to boot without a master key and a JWT secret (see
// api/src/server.ts), so the local mode pins the same throwaway values the
// API's own vitest setup uses (api/src/test/setup.ts). Nothing here is a
// real secret: every account the suite registers is a random @example.com
// user in a database that is deleted with the run.
const NIDO_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const JWT_SECRET = 'nido-test-secret';

// One throwaway NIDO_DATA_DIR per local run, so the suite never touches
// developer data. Dirs from previous runs (a crashed job, a killed local
// run) are wiped first so the OS tmpdir does not accumulate encrypted
// family files.
const DATA_DIR_PREFIX = 'nido-e2e-';
for (const stale of readdirSync(os.tmpdir()).filter((name) => name.startsWith(DATA_DIR_PREFIX))) {
	rmSync(path.join(os.tmpdir(), stale), { recursive: true, force: true });
}
const dataDir = mkdtempSync(path.join(os.tmpdir(), DATA_DIR_PREFIX));

export default defineConfig({
	testDir: './tests/e2e',

	// The suite is one serial story — register, build up the family, walk the
	// pages, sign out — and every test after the first depends on the state
	// the ones before it created. One worker, no parallelism, and a shared
	// browser session (see tests/e2e/fixtures.ts); robustness over speed.
	// A retry re-runs the whole file against a fresh random account, which
	// works because each account only ever sees its own family.
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: [['list'], ['html', { open: 'never' }]],

	use: {
		baseURL: remoteUrl ?? 'http://localhost:3001',
		// Local mode: vite dev compiles a page on first visit, and the first
		// API round trip provisions an encrypted database — both slower than a
		// normal locator's default 5s. Remote mode: the cluster may be cold.
		actionTimeout: 10_000,
		navigationTimeout: 15_000,
		trace: 'on-first-retry',
	},
	expect: { timeout: 10_000 },

	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

	// Local mode only — against a preview there is nothing to boot; the
	// deployment under test already exists and was built by the same pipeline
	// that builds production.
	...(remoteUrl
		? {}
		: {
				webServer: [
					{
						command: 'npx tsx src/server.ts',
						cwd: '../api',
						url: 'http://localhost:3000/health',
						timeout: 60_000,
						reuseExistingServer: !process.env.CI,
						env: {
							NIDO_MASTER_KEY,
							JWT_SECRET,
							PORT: '3000',
							NIDO_DATA_DIR: dataDir,
						},
					},
					{
						command: 'npm run dev',
						url: 'http://localhost:3001',
						timeout: 60_000,
						reuseExistingServer: !process.env.CI,
						env: { API_PROXY_TARGET: 'http://localhost:3000' },
					},
				],
			}),
});