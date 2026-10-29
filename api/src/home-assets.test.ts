// src/home-assets.test.ts
//
// HOME module milestone 1 (issue #65): the home asset registry routes.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { ASSET_CATEGORY_IDS, isAssetCategory, shapeAsset } from './home-assets';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function register(email: string) {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email, password: 'StrongP4ss!', firstName: 'Home', lastName: 'Modules',
	});
	return reg.body.token as string;
}

const car = {
	name: 'The Mazda',
	category: 'vehicle',
	identity: { manufacturer: 'Mazda', model: 'CX-5', modelYear: 2019, serial: 'JM3KE0DY4KU4417' },
	acquiredAt: '2019-04-13',
	purchasePrice: 27_400_00,
	notes: 'VIN ends 4417',
};

describe('home-assets: the registry', () => {
	let token = '';
	let otherToken = '';
	let assetId = 0;

	beforeAll(async () => {
		token = await register('home-assets@example.com');
		otherToken = await register('home-assets-other@example.com');
	});

	it('rejects a category outside the vocabulary', async () => {
		const res = await call('POST', token, '/api/v1/home-assets', { ...car, category: 'cars' });
		expect(res.status).toBe(400);
	});

	it('registers a car with its identity quartet', async () => {
		const res = await call('POST', token, '/api/v1/home-assets', car);
		expect(res.status).toBe(201);
		const asset = res.body.asset;
		expect(asset.name).toBe('The Mazda');
		expect(asset.category).toBe('vehicle');
		expect(asset.identity.manufacturer).toBe('Mazda');
		expect(asset.identity.modelYear).toBe(2019);
		expect(asset.identity.serial).toBe('JM3KE0DY4KU4417');
		expect(asset.purchasePrice).toBe(27_400_00);
		expect(asset.archivedAt).toBeNull();
		assetId = asset.id;
	});

	it('serves the category vocabulary for pickers', async () => {
		const res = await call('GET', token, '/api/v1/home-assets/meta/categories');
		expect(res.status).toBe(200);
		expect(res.body.categories.map((c: any) => c.id)).toEqual([...ASSET_CATEGORY_IDS]);
	});

	it('lists and fetches the asset', async () => {
		const list = await call('GET', token, '/api/v1/home-assets');
		expect(list.body.assets).toHaveLength(1);
		const one = await call('GET', token, `/api/v1/home-assets/${assetId}`);
		expect(one.status).toBe(200);
		expect(one.body.asset.id).toBe(assetId);
	});

	it('edits without clobbering identity fields left unsent', async () => {
		const res = await call('PUT', token, `/api/v1/home-assets/${assetId}`, {
			notes: 'Winter tires live in the shed',
			identity: { model: 'CX-5 GT' },   // model only; manufacturer/year/serial unsent
		});
		expect(res.status).toBe(200);
		expect(res.body.asset.identity.model).toBe('CX-5 GT');
		expect(res.body.asset.identity.manufacturer).toBe('Mazda');
		expect(res.body.asset.identity.modelYear).toBe(2019);
		expect(res.body.asset.notes).toBe('Winter tires live in the shed');
	});

	it('archives out of the default list, and unarchives back', async () => {
		const archived = await call('POST', token, `/api/v1/home-assets/${assetId}/archive`);
		expect(archived.status).toBe(200);
		expect(archived.body.asset.archivedAt).toBeTruthy();

		const without = await call('GET', token, '/api/v1/home-assets');
		expect(without.body.assets).toHaveLength(0);
		const withArchived = await call('GET', token, '/api/v1/home-assets?includeArchived=true');
		expect(withArchived.body.assets).toHaveLength(1);           // history stays

		const back = await call('POST', token, `/api/v1/home-assets/${assetId}/unarchive`);
		expect(back.status).toBe(200);
		expect(back.body.asset.archivedAt).toBeNull();
	});

	it('does not leak across families', async () => {
		// A wrong-family id is a 404, not a 403, so an outsider cannot probe ids.
		const read = await call('GET', otherToken, `/api/v1/home-assets/${assetId}`);
		expect(read.status).toBe(404);
		const list = await call('GET', otherToken, '/api/v1/home-assets');
		expect(list.body.assets).toHaveLength(0);
		const write = await call('PUT', otherToken, `/api/v1/home-assets/${assetId}`, { name: 'Stolen' });
		expect(write.status).toBe(404);
	});

	it('scopes an asset to a home, and rejects a home that is not the family\'s', async () => {
		// The family's own home: seeded at registration (families route seeds
		// one per family), so read it back rather than assume an id.
		const fam = (jwt.decode(token) as any).familyId as string;
		const homes = await call('GET', token, `/api/v1/families/${fam}/homes`);
		expect(homes.status).toBeLessThan(400);
		const homeId = homes.body.homes?.[0]?.id;
		expect(homeId).toBeTruthy();

		// Family-wide by default (null), home-scoped when set.
		const res = await call('PUT', token, `/api/v1/home-assets/${assetId}`, { homeId });
		expect(res.status).toBe(200);
		expect(res.body.asset.homeId).toBe(Number(homeId));

		// The list filter answers "what lives at this home" (the /home card).
		const scoped = await call('GET', token, `/api/v1/home-assets?homeId=${homeId}`);
		expect(scoped.body.assets).toHaveLength(1);
		const other = await call('GET', token, `/api/v1/home-assets?homeId=${Number(homeId) + 999}`);
		expect(other.body.assets).toHaveLength(0);

		// Setting back to null is explicit ("ours"), not a data loss.
		const cleared = await call('PUT', token, `/api/v1/home-assets/${assetId}`, { homeId: null });
		expect(cleared.status).toBe(200);
		expect(cleared.body.asset.homeId).toBeNull();

		// A home id from another family is rejected, not silently stored.
		const otherFam = (jwt.decode(otherToken) as any).familyId as string;
		const otherHomes = await call('GET', otherToken, `/api/v1/families/${otherFam}/homes`);
		const otherHomeId = otherHomes.body.homes?.[0]?.id;
		if (otherHomeId && Number(otherHomeId) !== Number(homeId)) {
			const stolen = await call('POST', token, '/api/v1/home-assets', { name: 'Probe', category: 'other', homeId: Number(otherHomeId) });
			expect(stolen.status).toBe(404);
		}
	});

	it('requires auth', async () => {
		const res = await call('GET', '', '/api/v1/home-assets');
		expect(res.status).toBe(401);
	});
});

describe('home-assets: the domain module', () => {
	it('isAssetCategory accepts the vocabulary and nothing else', () => {
		for (const id of ASSET_CATEGORY_IDS) expect(isAssetCategory(id)).toBe(true);
		expect(isAssetCategory('cars')).toBe(false);
		expect(isAssetCategory(null)).toBe(false);
		expect(isAssetCategory('')).toBe(false);
	});

	it('shapeAsset reads a row back, and degrades an unknown category to other', () => {
		const shaped = shapeAsset({
			id: 3, household_id: 1, name: 'Furnace', category: 'hvac',
			manufacturer: 'Trane', model: 'XR95', model_year: null, serial: null,
			acquired_at: null, purchase_price: null, notes: null,
			archived_at: null, created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: null,
		});
		expect(shaped.category).toBe('hvac');
		expect(shaped.identity.modelYear).toBeNull();

		// A value that is not one of ours did not come from us; the API shape
		// stays honest rather than inventing a category.
		const legacy = shapeAsset({
			id: 4, household_id: 1, name: 'Weird', category: 'carburetor',
			manufacturer: null, model: null, model_year: null, serial: null,
			acquired_at: null, purchase_price: null, notes: null,
			archived_at: null, created_by: null, created_at: null, updated_at: null,
		});
		expect(legacy.category).toBe('other');
	});
});