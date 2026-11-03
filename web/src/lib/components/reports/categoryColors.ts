// categoryColors.ts — one place decides what color a category's line wears.
//
// The Reports page toggles a line per inventory category, and the chip beside
// the toggle has to match the line in the chart. Both read this, so the dot and
// the line can never drift. The values are the app's own theme variables (not
// hexes), so a palette switch repaints the chart instead of leaving a residue.
//
// Colors are assigned by a category's position in the report, not by the
// toggle order, so turning one line off never recolors the others.

export const CATEGORY_COLOR_VARS = [
	'--c-primary',
	'--c-accent',
	'--c-ok-text',
	'--c-danger-text',
	'--c-ink-soft',
	'--c-line',
] as const;

/** The theme variable for a category, stable across toggles. */
export function categoryColorVar(categories: Array<{ category: string }>, category: string): string {
	const index = categories.findIndex((c) => c.category === category);
	return CATEGORY_COLOR_VARS[(index < 0 ? 0 : index) % CATEGORY_COLOR_VARS.length]!;
}
