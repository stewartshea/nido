// The HOME care loop e2e — meters (#66), schedules (#67), maintenance (#68).
//
// The flow is the one a family actually walks: add a car, give it an odometer,
// add the oil change the manual asks for, log the last one (backdated, so it
// is overdue), see it on the dashboard, then log it today and watch it clear.
//
// It shares the serial browser session the other specs use, and signs out at
// the end so the next spec starts from the login page.

import { test, expect, testEmail } from './fixtures';

const FIRST_NAME = 'Care';
const LAST_NAME = 'Loop';
const PASSWORD = 'e2e-pass-1234';

test.describe.configure({ mode: 'serial' });

const day = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * day).toISOString().slice(0, 10);
const monthDay = (days: number) => isoDaysAgo(days).slice(5);

test('register for the care suite', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('button', { name: 'Create an account' }).click();
	await page.fill('#reg-first', FIRST_NAME);
	await page.fill('#reg-last', LAST_NAME);
	await page.fill('#reg-email', testEmail());
	await page.fill('#reg-password', PASSWORD);
	await page.getByRole('button', { name: 'Register' }).click();
	await page.waitForURL('**/dashboard');
});

test('care: add an asset and open its care page', async ({ page }) => {
	await page.goto('/assets');
	await page.getByRole('button', { name: '+ Add asset' }).click();
	await page.getByPlaceholder('The Mazda').fill('The Mazda');
	await page.getByRole('button', { name: 'Add asset', exact: true }).click();

	await page.getByRole('link', { name: 'Care & history' }).first().click();
	await expect(page.getByTestId('asset-detail')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Mazda' })).toBeVisible();
	await expect(page.getByTestId('asset-meters')).toBeVisible();
	await expect(page.getByTestId('asset-schedules')).toBeVisible();
	await expect(page.getByTestId('asset-history')).toBeVisible();
});

test('care: add an odometer and a reading', async ({ page }) => {
	// The shared page is still on the asset from the previous test.
	await page.getByRole('button', { name: '+ Add a meter' }).click();
	await page.getByRole('button', { name: 'Add meter', exact: true }).click();

	await page.getByRole('button', { name: 'Add reading' }).click();
	await page.getByLabel('Reading (km)').fill('80000');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Last read')).toContainText('80,000');
});

test('care: add a schedule, backdate the last oil change, and see it overdue', async ({ page }) => {
	await page.getByRole('button', { name: '+ Add schedule' }).click();
	await expect(page.getByTestId('schedule-form')).toBeVisible();
	await page.getByLabel('Task', { exact: true }).fill('Oil change');
	// The asset has a meter, so the form opens on a meter trigger; this one is
	// the calendar kind.
	await page.getByTestId('trigger-kind-0').selectOption('interval');
	await page.getByLabel('Every', { exact: true }).fill('6');
	await page.getByRole('button', { name: 'Add schedule', exact: true }).click();

	const schedule = page.locator('[data-testid^="schedule-"]').filter({ hasText: 'Oil change' }).first();
	await expect(schedule).toBeVisible();
	// Created today, so six months out: nothing is due yet.
	await expect(schedule.getByText('OK', { exact: true })).toBeVisible();

	// Log the last oil change 400 days ago — the schedule is now overdue.
	await schedule.getByRole('button', { name: 'Log it' }).click();
	await expect(page.getByTestId('maintenance-form')).toBeVisible();
	await page.getByLabel('Date').fill(isoDaysAgo(400));
	await page.getByLabel('Cost ($, optional)').fill('89');
	await page.getByRole('button', { name: 'Save entry' }).click();

	await expect(page.getByTestId('asset-due')).toBeVisible();
	await expect(page.getByTestId('asset-due')).toContainText('Oil change');
	await expect(schedule.getByText('Overdue', { exact: true })).toBeVisible();
	// The cost rolls up from the entry.
	await expect(page.getByTestId('asset-history')).toContainText('$89.00');
});

test('care: the dashboard lists what is due, and logging it today clears it', async ({ page }) => {
	await page.goto('/home');
	const due = page.getByTestId('due-card');
	await expect(due).toBeVisible();
	await expect(due).toContainText('Oil change');
	await expect(due).toContainText('The Mazda');

	await due.getByRole('link', { name: /Overdue/ }).first().click();
	await expect(page.getByTestId('asset-detail')).toBeVisible();

	const schedule = page.locator('[data-testid^="schedule-"]').filter({ hasText: 'Oil change' }).first();
	await schedule.getByRole('button', { name: 'Log it' }).click();
	await page.getByRole('button', { name: 'Save entry' }).click();

	// Six months from today: out of the lead window, so the card clears.
	await expect(schedule.getByText('OK', { exact: true })).toBeVisible();
	await expect(page.getByTestId('asset-due')).toHaveCount(0);
});

test('care: a seasonal checklist checks off from a logged entry', async ({ page }) => {
	await page.getByRole('button', { name: '+ Add schedule' }).click();
	await page.getByLabel('Task', { exact: true }).fill('Swap to winter tires');
	await page.getByTestId('trigger-kind-0').selectOption('seasonal');
	await page.getByLabel('From (MM-DD)').fill(monthDay(5));
	await page.getByLabel('Until (MM-DD)').fill(monthDay(-5));
	await page.getByRole('button', { name: 'Add schedule', exact: true }).click();

	const season = page.getByTestId('asset-season');
	await expect(season).toBeVisible();
	await expect(season).toContainText('Swap to winter tires');
	await expect(season).toContainText('Open');

	await season.getByRole('button', { name: 'Mark done' }).click();
	await page.getByRole('button', { name: 'Save entry' }).click();

	await expect(season).toContainText('Done');
});

test('care: an item used from stock is deducted through the entry', async ({ page }) => {
	// Seed the stock through the API — the inventory UI has its own coverage,
	// and the journey under test is this form's picker plus the deduction.
	await page.evaluate(async () => {
		const token = localStorage.getItem('token');
		await fetch('/api/v1/inventory', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ name: 'Furnace filter', category: 'household', quantity: 3, unit: 'each' }),
		});
	});
	await page.reload();

	await page.getByRole('button', { name: '+ Log maintenance' }).click();
	await page.getByLabel('What was done').fill('Changed the furnace filter');
	await page.getByRole('button', { name: '+ Add an item' }).click();
	await page.getByLabel('How many').fill('1');
	await page.getByRole('button', { name: 'Save entry' }).click();

	await expect(page.getByTestId('asset-history')).toContainText('Used 1 each Furnace filter');

	const remaining = await page.evaluate(async () => {
		const token = localStorage.getItem('token');
		const res = await fetch('/api/v1/inventory', { headers: { Authorization: `Bearer ${token}` } });
		const body = await res.json();
		return body.items.find((item: any) => item.name === 'Furnace filter')?.quantity;
	});
	expect(remaining).toBe(2);
});

test('care: a photo for the asset and a receipt on the job', async ({ page }) => {
	await page.goto('/assets');
	await page.getByRole('link', { name: 'Care & history' }).first().click();
	const detail = page.getByTestId('asset-detail');
	await expect(detail).toBeVisible();

	// The asset's own photo: uploaded through the authenticated client, then
	// rendered from a blob URL (a plain <img src> would send no token).
	await detail.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/home.png');
	const cover = detail.locator('img').first();
	await expect(cover).toBeVisible();
	await expect(cover).toHaveJSProperty('naturalWidth', 1);

	// A receipt/photo on the newest maintenance entry.
	const entry = page.getByTestId('asset-history').locator('[data-testid^="entry-"]').first();
	await expect(entry).toBeVisible();
	await entry.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/home.png');
	await expect(entry.locator('img')).toHaveCount(1);
	await expect(entry.locator('img')).toBeVisible();

	// And the same file can be handed over while logging the job, not only
	// after: the form uploads it to the entry the save creates.
	await page.getByRole('button', { name: '+ Log maintenance' }).click();
	const form = page.getByTestId('maintenance-form');
	await expect(form).toBeVisible();
	await page.getByLabel('What was done').fill('New wiper blades');
	await form.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/home.png');
	await page.getByRole('button', { name: 'Save entry' }).click();

	const newest = page.getByTestId('asset-history').locator('[data-testid^="entry-"]').first();
	await expect(newest).toContainText('New wiper blades');
	await expect(newest.locator('img')).toHaveCount(1);
});

// Leave the shared session signed out for whichever spec runs next.
test('sign out after the care suite', async ({ page }) => {
	await page.goto('/home');
	await page.getByRole('button', { name: FIRST_NAME[0], exact: true }).click();
	await page.getByRole('button', { name: 'Sign Out' }).click();
	await page.waitForURL('**/login');
});
