import { familiesAPI } from '$lib/api';
import { DEFAULT_CATEGORY_OPTIONS } from '$lib/shared';

export type CategoryOptions = Record<string, Record<string, string[]>>;

export interface LoggingOptions {
	get(category: string, key: string): string[];
}

/**
 * Per-family option lists (diaper colours, routine categories, ...). A family
 * can customise them; when it has not, the shared defaults apply, so a
 * category picked in the UI is always one of a known set.
 */
export async function loadLoggingOptions(familyId: string | null): Promise<LoggingOptions> {
	let custom: CategoryOptions = {};
	let defaults: CategoryOptions = DEFAULT_CATEGORY_OPTIONS;
	if (familyId) {
		try {
			const res = await familiesAPI.getSettings(familyId);
			custom = res.data.settings?.categoryOptions ?? {};
			defaults = res.data.settings?.defaultCategoryOptions ?? DEFAULT_CATEGORY_OPTIONS;
		} catch { /* fall back to the shared defaults */ }
	}
	return {
		get(category, key) {
			const merged = custom?.[category]?.[key] ?? defaults?.[category]?.[key] ?? [];
			return Array.isArray(merged) ? merged : [];
		},
	};
}
