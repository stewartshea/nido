import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeDocument {
	visibilityState: 'visible' | 'hidden';
	addEventListener: (type: string, listener: () => void) => void;
	removeEventListener: (type: string, listener: () => void) => void;
	setVisibility: (state: 'visible' | 'hidden') => void;
}

function fakeDocument(initial: 'visible' | 'hidden' = 'visible'): FakeDocument {
	const listeners = new Map<string, Set<() => void>>();
	const doc: FakeDocument = {
		visibilityState: initial,
		addEventListener: (type, listener) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		},
		removeEventListener: (type, listener) => {
			listeners.get(type)?.delete(listener);
		},
		setVisibility: (state) => {
			doc.visibilityState = state;
			listeners.get('visibilitychange')?.forEach((fn) => fn());
		},
	};
	return doc;
}

function fakeLock() {
	const listeners: (() => void)[] = [];
	return {
		release: vi.fn(async () => {}),
		addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
		emitRelease: () => listeners.forEach((fn) => fn()),
	};
}

/** The module keeps its holders in module scope, so each test gets a fresh copy. */
async function load() {
	vi.resetModules();
	return import('./wakeLock');
}

/** Let the async request settle (the spy fires before the promise resolves). */
function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('wakeLock', () => {
	it('holds one screen lock and releases it with the last holder', async () => {
		const lock = fakeLock();
		const request = vi.fn(async () => lock);
		vi.stubGlobal('navigator', { wakeLock: { request } });
		vi.stubGlobal('document', fakeDocument('visible'));
		const { holdWakeLock, releaseWakeLock } = await load();

		const first = {};
		const second = {};
		holdWakeLock(first);
		holdWakeLock(second);
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		await flush();
		expect(request).toHaveBeenCalledWith('screen');

		releaseWakeLock(first);
		expect(lock.release).not.toHaveBeenCalled();

		releaseWakeLock(second);
		expect(lock.release).toHaveBeenCalledTimes(1);
	});

	it('does nothing when the browser has no wake lock API', async () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('document', fakeDocument('visible'));
		const { holdWakeLock, releaseWakeLock } = await load();

		const holder = {};
		expect(() => holdWakeLock(holder)).not.toThrow();
		expect(() => releaseWakeLock(holder)).not.toThrow();
	});

	it('swallows a denied request and retries on the next hold', async () => {
		const lock = fakeLock();
		const request = vi.fn()
			.mockRejectedValueOnce(new Error('NotAllowedError'))
			.mockResolvedValueOnce(lock);
		vi.stubGlobal('navigator', { wakeLock: { request } });
		vi.stubGlobal('document', fakeDocument('visible'));
		const { holdWakeLock } = await load();

		const holder = {};
		holdWakeLock(holder);
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		await flush();

		holdWakeLock(holder);
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
	});

	it('waits for the page to be visible, then acquires on visibilitychange', async () => {
		const lock = fakeLock();
		const request = vi.fn(async () => lock);
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const doc = fakeDocument('hidden');
		vi.stubGlobal('document', doc);
		const { holdWakeLock } = await load();

		holdWakeLock({});
		expect(request).not.toHaveBeenCalled();

		doc.setVisibility('visible');
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
	});

	it('re-acquires after the browser drops the lock on hide', async () => {
		const first = fakeLock();
		const second = fakeLock();
		const request = vi.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		vi.stubGlobal('navigator', { wakeLock: { request } });
		const doc = fakeDocument('visible');
		vi.stubGlobal('document', doc);
		const { holdWakeLock } = await load();

		holdWakeLock({});
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		await flush();

		// Browsers release the lock themselves when the page is hidden.
		doc.setVisibility('hidden');
		first.emitRelease();
		doc.setVisibility('visible');
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
	});
});
