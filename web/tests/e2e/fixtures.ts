// The shared browser session for the smoke suite.
//
// The suite runs serially in a single worker (see playwright.config.ts), and
// these flows build on each other: the first test registers an account, and
// everything after it — the family, its members, the sign-out at the end —
// carries forward through the same page. A worker-scoped fixture creates
// that one long-lived page, and the `page` override hands it to every test,
// so each test keeps the idiomatic `({ page })` signature while the app's
// own persistence (the token in localStorage, the family in the API's
// database) survives from test to test.
//
// A retry starts a new worker, which gets a new page and a new random
// account — the suite re-registers and rebuilds its state from scratch.
import { test as base, expect, type Page } from '@playwright/test';

// `sharedPage` is created once per worker; `page` just hands it to tests.
type SharedSessionTestFixtures = { page: Page };
type SharedSessionWorkerFixtures = { sharedPage: Page };

export const test = base.extend<SharedSessionTestFixtures, SharedSessionWorkerFixtures>({
	sharedPage: [
		async ({ browser }, use) => {
			const context = await browser.newContext();
			const page = await context.newPage();
			await use(page);
			await context.close();
		},
		{ scope: 'worker' },
	],
	page: async ({ sharedPage }, use) => {
		await use(sharedPage);
	},
});

export { expect };

/** A random test user. Never a real address; nothing sensitive is logged. */
export function testEmail(): string {
	const rand = Math.random().toString(36).slice(2, 10);
	return `e2e-${Date.now().toString(36)}-${rand}@example.com`;
}
