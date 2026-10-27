import { writable } from 'svelte/store';
import { setActiveTimeZone } from '$lib/logging/format';
import { currentFamilyId } from '$lib/api/client';
import { familiesAPI } from '$lib/api/family';

/**
 * The family's wall clock, as a Svelte store on top of the formatter's
 * module-level value.
 *
 * The formatters read a plain module variable (see logging/format.ts) because
 * they are called from everywhere and threading a zone through every call site
 * would guarantee a forgotten one. This store is the other half: it gives the
 * app something reactive to bind a picker to, and it writes through to the
 * formatters on every change so there is exactly one value in play.
 *
 * `null` means "not chosen yet", which the formatters read as the device's own
 * zone — the honest answer before anyone has said otherwise.
 */
export const timezoneStore = writable<string | null>(null);

let current: string | null = null;

/** Point the whole app at a zone. Reactivity first, formatters second. */
export function applyTimezone(zone: string | null | undefined): void {
	const next = zone || null;
	current = next;
	timezoneStore.set(next);
	setActiveTimeZone(next);
}

export function currentTimezone(): string | null {
	return current;
}

/**
 * Read the family's clock from its settings and apply it.
 *
 * One function for the layout and the few pages that render times before the
 * layout's read lands, so there is a single definition of "where does the zone
 * come from". A missing or failed answer leaves the device's zone in place,
 * which is a better guess than UTC for most families; a null in the database
 * means "not chosen yet" and is treated the same way.
 */
export async function loadFamilyTimezone(): Promise<void> {
	const familyId = currentFamilyId();
	if (!familyId) return;
	try {
		const res = await familiesAPI.getSettings(familyId);
		const tz = res.data?.settings?.timezone;
		if (typeof tz === 'string' && tz) applyTimezone(tz);
	} catch {
		/* the device's zone stands in */
	}
}
