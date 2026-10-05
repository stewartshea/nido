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

/**
 * Human "since" phrasing for a past moment.
 *
 * Deliberately coarse: this answers "how stale is this?", not "exactly when".
 * Anything under a minute reads as "just now" rather than "0 minutes ago", and
 * anything over a week falls back to a date so the number stays short.
 */
export function formatRelative(iso: string | null | undefined, nowMs: number = Date.now()): string {
	if (!iso) return '—';
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '—';
	const mins = Math.floor((nowMs - t) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	return formatTime(iso);
}
