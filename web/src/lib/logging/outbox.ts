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
