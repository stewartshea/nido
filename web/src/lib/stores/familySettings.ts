// src/lib/stores/familySettings.ts — the family-scoped settings row.
//
// The settings page owns the rich shape (it reads and writes every field);
// family/dashboard/home used to carry narrow three-field copies of the type
// that drifted from this one. One rich type here is the single definition.
import { writable, get } from 'svelte/store';
import { familiesAPI } from '$lib/api/family';
import { applyTimezone } from '$lib/stores/timezoneStore';
import { familyStore } from '$lib/stores/family';

export interface FamilySettings {
	categories: string[] | null;
	categoryOptions: Record<string, Record<string, string[]>>;
	defaultCategoryOptions: Record<string, Record<string, string[]>>;
	stageCategories?: Record<string, string[]> | null;
	defaultStageCategories?: Record<string, string[]>;
	digestFrequency?: string;
	digestSentAt?: string | null;
	shareAnonymizedDaily?: boolean;
	appointmentNotifications?: boolean;
	appointmentNotificationsSentAt?: string | null;
	feedGroupingMinutes?: number;
	timezone?: string | null;
	digestSendHour?: number | null;
	appointmentSendHour?: number | null;
}

export const familySettingsStore = writable<FamilySettings | null>(null);

// The JSON preview under the anonymized-sharing toggle (settings' Family tab).
// Loaded from the same GET /settings response, so it lives with the settings.
export const anonymizedPreview = writable<any>(null);

/**
 * Load the active family's settings.
 *
 * `applyTimezone` preserves a real per-page variance: family, dashboard and
 * home apply the family's clock from this fetch so their times are right on
 * first paint rather than a tick later (the layout's own read lands later);
 * the settings page does not — there the layout owns the clock, and applying
 * the *active* family's zone here would diverge from it for multi-family
 * users (the layout reads the JWT family, this reads the selected one).
 */
export async function loadFamilySettings(options?: { applyTimezone?: boolean }): Promise<void> {
	const familyId = get(familyStore).activeFamilyId;
	if (!familyId) return;
	try {
		const res = await familiesAPI.getSettings(familyId);
		familySettingsStore.set(res.data.settings ?? null);
		anonymizedPreview.update((p) => res.data.anonymizedPreview ?? p);
		if (options?.applyTimezone) {
			// The family's clock, from the settings already fetched here, so the
			// times on this page are right on first paint rather than a tick later.
			const tz = res.data.settings?.timezone;
			if (typeof tz === 'string' && tz) applyTimezone(tz);
		}
		// Deliberately does NOT touch activeCategories. Those are the selected
		// member's own categories; the family-level list is a different thing
		// that used to overwrite them here.
	} catch (err: any) {
		console.error('Failed to load family settings:', err);
	}
}
