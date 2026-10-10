import { writable } from 'svelte/store';
import { notificationsAPI } from '$lib/api';
import { DATA_CHANGED } from '$lib/events';

/**
 * How many notifications are firing, shown as a badge on the Notifications tab.
 *
 * Kept in a store rather than fetched per page so the count is one request for
 * the whole app shell, and refreshed on navigation and on a timer so a rule that
 * starts firing while someone is elsewhere still surfaces.
 */
export const notificationCount = writable(0);

let timer: ReturnType<typeof setInterval> | null = null;

export async function refreshNotificationCount(): Promise<void> {
	try {
		const res = await notificationsAPI.summary();
		notificationCount.set(Number(res.data?.total ?? 0));
	} catch {
		// A badge is not worth an error banner; keep the last known value.
	}
}

export function startNotificationCount(intervalMs = 60_000): void {
	if (timer) return;
	timer = setInterval(() => { void refreshNotificationCount(); }, intervalMs);
}

export function stopNotificationCount(): void {
	if (timer) { clearInterval(timer); timer = null; }
	notificationCount.set(0);
}

if (typeof window !== 'undefined') {
	window.addEventListener(DATA_CHANGED, () => { void refreshNotificationCount(); });
}
