import { describe, it, expect } from 'vitest';
import { formatWeight, formatLength, formatGrowthHeadline, convertWeight, convertLength } from './units';

describe('growth units', () => {
	it('shows the stored unit first and the other in brackets', () => {
		expect(formatWeight(3.4, 'metric')).toBe('3.4 kg (7.5 lb)');
		expect(formatWeight(7.5, 'imperial')).toBe('7.5 lb (3.4 kg)');
		expect(formatLength(50, 'metric')).toBe('50 cm (19.7 in)');
		expect(formatLength(20, 'imperial')).toBe('20 in (50.8 cm)');
	});

	it('converts between systems', () => {
		expect(convertWeight(1, 'metric', 'imperial')).toBeCloseTo(2.2046, 3);
		expect(convertWeight(5, 'imperial', 'metric')).toBeCloseTo(2.268, 2);
		expect(convertLength(2.54, 'metric', 'imperial')).toBeCloseTo(1, 6);
		expect(convertLength(1, 'imperial', 'metric')).toBeCloseTo(2.54, 6);
	});

	it('picks the first measurement present for a summary headline', () => {
		expect(formatGrowthHeadline({ weight: 3.4, unit_system: 'metric' })).toBe('3.4 kg (7.5 lb)');
		expect(formatGrowthHeadline({ height: 50, unit_system: 'metric' })).toBe('50 cm (19.7 in)');
		expect(formatGrowthHeadline({})).toBeNull();
		expect(formatGrowthHeadline(null)).toBeNull();
	});
});
