// The family id has one authoritative source: the JWT every authenticated
// request carries. This is worth a test of its own because the tempting
// alternative — the `nido.familyId` localStorage key — is written by the family
// page alone, so it is empty on a fresh sign-in. Reading it there returned null
// and the timezone load silently did nothing, which showed up as appointments
// rendered on the device's clock rather than the family's. A silent no-op that
// only appears on some navigation paths is exactly what a test should pin down.
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Build an unsigned JWT carrying the claims the app reads. Signature ignored. */
function fakeJwt(payload: Record<string, unknown>): string {
	const b64url = (obj: unknown) =>
		Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
}

const store = new Map<string, string>();

beforeEach(() => {
	store.clear();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
	});
});

describe('currentFamilyId', () => {
	it('reads the family from the token', async () => {
		const { currentFamilyId } = await import('./api');
		store.set('token', fakeJwt({ userId: 7, familyId: 'fam-from-token', exp: 9999999999 }));
		expect(currentFamilyId()).toBe('fam-from-token');
	});

	it('does not fall back to the nido.familyId key', async () => {
		// The key is present but the token is not: this must be null, not the
		// stale key. Trusting it is the bug this guards.
		const { currentFamilyId } = await import('./api');
		store.set('nido.familyId', 'stale-key-family');
		expect(currentFamilyId()).toBeNull();
	});

	it('returns null without a token rather than throwing', async () => {
		const { currentFamilyId } = await import('./api');
		expect(currentFamilyId()).toBeNull();
	});

	it('returns null for a malformed token', async () => {
		const { currentFamilyId } = await import('./api');
		store.set('token', 'not-a-jwt');
		expect(currentFamilyId()).toBeNull();
	});
});
