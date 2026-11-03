import { describe, it, expect } from 'vitest';
import { categoryColorVar, CATEGORY_COLOR_VARS } from './categoryColors';

describe('categoryColorVar', () => {
	const cats = [{ category: 'diapers' }, { category: 'formula' }, { category: 'vitamins' }];

	it('assigns a color by a category\'s position in the report', () => {
		expect(categoryColorVar(cats, 'diapers')).toBe(CATEGORY_COLOR_VARS[0]);
		expect(categoryColorVar(cats, 'formula')).toBe(CATEGORY_COLOR_VARS[1]);
		expect(categoryColorVar(cats, 'vitamins')).toBe(CATEGORY_COLOR_VARS[2]);
	});

	it('cycles the palette when there are more categories than colors', () => {
		const many = Array.from({ length: CATEGORY_COLOR_VARS.length + 1 }, (_, i) => ({ category: `c${i}` }));
		expect(categoryColorVar(many, `c${CATEGORY_COLOR_VARS.length}`)).toBe(CATEGORY_COLOR_VARS[0]);
	});

	it('falls back to the first color for a category not in the list', () => {
		expect(categoryColorVar(cats, 'missing')).toBe(CATEGORY_COLOR_VARS[0]);
	});
});
