/**
 * Screen Wake Lock, shared by everything that keeps a timer running.
 *
 * iOS suspends — and sometimes reloads — a PWA once the screen locks. That is
 * what makes a running feed timer come back looking reset even though
 * localStorage still holds it. Holding a screen wake lock for the length of a
 * feed keeps the display, and the page, awake.
 *
 * Requests are counted, so the timer sheet and the "In progress" strip can
 * both hold the lock without fighting over it. The lock is released when the
 * last holder lets go, and re-requested on `visibilitychange` because browsers
 * drop it whenever the page is hidden. Nothing here throws: a browser without
 * the API, a denied request, or a background request all just leave the screen
 * on its normal timeout.
 */

/**
 * How long a timer may keep the screen awake.
 *
 * A feed or pump is minutes, so an hour covers every real session with room to
 * spare. Past that the timer is almost certainly forgotten, and holding the
 * display on would drain the battery for nothing — the timer itself is safe in
 * localStorage either way. Sleep sessions are excluded entirely: they run for
 * hours by design, and the phone must be allowed to sleep.
 */
export const WAKE_LOCK_MAX_MS = 60 * 60 * 1000;

interface WakeLockSentinelLike {
	release(): Promise<void>;
	addEventListener?(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
	request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

const holders = new Set<object>();
let sentinel: WakeLockSentinelLike | null = null;
let pending = false;
let listening = false;

function wakeLockApi(): WakeLockLike | null {
	if (typeof navigator === 'undefined') return null;
	const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
	return api && typeof api.request === 'function' ? api : null;
}

/** The API rejects requests from a hidden document, so don't ask. */
function visible(): boolean {
	return typeof document === 'undefined' || document.visibilityState === 'visible';
}

async function acquire(): Promise<void> {
	if (sentinel || pending || holders.size === 0 || !visible()) return;
	const api = wakeLockApi();
	if (!api) return;
	pending = true;
	try {
		const lock = await api.request('screen');
		// The last holder may have let go while the request was in flight.
		if (holders.size === 0) {
			void lock.release().catch(() => {});
			return;
		}
		sentinel = lock;
		lock.addEventListener?.('release', () => {
			if (sentinel === lock) sentinel = null;
		});
	} catch {
		// Denied, unsupported in this context, or not from a user gesture.
	} finally {
		pending = false;
	}
}

function drop(): void {
	const lock = sentinel;
	sentinel = null;
	if (lock) void lock.release().catch(() => {});
}

function onVisibilityChange(): void {
	if (visible()) void acquire();
}

function listen(): void {
	if (listening || typeof document === 'undefined') return;
	listening = true;
	document.addEventListener('visibilitychange', onVisibilityChange);
}

/** Keep the screen awake until `releaseWakeLock(holder)` is called. */
export function holdWakeLock(holder: object): void {
	holders.add(holder);
	listen();
	void acquire();
}

/** Stop asking. The screen may sleep again once the last holder lets go. */
export function releaseWakeLock(holder: object): void {
	if (!holders.delete(holder)) return;
	if (holders.size === 0) drop();
}
