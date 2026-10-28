// src/lib/logging/outbox.ts — the offline queue: writes that might fail
// offline are parked here and replayed. Owns the whole lifecycle since the
// per-page copies were extracted (issue #57).
import { feedingAPI, sleepAPI } from '$lib/api/records';
import { notify } from '$lib/stores/feedback';

const KEY = 'nido.outbox';

export type OutboxKind = 'feeding' | 'sleep';

interface OutboxItem {
	kind: OutboxKind;
	payload: any;
	queuedAt: string;
}

export function enqueueRecord(kind: OutboxKind, payload: unknown): void {
	try {
		const outbox: OutboxItem[] = JSON.parse(localStorage.getItem(KEY) || '[]');
		outbox.push({ kind, payload, queuedAt: new Date().toISOString() });
		localStorage.setItem(KEY, JSON.stringify(outbox.slice(-200)));
	} catch { /* storage unavailable */ }
}

/** Replays queued records; returns how many reached the server. */
export async function flushOutbox(senders: Record<OutboxKind, (payload: any) => Promise<unknown>>): Promise<number> {
	let synced = 0;
	try {
		const outbox: OutboxItem[] = JSON.parse(localStorage.getItem(KEY) || '[]');
		if (outbox.length === 0) return 0;
		const remaining: OutboxItem[] = [];
		for (const item of outbox) {
			try {
				await senders[item.kind](item.payload);
				synced++;
			} catch {
				remaining.push(item);
			}
		}
		localStorage.setItem(KEY, JSON.stringify(remaining));
	} catch { /* storage unavailable */ }
	return synced;
}

/** The one sender map: every page replays feeding and sleep records. */
const SENDERS: Record<OutboxKind, (payload: any) => Promise<unknown>> = {
	feeding: (payload) => feedingAPI.create(payload),
	sleep: (payload) => sleepAPI.create(payload),
};

/** One flush of the queue; reports what synced and refreshes the page's lists. */
async function syncOutbox(onSynced: () => Promise<void> | void): Promise<void> {
	const synced = await flushOutbox(SENDERS);
	if (synced > 0) {
		notify(`${synced} offline record(s) synced.`);
		await onSynced();
	}
}

/**
 * The offline queue's lifecycle for a page: flush whatever queued while
 * offline once on start (awaited before the interval arms), then replay every
 * 60s. Returns the stop function for the page's onDestroy.
 */
export function startOutboxSync(onSynced: () => Promise<void> | void): () => void {
	if (typeof window === 'undefined') return () => { /* SSR: nothing to flush */ };
	let stopped = false;
	let timer: number | undefined;
	void (async () => {
		await syncOutbox(onSynced);
		if (stopped) return;
		timer = window.setInterval(() => { void syncOutbox(onSynced); }, 60_000);
	})();
	return () => {
		stopped = true;
		if (timer !== undefined) window.clearInterval(timer);
	};
}
