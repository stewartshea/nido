import { describe, it, expect } from 'vitest';
import { parseNarababyCsv, parseCsvLines, mapDiaperType } from './import/narababy';

const SAMPLE_HEADER =
	'"Type","Profile Name","Start Date/time","Start Date/time (Epoch)","Created By Caregiver","Last Updated By Caregiver","Note","Time Zone","[Breastfeed] Begin Side","[Breastfeed] End Side","[Breastfeed] Left Duration (Seconds)","[Breastfeed] Right Duration (Seconds)","[Diaper] Type","[Diaper] Detail","[Diaper] Dirty Color","[Diaper] Dirty Texture","[Pump] Duration (Seconds)","[Pump] End Date/time","[Pump] End Date/time (Epoch)","[Pump] Left Volume","[Pump] Left Volume Unit","[Pump] Right Volume","[Pump] Right Volume Unit","[Pump] Total Volume","[Pump] Total Volume Unit","[Bottle Feed] Type","[Bottle Feed] Breast Milk Volume","[Bottle Feed] Breast Milk Volume Unit","[Bottle Feed] Formula Name","[Bottle Feed] Formula Volume","[Bottle Feed] Formula Volume Unit","[Bottle Feed] Volume","[Bottle Feed] Volume Unit","[Routine] Routine","[Growth] Head Size","[Growth] Head Size Unit","[Growth] Height","[Growth] Height Unit","[Growth] Weight","[Growth] Weight Unit","[Sleep] Duration (Seconds)","[Sleep] End Date/time","[Sleep] End Date/time (Epoch)","[Profile] Birth Date","[Profile] Birth Date (Adjusted)","[Profile] Sex","[Profile] Type","_familyKey","_profileKey","_activityKey"';

function row(fields: Record<string, string>): string {
	const order = SAMPLE_HEADER.replace(/"/g, '').split(',');
	const cells = order.map((c) => `"${(fields[c] ?? '').replace(/"/g, '""')}"`);
	return cells.join(',');
}

describe('parseCsvLines', () => {
	it('handles BOM and CRLF line endings', () => {
		const rows = parseCsvLines(`\uFEFF"a","b"\r\n"1","x, y"\r\n`);
		expect(rows).toEqual([
			['a', 'b'],
			['1', 'x, y'],
		]);
	});
});

describe('mapDiaperType', () => {
	it('maps Narababy types to Nido types', () => {
		expect(mapDiaperType('Wet')).toBe('wet');
		expect(mapDiaperType('Dirty')).toBe('dirty');
		expect(mapDiaperType('Dirty Wet')).toBe('both');
		expect(mapDiaperType('Dry')).toBe('dry');
	});
});

describe('parseNarababyCsv', () => {
	it('parses the profile row into a baby', () => {
		const csv = [
			SAMPLE_HEADER,
			row({ Type: 'Profile', 'Profile Name': 'Audrey', '[Profile] Sex': 'FEMALE', '[Profile] Birth Date': '2026-08-17', _profileKey: 'c-profile-1' }),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.baby?.name).toBe('Audrey');
		expect(parsed.baby?.gender).toBe('female');
		expect(parsed.baby?.birthDate).toBe('2026-08-17');
		expect(parsed.baby?.profileKey).toBe('c-profile-1');
	});

	it('parses a breastfeed row with summed L/R durations', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Breastfeed', 'Profile Name': 'Audrey',
				'Start Date/time (Epoch)': '1789822343000',
				'[Breastfeed] Begin Side': 'LEFT', '[Breastfeed] End Side': 'RIGHT',
				'[Breastfeed] Left Duration (Seconds)': '1028', '[Breastfeed] Right Duration (Seconds)': '675',
				_activityKey: 't-breast-1',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.feedings).toHaveLength(1);
		const f = parsed.feedings[0];
		expect(f.type).toBe('breast');
		expect(f.side).toBe('both');
		expect(f.durationSeconds).toBe(1028 + 675);
		// epoch 1789822343000 is authoritative (local 08:52 in America/Toronto = 12:52 UTC)
		expect(f.startTime).toBe('2026-09-19T12:52:23.000Z');
		expect(f.activityKey).toBe('t-breast-1');
	});

	it('parses a bottle feed with volume', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Bottle Feed', 'Profile Name': 'Audrey',
				'Start Date/time (Epoch)': '1789800000000',
				'[Bottle Feed] Type': 'Formula', '[Bottle Feed] Formula Name': 'Kendamil',
				'[Bottle Feed] Formula Volume': '3', '[Bottle Feed] Formula Volume Unit': 'FLOZ',
				'[Bottle Feed] Volume': '3', '[Bottle Feed] Volume Unit': 'FLOZ',
				_activityKey: 't-bottle-1',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.feedings).toHaveLength(1);
		const f = parsed.feedings[0];
		expect(f.type).toBe('formula');
		expect(f.amount).toBe(3);
	});

	it('parses a breast-milk bottle feed as type bottle', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Bottle Feed', 'Profile Name': 'Audrey',
				'Start Date/time (Epoch)': '1789800000000',
				'[Bottle Feed] Type': 'Breast Milk',
				'[Bottle Feed] Breast Milk Volume': '2', '[Bottle Feed] Breast Milk Volume Unit': 'FLOZ',
				_activityKey: 't-bottle-2',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.feedings[0].type).toBe('bottle');
		expect(parsed.feedings[0].amount).toBe(2);
	});

	it('parses a pump row with total volume and empty profile name', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Pump', 'Profile Name': '',
				'Start Date/time (Epoch)': '1789805223075',
				'[Pump] Total Volume': '1.5', '[Pump] Total Volume Unit': 'FLOZ',
				_activityKey: 't-pump-1', _profileKey: 'c-profile-1',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		// empty profile name on pump rows falls back to the baby found from profileKey
		expect(parsed.errors).toHaveLength(0);
		expect(parsed.feedings[0].type).toBe('pump');
		expect(parsed.feedings[0].amount).toBe(1.5);
	});

	it('maps diaper variants including Dirty Wet and color', () => {
		const csv = [
			SAMPLE_HEADER,
			row({ Type: 'Diaper', 'Profile Name': 'Audrey', 'Start Date/time (Epoch)': '1789814411000', '[Diaper] Type': 'Dirty Wet', '[Diaper] Dirty Color': 'BROWN YELLOW', _activityKey: 't-dip-1' }),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.diapers).toHaveLength(1);
		expect(parsed.diapers[0].type).toBe('both');
		expect(parsed.diapers[0].color).toBe('BROWN YELLOW');
	});

	it('parses sleep duration into start/end', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Sleep', 'Profile Name': 'Audrey',
				'Start Date/time (Epoch)': '1752842280000', '[Sleep] Duration (Seconds)': '60',
				_activityKey: 't-sleep-1',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.sleeps).toHaveLength(1);
		expect(parsed.sleeps[0].durationSeconds).toBe(60);
	});

	it('parses growth with mixed units per row', () => {
		const csv = [
			SAMPLE_HEADER,
			row({
				Type: 'Growth', 'Profile Name': 'Audrey', 'Start Date/time (Epoch)': '1752782400000',
				'[Growth] Weight': '4.309', '[Growth] Weight Unit': 'KG',
				'[Growth] Height': '21.06', '[Growth] Height Unit': 'IN',
				'[Growth] Head Size': '13.78', '[Growth] Head Size Unit': 'IN',
				_activityKey: 't-growth-1',
			}),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.growths).toHaveLength(1);
		const g = parsed.growths[0];
		expect(g.weight).toBe(4.309);
		expect(g.height).toBe(21.06);
		expect(g.headCircumference).toBe(13.78);
		expect(g.unitSystem).toBe('imperial'); // height in inches drives imperial
	});

	it('maps routine rows to milestones', () => {
		const csv = [
			SAMPLE_HEADER,
			row({ Type: 'Routine', 'Profile Name': 'Audrey', 'Start Date/time (Epoch)': '1789460000000', '[Routine] Routine': 'Bath', _activityKey: 't-rt-1' }),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.milestones).toHaveLength(1);
		expect(parsed.milestones[0].title).toBe('Bath');
	});

	it('fallback: derives ISO from local start string when epoch absent', () => {
		const csv = [
			SAMPLE_HEADER,
			row({ Type: 'Diaper', 'Profile Name': 'Audrey', 'Start Date/time': '2026-09-19 06:40:11', '[Diaper] Type': 'Wet', _activityKey: 't-dip-2' }),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.diapers[0].changeTime).toBeDefined();
	});

	it('records an error for a profile-less record with no resolvable baby and unknown type rows', () => {
		const csv = [
			SAMPLE_HEADER,
			row({ Type: 'SomeFutureType', 'Profile Name': 'X', 'Start Date/time (Epoch)': '1789800000000', _activityKey: 't-x-1' }),
		].join('\n');
		const parsed = parseNarababyCsv(csv);
		expect(parsed.notes.length + parsed.errors.length).toBeGreaterThan(0);
	});
});