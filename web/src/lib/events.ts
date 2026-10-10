export const DATA_CHANGED = 'nido:data-changed';

export function announceDataChanged(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED));
}
