// The timer-survives-the-phone e2e — issue #90.
//
// A caregiver starts a feed timer, the iPhone screen locks, and the PWA comes
// back with the timer at 0. The unit tests cover the storage rules; this walks
// the real page: start a timer, reload (the closest a browser gets to the
// suspend/restore cycle), and confirm the timer is still there, still running,
// and still on the same member. It also seeds a timer that has been running
// for five hours, which the old stale rule deleted on sight.
//
// It shares the serial browser session the other specs use, and signs out at
// the end so the next spec starts from the login page.

import { test, expect, testEmail } from './fixtures';

const FIRST_NAME = 'Timer';
const LAST_NAME = 'Lock';
const PASSWORD = 'e2e-pass-1234';
const CHILD = 'Pip';

test.describe.configure({ mode: 'serial' });

test('register for the timer suite', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('button', { name: 'Create an account' }).click();
	await page.fill('#reg-first', FIRST_NAME);
	await page.fill('#reg-last', LAST_NAME);
	await page.fill('#reg-email', testEmail());
	await page.fill('#reg-password', PASSWORD);
	await page.getByRole('button', { name: 'Register' }).click();
	await page.waitForURL('**/family');
});

test('timer: add a child to log against', async ({ page }) => {
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Members' }).click();
	await page.selectOption('#member-type-x', 'child');
	await page.selectOption('#member-stage-x', 'infant');
	await page.fill('#member-name-x', CHILD);
	await page.fill('#member-dob-x', '2026-06-01');
	await page.selectOption('#member-gender-x', 'female');
	await page.getByRole('button', { name: 'Add Family Member' }).click();
	await expect(page.locator('li').filter({ hasText: CHILD })).toBeVisible();
});

test('timer: a running feed timer survives a reload, on the same member', async ({ page }) => {
	await page.goto('/family');
	await page.getByRole('button', { name: 'Switch person' }).click();
	await page.getByRole('listbox').getByText(CHILD).click();
	await expect(page.getByRole('heading', { name: `Today for ${CHILD}` })).toBeVisible();

	// Start a breast feed timer.
	await page.getByRole('button', { name: 'Feeds', exact: true }).first().click();
	await page.getByRole('button', { name: 'BreastFeed' }).click();
	await page.getByTestId('timer-left').getByRole('button', { name: 'Start' }).click();
	await expect(page.getByTestId('timer-left')).toContainText('Pause');

	// Park the sheet: the timer keeps running behind it.
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByTestId('running-timers')).toContainText('Feeding');

	// The reload stands in for the PWA being suspended and restored.
	await page.reload();

	// The member selection is remembered, so the page opens on the child whose
	// timer this is — not on whoever happens to sort first.
	await expect(page.getByRole('heading', { name: `Today for ${CHILD}` })).toBeVisible();
	await expect(page.getByTestId('running-timers')).toContainText('Feeding');
	await expect(page.getByTestId('running-timers')).not.toContainText('paused');

	// And reopening Feeds resumes the same timer rather than the kind chooser.
	await page.getByTestId('running-timers').getByRole('button', { name: /Resume feeding timer/ }).click();
	await expect(page.getByTestId('timer-left')).toContainText('Pause');
});

test('timer: a timer running for hours is not discarded as stale', async ({ page }) => {
	await page.goto('/family');
	await expect(page.getByTestId('running-timers')).toContainText('Feeding');

	// Rewind the stored start to five hours ago — past the three-hour stale
	// limit that used to delete a running timer on sight.
	const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('nido.timer.feed.')) ?? null);
	expect(key).not.toBeNull();
	await page.evaluate((storageKey) => {
		const startedAt = Date.now() - 5 * 60 * 60 * 1000;
		localStorage.setItem(storageKey, JSON.stringify({
			leftElapsed: 0,
			rightElapsed: 0,
			leftStartedAt: startedAt,
			rightStartedAt: null,
			leftLastAt: startedAt,
			rightLastAt: null,
		}));
	}, key!);

	await page.reload();

	// Still listed, still running, and the elapsed time is the real five hours.
	await expect(page.getByTestId('running-timers')).toContainText('Feeding');
	await expect(page.getByTestId('running-timers')).toContainText('5h');
	await expect(page.getByTestId('running-timers')).not.toContainText('paused');
});

// Leave the shared session signed out for whichever spec runs next.
test('sign out after the timer suite', async ({ page }) => {
	await page.goto('/family');
	await page.getByRole('button', { name: FIRST_NAME[0], exact: true }).click();
	await page.getByRole('button', { name: 'Sign Out' }).click();
	await page.waitForURL('**/login');
});
