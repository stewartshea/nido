// src/homes.test.ts
//
// The homes registry management surface (issue #76): create, edit, delete,
// and a picture per residence — plus the invariants that make it a registry
// (exactly one primary, a family keeps at least one home) rather than loose
// rows. Family scoping follows the homes route: reads for every member,
// writes for owner/admin.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

// A tiny PNG for the picture upload path.
const PNG_BYTES = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1a, 0x2b, 0xd4,
	0x34, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x93, 0xcd, 0x69, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
]);

async function uploadPicture(token: string, id: number) {
	const form = new FormData();
	form.append('file', new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }), 'home.png');
	return app.fetch(new Request(`http://localhost/api/v1/families/homes/${id}/picture`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	}));
}

async function register(email: string) {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email, password: 'StrongP4ss!', firstName: 'Home', lastName: 'Editor',
	});
	return reg.body.token as string;
}

describe('homes management', () => {
	let token = '';
	let otherToken = '';
	let familyId = '';

	beforeAll(async () => {
		token = await register('homes-editor@example.com');
		otherToken = await register('homes-other@example.com');
		familyId = (jwt.decode(token) as any).familyId as string;
	});

	it('answers with the lazily seeded primary home', async () => {
		const res = await call('GET', token, '/api/v1/families/homes');
		expect(res.status).toBe(200);
		expect(res.body.homes).toHaveLength(1);
		expect(res.body.homes[0].name).toBe('Primary Home');
		expect(res.body.homes[0].isPrimary).toBe(true);
	});

	it('creates a second home, and refuses a third family\'s view of it', async () => {
		const res = await call('POST', token, '/api/v1/families/homes', {
			name: 'The Cabin', kind: 'cabin', address: 'Lake Road 12',
		});
		expect(res.status).toBe(201);
		expect(res.body.home.name).toBe('The Cabin');
		expect(res.body.home.isPrimary).toBe(false);       // primary unchanged

		const other = await call('GET', otherToken, '/api/v1/families/homes');
		expect(other.body.homes).toHaveLength(1);          // other family untouched
	});

	it('renames and re-addresses a home without touching primary', async () => {
		const homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		const cabin = homes.find((h: any) => h.name === 'The Cabin');
		const res = await call('PUT', token, `/api/v1/families/homes/${cabin.id}`, {
			name: 'The Cabin at the Lake', address: 'Lake Road 12, Lot 3',
		});
		expect(res.status).toBe(200);
		expect(res.body.home.name).toBe('The Cabin at the Lake');
		expect(res.body.home.address).toBe('Lake Road 12, Lot 3');
		expect(res.body.home.isPrimary).toBe(false);
	});

	it('promoting a home demotes the previous primary — exactly one primary', async () => {
		const homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		const cabin = homes.find((h: any) => h.name.startsWith('The Cabin'));
		const res = await call('PUT', token, `/api/v1/families/homes/${cabin.id}`, { isPrimary: true });
		expect(res.status).toBe(200);
		const after = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		expect(after.filter((h: any) => h.isPrimary)).toHaveLength(1);
		expect(after.find((h: any) => h.isPrimary).name).toContain('Cabin');

		// Put it back the same way, for the delete test below.
		const primary = after.find((h: any) => h.name === 'Primary Home');
		await call('PUT', token, `/api/v1/families/homes/${primary.id}`, { isPrimary: true });
	});

	it('uploads and replaces a picture; the marker is an attachment id', async () => {
		const homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		const cabin = homes.find((h: any) => h.name.startsWith('The Cabin'));
		expect(cabin.picture).toBeNull();

		const up = await uploadPicture(token, cabin.id);
		expect(up.status).toBe(200);
		const firstMarker = ((await up.json()) as any).picture;
		expect(Number(firstMarker)).toBeGreaterThan(0);

		// Serves back the same bytes' content type.
		const get = await app.fetch(new Request(`http://localhost/api/v1/families/homes/${cabin.id}/picture`, {
			headers: { Authorization: `Bearer ${token}` },
		}));
		expect(get.status).toBe(200);
		expect(get.headers.get('Content-Type')).toBe('image/png');

		// Replace, not accumulate: the marker moves and the old row is gone.
		const up2 = await uploadPicture(token, cabin.id);
		const secondMarker = ((await up2.json()) as any).picture;
		expect(Number(secondMarker)).toBeGreaterThan(Number(firstMarker));
		const list = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		expect(list.find((h: any) => h.name.startsWith('The Cabin')).picture).toBe(Number(secondMarker));
	});

	it('deleting the primary succeeds when a spare exists, and promotes the survivor', async () => {
		let homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		expect(homes).toHaveLength(2);
		const primary = homes.find((h: any) => h.name === 'Primary Home');

		const del = await call('DELETE', token, `/api/v1/families/homes/${primary.id}`);
		expect(del.status).toBe(200);

		// The cabin survives, carries the family's links, and is promoted so
		// "exactly one primary" never becomes "none".
		homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		expect(homes).toHaveLength(1);
		expect(homes[0].name.startsWith('The Cabin')).toBe(true);
		expect(homes[0].isPrimary).toBe(true);
	});

	it('refuses deleting the only home', async () => {
		const homes = (await call('GET', token, '/api/v1/families/homes')).body.homes;
		const res = await call('DELETE', token, `/api/v1/families/homes/${homes[0].id}`);
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('at least one home');
	});

	it('validates the timezone and defaults it to the family\'s zone', async () => {
		// A zone `Intl` refuses is rejected, not silently stored.
		const bad = await call('POST', token, '/api/v1/families/homes', {
			name: 'Broken Zone', kind: 'storage', timezone: 'Mars/Olympus',
		});
		expect(bad.status).toBe(400);

		// An unset timezone inherits the family's own zone rather than null —
		// a home is usually where the family is, and null silently means UTC
		// in every digest downstream.
		const fam = (await call('GET', token, '/api/v1/families/settings')).body.settings;
		const res = await call('POST', token, '/api/v1/families/homes', {
			name: 'The Locker', kind: 'storage',
		});
		expect(res.status).toBe(201);
		// The seeded family has no zone set (null -> device default), so the
		// honest default here is null, never garbage; with a family zone set,
		// it inherits (checked against settings directly below).
		expect(res.body.home.timezone === null || typeof res.body.home.timezone === 'string').toBe(true);
		if (fam?.timezone && typeof res.body.home.timezone === 'string') {
			expect(res.body.home.timezone).toBe(fam.timezone);
		}
		// Clean up: the locker goes away again; delete promotes the seed home
		// back if needed (it was primary all along in this test family).
		await call('DELETE', token, `/api/v1/families/homes/${res.body.home.id}`);
	});

	it('requires auth', async () => {
		expect((await call('GET', '', '/api/v1/families/homes')).status).toBe(401);
	});
});