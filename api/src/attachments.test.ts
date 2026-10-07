// src/attachments.test.ts
//
// Attachments are the encrypted path, so these cover the tenancy boundary as
// much as the round trip.
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import app from './server';

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

async function upload(token: string, refType: string, refId: number, name: string, content: string) {
	const form = new FormData();
	form.set('refType', refType);
	form.set('refId', String(refId));
	form.set('file', new File([content], name, { type: 'application/pdf' }));
	const res = await app.fetch(
		new Request('http://localhost/api/v1/attachments', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: form,
		}),
	);
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

let token = '';
let familyId = '';
let appointmentId = 0;
let subjectId = 0;

beforeAll(async () => {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email: 'attach@example.com', password: 'StrongP4ss!', firstName: 'Att', lastName: 'Acher',
	});
	token = reg.body.token;
	familyId = (jwt.decode(token) as any).familyId as string;

	const pet = await call('POST', token, '/api/v1/families/members', { type: 'pet', name: 'Rex' });
	subjectId = pet.body.member.id;

	// A vet visit: a milestone row with the appointments kind.
	const appt = await call('POST', token, '/api/v1/milestones', {
		memberId: subjectId, title: 'Annual check-up', achievedDate: '2026-04-01T00:00:00.000Z', kind: 'appointments',
	});
	appointmentId = appt.body.milestone.id;
});

describe('a file can be attached to a record', () => {
	it('takes an upload against a vet appointment and lists it back', async () => {
		const up = await upload(token, 'milestone', appointmentId, 'vaccination-report.pdf', 'REPORT-BYTES');
		expect(up.status).toBe(201);
		expect(up.body.attachment.filename).toBe('vaccination-report.pdf');
		expect(up.body.attachment.size).toBe('REPORT-BYTES'.length);

		const list = await call('GET', token, `/api/v1/attachments?refType=milestone&refId=${appointmentId}`);
		expect(list.status).toBe(200);
		expect(list.body.attachments.length).toBe(1);
		expect(list.body.attachments[0].filename).toBe('vaccination-report.pdf');
	});

	it('returns exactly the bytes that were uploaded', async () => {
		const up = await upload(token, 'milestone', appointmentId, 'second.pdf', 'SECOND-FILE');
		const res = await app.fetch(
			new Request(`http://localhost/api/v1/attachments/${up.body.attachment.id}/file`, {
				headers: { Authorization: `Bearer ${token}` },
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('SECOND-FILE');
		expect(res.headers.get('content-type')).toBe('application/pdf');
	});

	it('can attach to a member profile too, not only a record', async () => {
		const up = await upload(token, 'subject', subjectId, 'microchip.pdf', 'CHIP');
		expect(up.status).toBe(201);
	});

	it('removes the row and the bytes on delete', async () => {
		const up = await upload(token, 'milestone', appointmentId, 'temp.pdf', 'TEMP');
		const id = up.body.attachment.id;
		const del = await call('DELETE', token, `/api/v1/attachments/${id}`);
		expect(del.status).toBe(200);

		const res = await app.fetch(new Request(`http://localhost/api/v1/attachments/${id}/file`, { headers: { Authorization: `Bearer ${token}` } }));
		expect(res.status).toBe(404);
	});
});

describe('the boundary holds', () => {
	it('refuses an unknown ref type rather than guessing a table', async () => {
		const res = await upload(token, 'not_a_table', 1, 'x.pdf', 'X');
		expect(res.status).toBe(400);
	});

	it('refuses to attach to a record that does not exist', async () => {
		const res = await upload(token, 'milestone', 999999, 'x.pdf', 'X');
		expect(res.status).toBe(404);
	});

	it('will not let another family read the file', async () => {
		const up = await upload(token, 'milestone', appointmentId, 'private.pdf', 'PRIVATE');
		const id = up.body.attachment.id;

		const other = await call('POST', '', '/api/v1/auth/register', {
			email: 'attach-other@example.com', password: 'StrongP4ss!', firstName: 'Other', lastName: 'Family',
		});
		const res = await app.fetch(
			new Request(`http://localhost/api/v1/attachments/${id}/file`, {
				headers: { Authorization: `Bearer ${other.body.token}` },
			}),
		);
		// The other family has its own namespace, so the row simply does not exist.
		expect(res.status).toBe(404);
	});
});
