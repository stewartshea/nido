export function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return `${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function formatMinutes(totalMs: number): string {
	const m = Math.round(totalMs / 60000);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatTime(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Value for an <input type="datetime-local"> at the given moment. */
export function toLocalInput(date: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function localInputToIso(value: string): string {
	return value ? new Date(value).toISOString() : new Date().toISOString();
}
