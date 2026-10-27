// src/adult-tracking.test.ts
//
// The two shapes adult tracking still lacked after the stage work: a
// medication list with dose, frequency and start date (so a reminder can read
// a schedule instead of a person's memory), and vitals — blood pressure in
// particular — as measurements with their own numbers rather than a titled
// moment.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';
import { FAMILY_MIGRATIONS, getFamilyClient } from './db-namespaces';
import { medicationDueState } from './medications';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const now = () => new Date().toISOString();
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600 * 1000).toISOString();
const dayString = (offsetDays = 0) =>
	new Date(Date.now() + offsetDays * 86400 * 1000).toISOString().slice(0, 10);

let token = '';
let familyId = '';
let adultId = 0;
let strangerToken = '';

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'adult-tracking@example.com', password: 'StrongP4ss!', firstName: 'Ada', lastName: 'Adult',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;
	const adult = await call('POST', token, `/api/v1/families/${familyId}/members`, {
		type: 'adult', name: 'Sam', trackable: true, birthDate: '1985-04-01T00:00:00.000Z',
	});
	adultId = adult.body.member.id;

	const other = await call('POST', '', '/api/v1/auth/register', {
		email: 'adult-tracking-other@example.com', password: 'StrongP4ss!', firstName: 'Other', lastName: 'Family',
	});
	strangerToken = other.body.token;
});

describe('an adult profile starts tracking vitals', () => {
	it('offers vitals on the adult stage', async () => {
		const list = await call('GET', token, `/api/v1/families/${familyId}/members`);
		const adult = list.body.members.find((m: any) => m.id === adultId);
		expect(adult.categories).toContain('vitals');
	});

	it('exposes the built-in adult template with vitals in it', async () => {
		const res = await call('GET', token, `/api/v1/families/${familyId}/settings`);
		expect(res.body.settings.defaultStageCategories.adult).toContain('vitals');
	});

	it('appends vitals to an existing adult profile, once', async () => {
		// A profile curated before this release keeps its list, with vitals
		// added: the feature would otherwise be invisible to every adult who
		// already existed.
		const raw = getFamilyClient(familyId).raw;
		raw.prepare(`UPDATE family_members SET categories = ? WHERE id = ?`).run(
			JSON.stringify(['medication', 'moods']),
			adultId,
		);
		const migration = FAMILY_MIGRATIONS.find((m) => m.version === 39)!;
		migration.run!(raw);
		migration.run!(raw); // idempotent: a re-run must not append it twice
		const row = raw.prepare('SELECT categories FROM family_members WHERE id = ?').get(adultId) as { categories: string };
		const categories = JSON.parse(row.categories);
		expect(categories).toContain('vitals');
		expect(categories.filter((c: string) => c === 'vitals')).toHaveLength(1);
		expect(categories).toContain('medication');
	});
});

describe('vitals are measurements, not titled moments', () => {
	let bpId = 0;

	it('records a blood pressure with both numbers and a derived unit', async () => {
		const res = await call('POST', token, '/api/v1/vitals', {
			memberId: adultId, kind: 'blood pressure', systolic: 128, diastolic: 82,
			recordedAt: hoursAgo(2), notes: 'after a walk',
		});
		expect(res.status).toBe(201);
		expect(res.body.vital.systolic).toBe(128);
		expect(res.body.vital.diastolic).toBe(82);
		expect(res.body.vital.unit).toBe('mmHg');
		bpId = res.body.vital.id;
	});

	it('refuses a blood pressure missing a number', async () => {
		const res = await call('POST', token, '/api/v1/vitals', {
			memberId: adultId, kind: 'blood pressure', systolic: 128,
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('both numbers');
	});

	it('refuses a systolic that is not higher than the diastolic', async () => {
		const res = await call('POST', token, '/api/v1/vitals', {
			memberId: adultId, kind: 'blood pressure', systolic: 70, diastolic: 90,
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('higher');
	});

	it('records a pulse as a single value', async () => {
		const res = await call('POST', token, '/api/v1/vitals', {
			memberId: adultId, kind: 'pulse', value: 72, recordedAt: now(),
		});
		expect(res.status).toBe(201);
		expect(res.body.vital.value).toBe(72);
		expect(res.body.vital.unit).toBe('bpm');
		expect(res.body.vital.systolic).toBeNull();
	});

	it('refuses a pulse outside a believable range', async () => {
		const res = await call('POST', token, '/api/v1/vitals', {
			memberId: adultId, kind: 'pulse', value: 900,
		});
		expect(res.status).toBe(400);
	});

	it('lists a member\u2019s vitals newest first', async () => {
		const res = await call('GET', token, `/api/v1/vitals?memberId=${adultId}`);
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(2);
		expect(res.body.vitals[0].kind).toBe('pulse');
	});

	it('corrects a reading', async () => {
		const res = await call('PUT', token, `/api/v1/vitals/${bpId}`, { systolic: 130, diastolic: 84 });
		expect(res.status).toBe(200);
		expect(res.body.vital.systolic).toBe(130);
	});

	it('deletes a reading', async () => {
		const made = await call('POST', token, '/api/v1/vitals', { memberId: adultId, kind: 'temperature', value: 37.2 });
		const res = await call('DELETE', token, `/api/v1/vitals/${made.body.vital.id}`);
		expect(res.status).toBe(200);
	});

	it('does not let another family read or write these vitals', async () => {
		const read = await call('GET', strangerToken, `/api/v1/vitals?memberId=${adultId}`);
		expect(read.status).toBe(403);
		const write = await call('PUT', strangerToken, `/api/v1/vitals/${bpId}`, { systolic: 120, diastolic: 80 });
		expect(write.status).toBe(404);
	});
});

describe('a medication is a schedule, and a dose is an event', () => {
	let medId = 0;

	it('adds a medication with a dose, frequency and start date', async () => {
		const res = await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Atenolol', dose: '50 mg', frequency: 'twice_daily', startDate: dayString(0),
		});
		expect(res.status).toBe(201);
		expect(res.body.medication.name).toBe('Atenolol');
		expect(res.body.medication.dose).toBe('50 mg');
		expect(res.body.medication.frequencyLabel).toBe('Twice a day');
		expect(res.body.medication.startDate).toBe(dayString(0));
		// Never taken, and the course has started: it is due.
		expect(res.body.medication.lastDoseAt).toBeNull();
		expect(res.body.medication.due).toBe(true);
		medId = res.body.medication.id;
	});

	it('sends the schedule vocabulary with the list, so the picker cannot drift', async () => {
		const res = await call('GET', token, `/api/v1/medications?memberId=${adultId}`);
		expect(res.body.frequencies.map((f: any) => f.id)).toContain('once_daily');
		expect(res.body.frequencies.find((f: any) => f.id === 'weekly').hours).toBe(168);
	});

	it('refuses an end date before the start date', async () => {
		const res = await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Backwards', startDate: dayString(2), endDate: dayString(1),
		});
		expect(res.status).toBe(400);
	});

	it('logs a dose through the event path, linked to the medication', async () => {
		const res = await call('POST', token, `/api/v1/medications/${medId}/doses`, {});
		expect(res.status).toBe(201);
		expect(res.body.event.category).toBe('medication');
		expect(res.body.event.data.medicationId).toBe(medId);
		expect(res.body.event.data.dose).toBe('50 mg');
		expect(res.body.event.title).toBe('Atenolol');
		// A dose just taken means the next one is not due yet.
		expect(res.body.medication.lastDoseAt).toBeTruthy();
		expect(res.body.medication.due).toBe(false);
	});

	it('shows the dose in the activity feed like any other record', async () => {
		const res = await call('GET', token, `/api/v1/events?memberId=${adultId}&category=medication`);
		expect(res.body.events.length).toBeGreaterThan(0);
		expect(res.body.events[0].data.medicationId).toBe(medId);
	});

	it('becomes due again once the interval has passed', async () => {
		// Its own medication: the last dose recorded is the latest instant, so a
		// 13-hour-old dose against a 12-hour schedule is overdue.
		const made = await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Ramipril', dose: '5 mg', frequency: 'twice_daily', startDate: dayString(-2),
		});
		const id = made.body.medication.id;
		const backdated = await call('POST', token, `/api/v1/medications/${id}/doses`, { occurredAt: hoursAgo(13) });
		expect(backdated.status).toBe(201);
		expect(backdated.body.medication.due).toBe(true);
		const list = await call('GET', token, `/api/v1/medications?memberId=${adultId}`);
		const med = list.body.medications.find((m: any) => m.id === id);
		expect(med.due).toBe(true);
		expect(med.nextDueAt).toBeTruthy();
	});

	it('never nudges for "as needed"', async () => {
		const made = await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Paracetamol', frequency: 'as_needed', startDate: dayString(0),
		});
		expect(made.body.medication.due).toBe(false);
	});

	it('stops nudging once the course has ended', async () => {
		const made = await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Amoxicillin', frequency: 'once_daily', startDate: dayString(-10), endDate: dayString(-1),
		});
		expect(made.body.medication.due).toBe(false);
	});

	it('stops a medication without losing the doses already recorded', async () => {
		const stop = await call('PUT', token, `/api/v1/medications/${medId}`, { active: false });
		expect(stop.status).toBe(200);
		expect(stop.body.medication.active).toBe(false);
		expect(stop.body.medication.due).toBe(false);
		const events = await call('GET', token, `/api/v1/events?memberId=${adultId}&category=medication`);
		expect(events.body.events.some((e: any) => e.data.medicationId === medId)).toBe(true);
	});

	it('does not let another family add medication to this member', async () => {
		const res = await call('POST', strangerToken, '/api/v1/medications', { memberId: adultId, name: 'Nope' });
		expect(res.status).toBe(403);
	});
});

describe('due medications reach the notification badge and list', () => {
	it('counts a due medication in the summary and lists it family-wide', async () => {
		await call('POST', token, '/api/v1/medications', {
			memberId: adultId, name: 'Vitamin B12', dose: '1 tablet', frequency: 'once_daily', startDate: dayString(0),
		});
		const summary = await call('GET', token, '/api/v1/notifications/summary');
		expect(summary.body.medications).toBeGreaterThan(0);
		expect(summary.body.total).toBeGreaterThanOrEqual(summary.body.medications);

		const due = await call('GET', token, '/api/v1/medications/due');
		expect(due.body.medications.some((m: any) => m.name === 'Vitamin B12')).toBe(true);
		expect(due.body.medications[0].memberName).toBe('Sam');
	});
});

describe('the due calculation itself', () => {
	const med = { id: 1, name: 'X', frequency: 'twice_daily', start_date: '2026-01-01', end_date: null, active: 1 };

	it('is due from the start date when nothing has been taken', () => {
		expect(medicationDueState(med, null, Date.now(), '2026-01-01').due).toBe(true);
		expect(medicationDueState(med, null, Date.now(), '2025-12-31').due).toBe(false);
	});

	it('is due exactly one interval after the last dose', () => {
		const last = '2026-01-01T08:00:00.000Z';
		const base = new Date(last).getTime();
		expect(medicationDueState(med, last, base + 11 * 3600 * 1000, '2026-01-01').due).toBe(false);
		expect(medicationDueState(med, last, base + 12 * 3600 * 1000, '2026-01-01').due).toBe(true);
	});

	it('treats the end date as inclusive', () => {
		const course = { ...med, end_date: '2026-01-05' };
		expect(medicationDueState(course, null, Date.now(), '2026-01-05').due).toBe(true);
		expect(medicationDueState(course, null, Date.now(), '2026-01-06').due).toBe(false);
	});
});
