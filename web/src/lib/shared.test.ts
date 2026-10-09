import { describe, it, expect } from 'vitest';
import { milestoneCategory, milestoneCategoryKey, isMilestoneKind, DEFAULT_CATEGORY_OPTIONS, reminderPhrase } from './shared';

describe('milestoneCategory', () => {
	it('uses the row kind, even when the category word is ambiguous', () => {
		expect(milestoneCategory({ kind: 'routines', category: 'other' })).toBe('routines');
		expect(milestoneCategory({ kind: 'milestones', category: 'other' })).toBe('milestones');
		expect(milestoneCategory({ kind: 'medical', category: 'bath' })).toBe('medical');
		expect(milestoneCategory({ kind: 'firsts', category: 'walk' })).toBe('firsts');
	});

	it('falls back to the category word for older rows with no kind', () => {
		expect(milestoneCategory({ category: 'firsts' })).toBe('firsts');
		expect(milestoneCategory({ category: 'bath' })).toBe('routines');
		expect(milestoneCategory({ category: 'tummy time' })).toBe('routines');
		expect(milestoneCategory({ category: 'medical' })).toBe('medical');
		expect(milestoneCategory({ category: 'anything custom' })).toBe('milestones');
		expect(milestoneCategory({})).toBe('milestones');
	});
});

describe('category vocabulary', () => {
	it('maps each kind to its option list key', () => {
		expect(milestoneCategoryKey('milestones')).toBe('category');
		expect(milestoneCategoryKey('medical')).toBe('visitType');
		expect(milestoneCategoryKey('routines')).toBe('type');
		expect(milestoneCategoryKey('firsts')).toBe('type');
	});

	it('every kind has a non-empty list of known categories', () => {
		for (const k of ['milestones', 'firsts', 'routines', 'medical'] as const) {
			expect(DEFAULT_CATEGORY_OPTIONS[k][milestoneCategoryKey(k)].length).toBeGreaterThan(0);
		}
	});
});

describe('reminderPhrase', () => {
	const conditions = [{ category: 'pumping' }, { category: 'feeds', values: ['breast'] }];

	it('joins with or by default', () => {
		expect(reminderPhrase(conditions)).toBe('pump or breast');
	});

	it('joins with and when the rule requires every condition', () => {
		expect(reminderPhrase(conditions, 'all')).toBe('pump and breast');
	});
});

describe('isMilestoneKind', () => {
	it('accepts the four kinds and nothing else', () => {
		expect(isMilestoneKind('routines')).toBe(true);
		expect(isMilestoneKind('firsts')).toBe(true);
		expect(isMilestoneKind('medical')).toBe(true);
		expect(isMilestoneKind('milestones')).toBe(true);
		expect(isMilestoneKind('feeding')).toBe(false);
	});
});
