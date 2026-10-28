// The end-to-end smoke suite — the safety net for the god-pages refactor.
//
// The family, dashboard, home and settings pages were decomposed into shared
// stores ($lib/stores/family, feedback, familySettings, reminders) and
// panels; this suite walks the flows that decomposition must not break:
// register, build up a family, switch members, edit through the unified
// modal, walk the settings tabs, and sign back out. It exercises a real
// deployment end to end — in CI the preview environment this pull request
// deployed (same images as production, own database); locally the API and
// dev server. No mocks, because the point is the wiring between pages,
// stores and API.
//
// The tests are serial and share one browser session (tests/e2e/fixtures.ts);
// each one builds on the state the previous ones created.

import { test, expect, testEmail } from './fixtures';

// One throwaway account per run. The API provisions "<lastName> Family" at
// registration, so the family name is fixed by the last name.
const FIRST_NAME = 'E2e';
const LAST_NAME = 'Tester';
const FAMILY_NAME = `${LAST_NAME} Family`;
const ACCOUNT_INITIAL = FIRST_NAME[0];
const PASSWORD = 'e2e-pass-1234';

const CHILD = 'Nova';
const CHILD_RENAMED = `${CHILD} Star`;

test.describe.configure({ mode: 'serial' });

test('register lands on the dashboard with the owner as the starting profile', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

	await page.getByRole('button', { name: 'Create an account' }).click();
	await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

	await page.fill('#reg-first', FIRST_NAME);
	await page.fill('#reg-last', LAST_NAME);
	await page.fill('#reg-email', testEmail());
	await page.fill('#reg-password', PASSWORD);
	await page.getByRole('button', { name: 'Register' }).click();

	// Registration signs the account in and drops it on the dashboard. The
	// family is provisioned during registration (POST /families answers 409 —
	// "creation happens during registration"), so the empty state must NOT
	// render and the owner's own profile is the member the page opens on.
	await page.waitForURL('**/dashboard');
	await expect(page.getByRole('button', { name: 'Switch person' })).toBeVisible();
	// The owner is an untrackable adult, so there is no "Today for" panel
	// yet — but the switcher names them and the activity feed renders.
	await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`).first()).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
	await expect(page.getByText("You haven't set up a family yet.")).toHaveCount(0);
	await expect(page.getByText('Your family has no members yet.')).toHaveCount(0);
});

test('family page: overview renders, upcoming card shows, no reminders banner', async ({ page }) => {
	await page.goto('/family');

	await expect(page.getByRole('heading', { name: 'Family Overview' })).toBeVisible();
	// The owner is the only member so far, so the overview shows their card.
	await expect(page.getByTestId('member-card').filter({ hasText: `${FIRST_NAME} ${LAST_NAME}` })).toBeVisible();

	// The family-level "what's booked ahead" card renders with its empty
	// copy — family-level data belongs on the family page, not the dashboard.
	const upcoming = page.getByTestId('upcoming-appointments-card');
	await expect(upcoming).toBeVisible();
	await expect(upcoming.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
	await expect(upcoming).toContainText('Nothing booked in the next 30 days.');

	// A fresh family has no overdue reminder rules, so the danger banner
	// ($lib/stores/reminders) must not render at all.
	await expect(page.getByTestId('reminders-banner')).toHaveCount(0);
});

test('settings Members tab: add a member; the toast confirms then auto-dismisses', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

	await page.getByRole('button', { name: 'Members' }).click();
	await expect(page.getByRole('heading', { name: `Invite someone to ${FAMILY_NAME}` })).toBeVisible();

	// The "Add a family member" form (the only reachable add-member form —
	// the family page's own copies render only for edge states this
	// account model never hits).
	await page.selectOption('#member-type-x', 'child');
	await page.selectOption('#member-stage-x', 'infant');
	await page.fill('#member-name-x', CHILD);
	await page.fill('#member-dob-x', '2026-06-01');
	await page.selectOption('#member-gender-x', 'female');
	await page.getByRole('button', { name: 'Add Family Member' }).click();

	// The one toast pattern (AGENTS.md: Feedback): fixed top-right, Check
	// icon, 6s auto-dismiss — driven by $lib/stores/feedback and rendered by
	// FeedbackToasts. It must appear, then dismiss itself.
	const toast = page.getByTestId('feedback-toast');
	await expect(toast).toBeVisible();
	await expect(toast).toHaveClass(/fixed top-4 right-4/);
	await expect(toast.locator('svg').first()).toBeVisible();
	await expect(toast).toContainText(`${CHILD} added to the family.`);
	await expect(toast).toBeHidden({ timeout: 8_000 });

	// And the member is actually in the family.
	await expect(page.getByRole('heading', { name: `People in ${FAMILY_NAME}` })).toBeVisible();
	await expect(page.locator('li').filter({ hasText: CHILD })).toBeVisible();
});

test('family page: member pills switch, detail view opens and returns', async ({ page }) => {
	await page.goto('/family');

	// Two members now, so the pill row renders. Switch to the child.
	const childPill = page.getByRole('button', { name: new RegExp(`\\b${CHILD}\\b`) });
	await expect(childPill).toBeVisible();
	await childPill.click();
	await expect(childPill).toHaveClass(/bg-accent/);

	// Open the child's detail view from the overview card.
	await page
		.getByTestId('member-card')
		.filter({ hasText: CHILD })
		.getByRole('button', { name: 'Log Activity' })
		.click();

	// familyView='detail': the breadcrumb replaces the overview. The ‹ and /
	// glyphs are aria-hidden, so the breadcrumb's accessible name is just
	// "family / member".
	await expect(page.getByRole('button', { name: new RegExp(`${FAMILY_NAME} ${CHILD}`) })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Family Overview' })).toHaveCount(0);

	// Back to the dashboard view.
	await page.getByRole('button', { name: new RegExp(`${FAMILY_NAME} ${CHILD}`) }).click();
	await expect(page.getByRole('heading', { name: 'Family Overview' })).toBeVisible();
});

test('family page: the unified EditMemberModal renames a member', async ({ page }) => {
	await page.goto('/family');

	await page
		.getByTestId('member-card')
		.filter({ hasText: CHILD })
		.getByRole('button', { name: 'Edit' })
		.click();

	// The stage-mode chrome the family page uses.
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Edit family member' })).toBeVisible();

	await dialog.locator('#edit-member-name').fill(CHILD_RENAMED);
	await dialog.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByTestId('feedback-toast')).toContainText('Member updated.');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByTestId('member-card').filter({ hasText: CHILD_RENAMED })).toBeVisible();
});

test('settings: every tab renders its panel; a non-admin sees no Admin tab', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);

	const back = () => page.getByRole('button', { name: 'Back to Settings' }).click();

	await page.getByRole('button', { name: 'Profile' }).click();
	await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
	await back();

	await page.getByRole('button', { name: 'Family & tracking' }).click();
	await expect(page.getByRole('heading', { name: 'Family & tracking' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Categories by stage' })).toBeVisible();
	await back();

	await page.getByRole('button', { name: 'Members' }).click();
	await expect(page.getByRole('heading', { name: `Invite someone to ${FAMILY_NAME}` })).toBeVisible();
	await expect(page.getByRole('heading', { name: `People in ${FAMILY_NAME}` })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Add a family member' })).toBeVisible();
	await back();

	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible();
	await back();

	await page.getByRole('button', { name: 'Backup' }).click();
	// exact: the panel also has a "Restore from backup" heading.
	await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Restore from backup' })).toBeVisible();
	await back();

	// Still no Admin row after the walk.
	await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});

test('Family & tracking: changing the digest frequency saves with a toast', async ({ page }) => {
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Family & tracking' }).click();

	// The panel's content only renders once the family settings row is
	// loaded, so this doubles as the "settings store loaded" gate.
	await expect(page.getByRole('heading', { name: 'Categories by stage' })).toBeVisible();

	const select = page.locator('#digest-frequency');
	const current = await select.inputValue();
	const next = current === 'weekly' ? 'daily' : 'weekly';
	await select.selectOption(next);

	// The FamilyTrackingPanel → updateSettings → familySettingsStore round
	// trip: the API echoes the saved settings back, the store updates, the
	// select re-renders the saved value and the toast confirms.
	await expect(page.getByTestId('feedback-toast')).toContainText('Digest frequency updated.');
	await expect(select).toHaveValue(next);
});

test('dashboard and home render the family data without the setup empty states', async ({ page }) => {
	await page.goto('/dashboard');

	// The familyStore rehydrates on every page: the dashboard opens on the
	// first trackable member — the child, not the owner — and never on the
	// "set up your family" empty states.
	await expect(page.getByRole('button', { name: 'Switch person' })).toBeVisible();
	await expect(page.getByRole('heading', { name: `Today for ${CHILD_RENAMED}` })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();
	await expect(page.getByTestId('stock-glance')).toBeVisible();
	await expect(page.getByText("You haven't set up a family yet.")).toHaveCount(0);
	await expect(page.getByText('Your family has no members yet.')).toHaveCount(0);

	// The home module's placeholder page reads the same session context: the
	// "Homes" card only renders when the family has members.
	await page.goto('/home');
	// exact: the page also has a "Homes" section heading.
	await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Property Assets' })).toBeVisible();
});

test('sign out from the family page returns the onboarding empty state', async ({ page }) => {
	await page.goto('/family');
	await expect(page.getByRole('heading', { name: 'Family Overview' })).toBeVisible();

	// The header's account menu is the sign-out surface on every page.
	await page.getByRole('button', { name: ACCOUNT_INITIAL, exact: true }).click();
	await page.getByRole('button', { name: 'Sign Out' }).click();

	await page.waitForURL('**/login');
	await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

	// Signed out, the family page resets to its onboarding branch — the one
	// state where "Build your family" renders for this account model.
	await page.goto('/family');
	await expect(page.getByRole('heading', { name: 'Build your family' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
});
