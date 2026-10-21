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

// ---------------------------------------------------------------------------
// The family's wall clock
// ---------------------------------------------------------------------------
//
// Every timestamp in the database is an absolute instant in UTC. Which clock
// those instants are *read* on is the family's choice, and it is a real choice:
// "Thursday 9:30" is a wall-clock promise that a server zone (or a laptop that
// travelled) would show as a different hour, or a different day altogether.
//
// The zone is a module-level value rather than a parameter on every call,
// because it is one answer for the whole app and threading it through every
// call site would make it possible to forget in exactly the view that matters.
// The settings page sets it once (and App.svelte seeds it on load); everything
// below reads it. Passing `undefined` means "the device's own zone", which is
// the honest answer before a preference has been chosen.

let activeTimeZone: string | undefined;

/** Point the formatters at a zone. Pass undefined for the device's own. */
export function setActiveTimeZone(zone: string | null | undefined): void {
	activeTimeZone = zone || undefined;
}

export function getActiveTimeZone(): string | undefined {
	return activeTimeZone;
}

/**
 * The zone to *offer* when nobody has chosen one: the device's own.
 *
 * Reading the browser's zone is the only guess that is usually right, and it is
 * only a guess offered in the picker — never written to the database behind the
 * family's back.
 */
export function detectTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/** Every IANA zone this runtime knows, for the picker. */
export function listTimeZones(): string[] {
	try {
		const zones = (Intl as any).supportedValuesOf?.('timeZone');
		if (Array.isArray(zones) && zones.length) {
			// `supportedValuesOf('timeZone')` deliberately leaves UTC out — it
			// lists canonical *regions*, and UTC is not one. But UTC is a real
			// answer (and the server's default), so it is offered explicitly
			// rather than being a zone a family can see in their data and not
			// pick in the list.
			return ['UTC', ...(zones as string[]).filter((z) => z !== 'UTC')];
		}
	} catch {
		// Older runtimes: fall through to the short list below.
	}
	return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney'];
}

/**
 * The Intl formatting options with the family's zone folded in.
 *
 * Exported because two views (the appointments page, the picker preview) build
 * their own options objects and still have to agree on the zone.
 */
export function zonedOptions(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
	return activeTimeZone ? { ...options, timeZone: activeTimeZone } : options;
}

/**
 * The calendar day a moment falls on, *in the family's zone*.
 *
 * `2026-10-05` rather than a Date, because the caller is almost always putting
 * it in a Map key or comparing it with another day. `toDateString()` — what the
 * appointments page used to use — reads the device's zone instead, which is how
 * a 9:30pm appointment in Auckland shows up under the wrong heading for a
 * family reading from London.
 */
export function zonedDayKey(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-CA', zonedOptions({ year: 'numeric', month: '2-digit', day: '2-digit' })).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The same day key for "the moment it is now". */
export function todayKey(nowMs: number = Date.now()): string {
	return zonedDayKey(new Date(nowMs).toISOString());
}

/** A day key nudged by whole days, for "Today" and "Tomorrow" headings. */
export function dayKeyOffset(key: string, days: number): string {
	if (!key) return '';
	const d = new Date(`${key}T12:00:00Z`);
	if (!Number.isFinite(d.getTime())) return '';
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** A day key as a browser-local Date at noon, safe to hand to `toLocale*`. */
export function dayKeyToDate(key: string): Date {
	return new Date(`${key}T12:00:00`);
}

export function formatTime(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return d.toLocaleString(undefined, zonedOptions({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
}

/**
 * Value for an <input type="datetime-local"> at the given moment, on the
 * family's clock.
 *
 * The input element has no timezone concept of its own — it speaks the device's
 * local time — so an appointment edited on a device in another zone would
 * otherwise be shown and saved at the wrong hour. This reads and writes the
 * wall clock of the chosen zone and converts the *instant* across, which keeps
 * "9:30am" meaning 9:30am in the family's day.
 */
export function toLocalInput(date: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', zonedOptions({
		year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
	})).formatToParts(date);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

export function localInputToIso(value: string): string {
	if (!value) return new Date().toISOString();
	// A wall-clock string is only half an instant; the zone is the other half.
	// With no chosen zone the device's own reading is the current behaviour and
	// is kept exactly, rather than reconstructing it through UTC by hand.
	if (!activeTimeZone) return new Date(value).toISOString();
	const t = zonedInputToMs(value);
	return t === null ? new Date(value).toISOString() : new Date(t).toISOString();
}

/**
 * The instant named by a wall-clock string in the active zone.
 *
 * A zone's offset depends on the instant being named, and the instant is what
 * we are looking for, so this walks: read the moment as if it were UTC, ask the
 * zone what offset it had then, subtract it, and repeat once. A single pass is
 * enough outside a DST fold, and the second pass settles the fold.
 */
function zonedInputToMs(value: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
	if (!m) return null;
	const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
	let t = guess;
	for (let i = 0; i < 2; i += 1) {
		const offset = offsetMsAt(t);
		if (offset === null) return null;
		t = guess - offset;
	}
	return t;
}

/** The zone's offset from UTC at a given instant, in milliseconds. */
function offsetMsAt(ms: number): number | null {
	try {
		const dtf = new Intl.DateTimeFormat('en-US', zonedOptions({
			year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
		}));
		const parts = dtf.formatToParts(new Date(ms));
		const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
		const hour = get('hour') % 24;
		const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
		if (!Number.isFinite(asUtc)) return null;
		return asUtc - ms;
	} catch {
		return null;
	}
}


/**
 * Human "since" phrasing for a past moment.
 *
 * Deliberately coarse: this answers "how stale is this?", not "exactly when".
 * Anything under a minute reads as "just now" rather than "0 minutes ago", and
 * anything over a week falls back to a date so the number stays short.
 *
 * "Yesterday" is a calendar word, so it is decided on the family's clock: a
 * feed 24 hours ago can still be *today* (someone logging at 8am about a 9am
 * feed yesterday), and calling it "yesterday" would be wrong in the one case a
 * tired parent is trying to remember. Under a week it counts whole elapsed days,
 * which is the honest and readable answer.
 */
export function formatRelative(iso: string | null | undefined, nowMs: number = Date.now()): string {
	if (!iso) return '—';
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '—';
	const mins = Math.floor((nowMs - t) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	// Keep the leftover minutes. Flooring them made a feed 78 minutes old read as
	// "1 hour ago", and one 119 minutes old read as "1 hour ago" too — a gap of
	// nearly two hours reported as one, which is exactly when someone is deciding
	// whether a feed is due. Rounding to the nearest hour would not help: 78
	// minutes still lands on "1 hour".
	if (hours < 24) {
		const rem = mins % 60;
		if (rem > 0) return `${hours} hr ${rem} min ago`;
		return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	}
	const days = Math.floor(hours / 24);
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	return formatTime(iso);
}

/**
 * Human "time until" phrasing for a moment that has not happened yet.
 *
 * `formatRelative` answers "how long since", so a future date falls through its
 * first branch and reads as "just now" — which is exactly wrong for a booked
 * appointment. This is the mirror image, and it is deliberately coarse for the
 * same reason: a tile is answering "how soon", not "the exact instant". Past a
 * week it counts weeks rather than falling back to a date, because "in 3 weeks"
 * is the useful shape of a far-off appointment.
 *
 * Above a day the phrases switch from elapsed hours to the family's calendar,
 * so a 9:30am appointment tomorrow reads "tomorrow" all evening rather than
 * flipping to "in X hours" once it is more than 24 away.
 */
export function formatUpcoming(iso: string | null | undefined, nowMs: number = Date.now()): string {
	if (!iso) return '—';
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '—';
	const diff = t - nowMs;
	// Due, or already past: the caller should be using formatRelative for those,
	// but reading "now" beats reading a negative "in -3 days".
	if (diff < 60_000) return 'now';
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `in ${mins} min`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;

	// Past a day, the calendar is the better judge: how many *days* away, by the
	// family's own midnight, rather than how many 24-hour blocks away.
	const days = calendarDaysBetween(nowMs, t);
	if (days <= 0) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
	if (days === 1) return 'tomorrow';
	if (days < 7) return `in ${days} days`;
	const weeks = Math.floor(days / 7);
	return `in ${weeks} week${weeks === 1 ? '' : 's'}`;
}

/** Whole calendar days from one moment to another, on the family's clock. */
export function calendarDaysBetween(fromMs: number, toMs: number): number {
	const from = zonedDayKey(new Date(fromMs).toISOString());
	const to = zonedDayKey(new Date(toMs).toISOString());
	if (!from || !to) return Math.floor((toMs - fromMs) / 86_400_000);
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface AgeParts {
	value: string;
	unit: string;
}

/** Mean Gregorian month. Months are irregular, so there is no exact answer. */
const DAYS_PER_MONTH = 30.4375;

/**
 * A child's age in the unit that stays readable as they grow.
 *
 * Weeks stop being useful fast — nobody says a two-year-old is 108 weeks old —
 * but months stop being useful too, and "27 months" is a puzzle for a parent at
 * a playground. So: weeks while that reads naturally, months up to two years,
 * then years with the leftover months.
 */
export function formatAge(birthDate: string | null | undefined, nowMs: number = Date.now()): AgeParts | null {
	if (!birthDate) return null;
	const born = new Date(birthDate).getTime();
	if (!Number.isFinite(born)) return null;
	const days = Math.floor((nowMs - born) / 86_400_000);
	if (days < 0) return null;

	const months = Math.floor(days / DAYS_PER_MONTH);
	if (months < 3) {
		const weeks = Math.floor(days / 7);
		return { value: String(weeks), unit: weeks === 1 ? 'week' : 'weeks' };
	}
	if (months < 24) {
		return { value: String(months), unit: months === 1 ? 'month' : 'months' };
	}
	const years = Math.floor(months / 12);
	const rest = months % 12;
	if (rest === 0) return { value: String(years), unit: years === 1 ? 'year' : 'years' };
	return { value: `${years}y ${rest}m`, unit: '' };
}
