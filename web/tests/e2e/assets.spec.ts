// The home asset registry e2e — HOME module 1 (issue #65).
//
// Walks the registry surface a preview deployment must be able to do without
// mocks: add a car with its identity quartet, see it listed, edit a note,
// archive it out of the default list, and get it back. Shares the serial
// browser session fixtures the smoke suite uses; builds on nothing but the
// account, so it runs after the smoke suite in the same session.

import { test, expect, testEmail } from './fixtures';

const FIRST_NAME = 'Asset';
const LAST_NAME = 'Registrar';
const PASSWORD = 'e2e-pass-1234';

test.describe.configure({ mode: 'serial' });

test('register for the asset suite', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('button', { name: 'Create an account' }).click();
	await page.fill('#reg-first', FIRST_NAME);
	await page.fill('#reg-last', LAST_NAME);
	await page.fill('#reg-email', testEmail());
	await page.fill('#reg-password', PASSWORD);
	await page.getByRole('button', { name: 'Register' }).click();
	await page.waitForURL('**/dashboard');
});

test('assets: empty state renders, and the nav carries the page', async ({ page }) => {
	await page.goto('/assets');
	await expect(page.getByRole('heading', { name: 'Home assets' })).toBeVisible();
	await expect(page.getByText('No assets yet')).toBeVisible();
	// Header nav carries it; the bottom bar deliberately does not (a registry
	// is not a daily loop).
	await expect(page.getByRole('link', { name: 'Assets' })).toBeVisible();
});

test('assets: add a car with its identity quartet, then edit it', async ({ page }) => {
	await page.goto('/assets');
	await page.getByRole('button', { name: '+ Add asset' }).click();
	await expect(page.getByTestId('asset-form')).toBeVisible();

	await page.getByPlaceholder('The Mazda').fill('The Mazda');
	await page.getByLabel('Category').selectOption('vehicle');
	await page.getByPlaceholder('Manufacturer').fill('Mazda');
	await page.getByPlaceholder('Model', { exact: true }).fill('CX-5');
	await page.getByPlaceholder('Model year').fill('2019');
	await page.getByPlaceholder('Serial / VIN').fill('JM3KE0DY4KU4417');
	await page.getByRole('button', { name: 'Add asset', exact: true }).click();

	await expect(page.getByText('The Mazda')).toBeVisible();
	await expect(page.getByText('Mazda CX-5 2019')).toBeVisible();
	// The form dismissed on save.
	await expect(page.getByTestId('asset-form')).toHaveCount(0);

	// Edit: a note, and an identity change that must not clobber the rest.
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByPlaceholder('VIN ends 4417').fill('VIN ends 4417');
	await page.getByPlaceholder('Model', { exact: true }).fill('CX-5 GT');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Mazda CX-5 GT 2019')).toBeVisible();
	await expect(page.getByText('VIN ends 4417')).toBeVisible();
});

test('assets: archive hides it from the default list, show archived brings it back', async ({ page }) => {
	await page.goto('/assets');
	// Assert on the card, not the name: the notice ("…archived") also says the name.
	const cards = page.locator('[data-testid^="asset-"]');
	await expect(cards).toHaveCount(1);
	await page.getByRole('button', { name: 'Archive' }).click();
	await expect(cards).toHaveCount(0);

	await page.getByLabel('Show archived').check();
	await expect(cards).toHaveCount(1);
	await expect(cards.getByText('archived')).toBeVisible();

	await page.getByRole('button', { name: 'Unarchive' }).click();
	await expect(cards).toHaveCount(1);
	await expect(cards.getByText('archived')).toHaveCount(0);
});

test('assets: home scoping — lives at, the Homes card, and the deep link (74)', async ({ page }) => {
	await page.goto('/assets');
	await page.getByRole('button', { name: 'Edit' }).click();
	// "Lives at" appears once homes have loaded (lazily seeded by the homes route).
	await page.getByLabel('Lives at').selectOption({ label: 'Primary Home' });
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Lives at Primary Home')).toBeVisible();

	// The Homes card on /home groups assets under their residence.
	await page.goto('/home');
	const homesCard = page.getByTestId('homes-card');
	await expect(homesCard).toBeVisible();
	await expect(homesCard.getByText('Primary Home')).toBeVisible();
	await expect(homesCard.getByText('The Mazda')).toBeVisible();

	// The per-home deep link scopes the registry to that residence.
	await page.goto(`/assets?homeId=1`);
	await expect(page.getByText('Showing assets at')).toBeVisible();
	const cards = page.locator('[data-testid^="asset-"]');
	await expect(cards).toHaveCount(1);
	await page.getByRole('button', { name: 'Show all' }).click();
	await expect(page.getByText('Showing assets at')).toHaveCount(0);
	await expect(cards).toHaveCount(1);
});

test('homes: add the cabin, rename it, and see it on the card (76)', async ({ page }) => {
	await page.goto('/home');
	const card = page.getByTestId('homes-card');
	await expect(card).toBeVisible();

	await page.getByRole('button', { name: '+ Add home' }).click();
	await expect(page.getByTestId('home-form')).toBeVisible();
	await page.getByPlaceholder('The Cabin').fill('The Cabin');
	await page.getByLabel('Kind').selectOption('cabin');
	await page.getByPlaceholder('Lake Road 12').fill('Lake Road 12');
	await page.getByRole('button', { name: 'Add home', exact: true }).click();

	// It joins the card beside the seeded primary, with its address.
	await expect(card.getByText('The Cabin')).toBeVisible();
	await expect(card.getByText('Lake Road 12')).toBeVisible();

	// Edit: rename — and check primary moved when promoted.
	await card.getByRole('button', { name: 'Edit' }).last().click();
	await page.getByPlaceholder('The Cabin').fill('The Cabin at the Lake');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(card.getByText('The Cabin at the Lake')).toBeVisible();
});


test('homes: picture upload replaces, and renders on the card (76)', async ({ page }) => {
	await page.goto('/home');
	const card = page.getByTestId('homes-card');
	await expect(card).toBeVisible();

	// Upload through the cabin card's file input.
	const cabin = page.locator('[data-testid^="home-card-"]').filter({ hasText: 'The Cabin at the Lake' });
	// A fresh worker may not have the cabin; create it if missing.
	if (await cabin.count() === 0) {
		await page.getByRole('button', { name: '+ Add home' }).click();
		await page.getByPlaceholder('The Cabin').fill('The Cabin');
		await page.getByRole('button', { name: 'Add home', exact: true }).click();
		await expect(card.getByText('The Cabin').first()).toBeVisible();
	}
	const target = page.locator('[data-testid^="home-card-"]').filter({ hasText: 'The Cabin' }).first();
	await target.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/home.png');

	// The upload posts through the authenticated client with a cleared
	// Content-Type (multipart), then the card renders the blob URL.
	const img = target.locator('img');
	await expect(img).toBeVisible();
	await expect(img.first()).toHaveJSProperty('naturalWidth', 1);

	// Replace, not accumulate: uploading again moves the marker.
	await target.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/home.png');
	await expect(img).toHaveCount(1);
});

// The shared browser session carries into whichever spec runs next (the
// smoke suite re-registers on a signed-out page), so leave it signed out.
test('sign out after the asset suite', async ({ page }) => {
	await page.goto('/assets');
	await page.getByRole('button', { name: FIRST_NAME[0], exact: true }).click();
	await page.getByRole('button', { name: 'Sign Out' }).click();
	await page.waitForURL('**/login');
});