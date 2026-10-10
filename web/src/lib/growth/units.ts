export type GrowthUnitSystem = 'metric' | 'imperial';

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 0.3937007874;

export function isImperial(unit: string | null | undefined): boolean {
	return unit === 'imperial';
}

export function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

export function kgToLb(kg: number): number { return kg * LB_PER_KG; }
export function lbToKg(lb: number): number { return lb / LB_PER_KG; }
export function cmToIn(cm: number): number { return cm * IN_PER_CM; }
export function inToCm(inch: number): number { return inch / IN_PER_CM; }

export function convertWeight(value: number, from: GrowthUnitSystem, to: GrowthUnitSystem): number {
	if (from === to) return value;
	return from === 'imperial' ? lbToKg(value) : kgToLb(value);
}

export function convertLength(value: number, from: GrowthUnitSystem, to: GrowthUnitSystem): number {
	if (from === to) return value;
	return from === 'imperial' ? inToCm(value) : cmToIn(value);
}

export function formatWeight(value: number, unit: string | null | undefined): string {
	return isImperial(unit)
		? `${round1(value)} lb (${round1(lbToKg(value))} kg)`
		: `${round1(value)} kg (${round1(kgToLb(value))} lb)`;
}

export function formatLength(value: number, unit: string | null | undefined): string {
	return isImperial(unit)
		? `${round1(value)} in (${round1(inToCm(value))} cm)`
		: `${round1(value)} cm (${round1(cmToIn(value))} in)`;
}

export function formatGrowthHeadline(growth: any): string | null {
	if (!growth) return null;
	if (growth.weight != null) return formatWeight(Number(growth.weight), growth.unit_system);
	if (growth.height != null) return formatLength(Number(growth.height), growth.unit_system);
	if (growth.head_circumference != null) return formatLength(Number(growth.head_circumference), growth.unit_system);
	return null;
}
