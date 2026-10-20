// timezone.ts
//
// The family's wall clock, in one place.
//
// Every timestamp Nido stores is an absolute instant in UTC. Nothing about the
// storage changes here: a timezone preference is a *display* concern, and it is
// answered wherever a moment is turned into words for a person. Appointments are
// the case that forces the question — "Thursday 9:30" is a wall-clock promise,
// and a server in UTC reading a family's 9:30am as 2:30pm is not a rounding
// error, it is a parent at the wrong door.
//
// The value is kept on family_settings rather than per user. A household shares
// one clock the way it shares one calendar, and members of the same family
// routinely open the same Nido from different devices (the phone in a coat
// pocket, the laptop at work) that may sit in different zones. One setting the
// family can agree on beats two accounts disagreeing about when a feed happened.

/** The fallback clock when a family has not chosen one. */
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * Whether a string is an IANA timezone name this runtime can actually use.
 *
 * Checked by construction rather than by a list: Node ships the full tz
 * database, and `Intl` rejects anything it does not know with a RangeError.
 * That keeps the answer true across tzdata updates, where a hard-coded list
 * would quietly go stale.
 */
export function isValidTimezone(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const name = value.trim();
	if (!name || name.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: name });
		return true;
	} catch {
		return false;
	}
}

/** A stored preference, or the default when it is missing or unusable. */
export function effectiveTimezone(stored: unknown): string {
	const value = typeof stored === 'string' ? stored.trim() : '';
	return isValidTimezone(value) ? value : DEFAULT_TIMEZONE;
}
