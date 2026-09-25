import { parseCsvLines, headerToMap, rowToRecord, CsvRow } from './csv';

export { parseCsvLines };
export type { CsvRow };

export interface ImportBaby {
	name: string;
	gender: string;
	birthDate: string;
	profileKey?: string;
}

export interface ImportFeeding {
	activityKey: string;
	type: 'breast' | 'bottle' | 'pump' | 'formula';
	startTime: string;
	durationSeconds?: number;
	amount?: number;
	side?: string;
	notes?: string;
}

export interface ImportDiaper {
	activityKey: string;
	changeTime: string;
	type: 'wet' | 'dirty' | 'both' | 'dry';
	color?: string;
	consistency?: string;
	notes?: string;
}

export interface ImportSleep {
	activityKey: string;
	startTime: string;
	durationSeconds: number;
	notes?: string;
}

export interface ImportGrowth {
	activityKey: string;
	measurementDate: string;
	weight?: number;
	height?: number;
	headCircumference?: number;
	unitSystem: 'imperial' | 'metric';
	notes?: string;
}

export interface ImportMilestone {
	activityKey: string;
	title: string;
	achievedDate: string;
	category: string;
}

export interface NarababyImport {
	baby: ImportBaby | null;
	feedings: ImportFeeding[];
	diapers: ImportDiaper[];
	sleeps: ImportSleep[];
	growths: ImportGrowth[];
	milestones: ImportMilestone[];
	notes: string[];
	errors: string[];
}

export function mapDiaperType(t: string): 'wet' | 'dirty' | 'both' | 'dry' {
	switch (t.trim()) {
		case 'Wet':
			return 'wet';
		case 'Dirty':
			return 'dirty';
		case 'Dirty Wet':
			return 'both';
		case 'Dry':
			return 'dry';
		default:
			return 'both';
	}
}

function mapGender(sex: string): string {
	return sex.trim().toLowerCase().startsWith('fem') ? 'female' : 'male';
}

function isoFromEpochOrLocal(epoch: string | undefined, local: string | undefined): string | undefined {
	if (epoch && /^\d+$/.test(epoch)) {
		return new Date(Number(epoch)).toISOString();
	}
	if (local && /^\d{4}-\d{2}-\d{2}/.test(local)) {
		// No timezone marker in local strings — interpret as UTC to keep ordering deterministic
		return new Date(local.replace(' ', 'T') + (local.includes('Z') ? '' : 'Z')).toISOString();
	}
	return undefined;
}

function toNumber(v: string | undefined): number | undefined {
	if (v === undefined || v.trim() === '') return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

export function parseNarababyCsv(text: string): NarababyImport {
	const lines = parseCsvLines(text);
	if (lines.length === 0) {
		return emptyResult(null, 'Empty file');
	}

	const header = lines[0];
	if (header === undefined) {
		return emptyResult(null, 'Empty file');
	}
	const index = headerToMap(header);
	const result: NarababyImport = {
		baby: null,
		feedings: [],
		diapers: [],
		sleeps: [],
		growths: [],
		milestones: [],
		notes: [],
		errors: [],
	};

	if (!index.has('Type')) {
		return emptyResult(null, 'Missing "Type" column — unexpected header');
	}

	// First pass: profile row decides the baby; profileKey may also appear on activity rows
	let profileKeyFromRow: string | undefined;
	for (const line of lines.slice(1)) {
		const r = rowToRecord(header, line);
		if (r['_profileKey']) profileKeyFromRow ??= r['_profileKey'];
		if (r['Type'] === 'Profile') {
			result.baby = {
				name: r['Profile Name']?.trim() || 'Baby',
				gender: mapGender(r['[Profile] Sex'] ?? ''),
				birthDate: (r['[Profile] Birth Date'] ?? '').slice(0, 10),
				profileKey: r['_profileKey'] || undefined,
			};
			break;
		}
	}

	if (!result.baby && profileKeyFromRow) {
		// Some exports lack an explicit Profile row — derive from the activity rows
		result.baby = { name: 'Baby', gender: 'female', birthDate: '', profileKey: profileKeyFromRow };
		result.notes.push('No Profile row — derived baby key from activity rows');
	}

	// Second pass: activities
	for (const line of lines.slice(1)) {
		const r = rowToRecord(header, line);
		const type = r['Type'] ?? '';
		const profileKey = r['_profileKey'] ?? '';
		const activityKey = r['_activityKey'] ?? '';
		const start = isoFromEpochOrLocal(r['Start Date/time (Epoch)'], r['Start Date/time']);
		if (!start) {
			result.notes.push(`Skipped ${type} row: no usable start time`);
			continue;
		}

		switch (type) {
			case 'Breastfeed': {
				const l = toNumber(r['[Breastfeed] Left Duration (Seconds)']) ?? 0;
				const rr = toNumber(r['[Breastfeed] Right Duration (Seconds)']) ?? 0;
				const totalSec = l + rr;
				const begin = (r['[Breastfeed] Begin Side'] ?? '').trim();
				const end = (r['[Breastfeed] End Side'] ?? '').trim();
				let side: string | undefined;
				if (begin && end && begin !== end) side = 'both';
				else if (begin) side = begin.toLowerCase();
				else if (end) side = end.toLowerCase();
				result.feedings.push({
					activityKey,
					type: 'breast',
					startTime: start,
					durationSeconds: totalSec > 0 ? totalSec : undefined,
					side,
					notes: r['Note']?.trim() || undefined,
				});
				break;
			}
			case 'Bottle Feed': {
				const total = r['[Bottle Feed] Volume'];
				const breastMilk = r['[Bottle Feed] Breast Milk Volume'];
				const formulaV = r['[Bottle Feed] Formula Volume'];
				const v = toNumber(total || breastMilk || formulaV);
				const bottleType = (r['[Bottle Feed] Type'] ?? '').trim();
				result.feedings.push({
					activityKey,
					type: bottleType === 'Breast Milk' ? 'bottle' : 'formula',
					startTime: start,
					amount: v,
					notes: [r['Note']?.trim(), r['[Bottle Feed] Formula Name']?.trim()].filter(Boolean).join(' · ') || undefined,
				});
				break;
			}
			case 'Pump': {
				const v = toNumber(r['[Pump] Total Volume'] ?? r['[Pump] Left Volume'] ?? r['[Pump] Right Volume']);
				const dur = toNumber(r['[Pump] Duration (Seconds)']);
				result.feedings.push({
					activityKey,
					type: 'pump',
					startTime: start,
					durationSeconds: dur,
					amount: v,
					notes: r['Note']?.trim() || undefined,
				});
				break;
			}
			case 'Diaper': {
				result.diapers.push({
					activityKey,
					changeTime: start,
					type: mapDiaperType(r['[Diaper] Type'] ?? ''),
					color: r['[Diaper] Dirty Color']?.trim() || undefined,
					consistency: r['[Diaper] Dirty Texture']?.trim() || r['[Diaper] Detail']?.trim() || undefined,
					notes: r['Note']?.trim() || undefined,
				});
				break;
			}
			case 'Sleep': {
				const dur = toNumber(r['[Sleep] Duration (Seconds)']);
				result.sleeps.push({
					activityKey,
					startTime: start,
					durationSeconds: dur ?? 0,
					notes: r['Note']?.trim() || undefined,
				});
				break;
			}
			case 'Growth': {
				const wUnit = (r['[Growth] Weight Unit'] ?? '').trim();
				const hUnit = (r['[Growth] Height Unit'] ?? '').trim();
				const unit = hUnit === 'IN' || wUnit === 'LB' ? 'imperial' : 'metric';
				result.growths.push({
					activityKey,
					measurementDate: start,
					weight: toNumber(r['[Growth] Weight']),
					height: toNumber(r['[Growth] Height']),
					headCircumference: toNumber(r['[Growth] Head Size']),
					unitSystem: unit,
					notes: r['Note']?.trim() || undefined,
				});
				break;
			}
			case 'Routine': {
				result.milestones.push({
					activityKey,
					title: r['[Routine] Routine']?.trim() || 'Routine',
					achievedDate: start,
					category: 'routine',
				});
				break;
			}
			case 'Profile':
				break;
			default:
				result.notes.push(`Skipped unknown row type: ${type}`);
		}
	}

	if (!result.baby) {
		result.errors.push('No Profile row found — cannot determine the baby');
	} else {
		result.notes.push(`Profile: ${result.baby.name}`);
	}
	return result;
}

function emptyResult(baby: ImportBaby | null, error: string): NarababyImport {
	return {
		baby,
		feedings: [],
		diapers: [],
		sleeps: [],
		growths: [],
		milestones: [],
		notes: [],
		errors: [error],
	};
}

export function countRecords(parsed: NarababyImport) {
	return {
		breast: parsed.feedings.filter((f) => f.type === 'breast').length,
		bottle: parsed.feedings.filter((f) => f.type === 'bottle').length,
		pump: parsed.feedings.filter((f) => f.type === 'pump').length,
		formula: parsed.feedings.filter((f) => f.type === 'formula').length,
		diapers: parsed.diapers.length,
		sleep: parsed.sleeps.length,
		growth: parsed.growths.length,
		routines: parsed.milestones.length,
	};
}