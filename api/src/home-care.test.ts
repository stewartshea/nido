// src/home-care.test.ts
//
// The HOME care loop: meters (#66), schedules and "what's due" (#67), and the
// maintenance log (#68).
//
// Dates are relative to today on purpose: an interval schedule is about the
// distance between two dates, so a fixture pinned to 2024 would test the
// calendar rather than the rule.
import { describe, it, expect, beforeAll } from 'vitest';
import app from './server';
import { estimateMeter, readingInEffect } from './meters';
import { evaluateSchedule, seasonalWindow } from './schedules';
import { setOcrExtractor } from './ocr';

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function register(email: string) {
	const reg = await call('POST', '', '/api/v1/auth/register', {
		email, password: 'StrongP4ss!', firstName: 'Care', lastName: 'Loop',
	});
	return reg.body.token as string;
}

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
const monthDay = (days: number) => daysAgo(days).slice(5);

async function makeAsset(token: string, name = 'The Mazda') {
	const res = await call('POST', token, '/api/v1/home-assets', { name, category: 'vehicle' });
	return res.body.asset as { id: number; name: string };
}

// A tiny PNG for the photo upload path.
const PNG_BYTES = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1a, 0x2b, 0xd4,
	0x34, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x93, 0xcd, 0x69, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
]);

async function uploadAssetPicture(token: string, id: number) {
	const form = new FormData();
	form.append('file', new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }), 'asset.png');
	return app.fetch(new Request(`http://localhost/api/v1/home-assets/${id}/picture`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	}));
}

async function uploadAttachment(token: string, refType: string, refId: number, name: string) {
	const form = new FormData();
	form.set('refType', refType);
	form.set('refId', String(refId));
	form.set('file', new File([`bytes of ${name}`], name, { type: 'application/pdf' }));
	return app.fetch(new Request('http://localhost/api/v1/attachments', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	}));
}

/** Upload a file whose body is real, OCR-able text (a receipt or a scan). */
async function uploadReceipt(token: string, refType: string, refId: number, name: string, text: string) {
	const form = new FormData();
	form.set('refType', refType);
	form.set('refId', String(refId));
	form.set('file', new File([text], name, { type: 'application/pdf' }));
	return app.fetch(new Request('http://localhost/api/v1/attachments', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	}));
}

describe('home care: meter interpolation', () => {
	it('holds at the last reading with only one reading', () => {
		const estimate = estimateMeter(
			[{ id: 1, value: 82_100, recordedAt: '2026-10-01', source: 'manual', maintenanceEntryId: null }],
			'2026-10-20',
		);
		expect(estimate?.value).toBe(82_100);
		expect(estimate?.estimated).toBe(false);
	});

	it('interpolates a rate between two readings', () => {
		const estimate = estimateMeter(
			[
				{ id: 1, value: 80_000, recordedAt: '2026-09-01', source: 'manual', maintenanceEntryId: null },
				{ id: 2, value: 84_000, recordedAt: '2026-10-01', source: 'manual', maintenanceEntryId: null },
			],
			'2026-10-11',
		);
		// 4,000 km over 30 days = 133.3 km/day, ten days later.
		expect(estimate?.estimated).toBe(true);
		expect(Math.round(estimate!.value)).toBe(85_333);
		expect(Math.round(estimate!.ratePerDay)).toBe(133);
	});

	it('does not invent a rate from a corrected (lower) reading', () => {
		const estimate = estimateMeter(
			[
				{ id: 1, value: 90_000, recordedAt: '2026-09-01', source: 'manual', maintenanceEntryId: null },
				{ id: 2, value: 12_000, recordedAt: '2026-10-01', source: 'manual', maintenanceEntryId: null },
			],
			'2026-10-11',
		);
		expect(estimate?.value).toBe(12_000);
		expect(estimate?.estimated).toBe(false);
	});

	it('reads the value in effect on a date, falling back to the earliest', () => {
		const readings = [
			{ id: 1, value: 80_000, recordedAt: '2026-09-01', source: 'manual', maintenanceEntryId: null },
			{ id: 2, value: 84_000, recordedAt: '2026-10-01', source: 'manual', maintenanceEntryId: null },
		];
		expect(readingInEffect(readings, '2026-09-15')?.value).toBe(80_000);
		expect(readingInEffect(readings, '2026-10-01')?.value).toBe(84_000);
		// Every reading is newer than the date: the earliest is the honest floor.
		expect(readingInEffect(readings, '2026-08-01')?.value).toBe(80_000);
	});
});

describe('home care: the routes', () => {
	let token = '';
	let otherToken = '';
	let assetId = 0;
	let meterId = 0;
	let oilChangeId = 0;
	let seasonalId = 0;
	let itemId = 0;

	beforeAll(async () => {
		token = await register('home-care@example.com');
		otherToken = await register('home-care-other@example.com');
		const asset = await makeAsset(token);
		assetId = asset.id;
	});

	it('registers an odometer and refuses a unit outside its kind', async () => {
		const bad = await call('POST', token, `/api/v1/home-assets/${assetId}/meters`, { kind: 'distance', unit: 'h' });
		expect(bad.status).toBe(400);

		const created = await call('POST', token, `/api/v1/home-assets/${assetId}/meters`, {
			kind: 'distance', unit: 'km', label: 'Odometer',
		});
		expect(created.status).toBe(201);
		expect(created.body.meter.kind).toBe('distance');
		expect(created.body.meter.unit).toBe('km');
		meterId = created.body.meter.id;

		const duplicate = await call('POST', token, `/api/v1/home-assets/${assetId}/meters`, { kind: 'distance', unit: 'km' });
		expect(duplicate.status).toBe(400);
	});

	it('records readings and estimates today from them', async () => {
		await call('POST', token, `/api/v1/home-assets/meters/${meterId}/readings`, {
			value: 80_000, recordedAt: daysAgo(40),
		});
		const res = await call('POST', token, `/api/v1/home-assets/meters/${meterId}/readings`, {
			value: 84_000, recordedAt: daysAgo(10),
		});
		expect(res.status).toBe(201);
		const meter = res.body.meter;
		expect(meter.readings).toHaveLength(2);
		expect(meter.lastReading.value).toBe(84_000);
		// 4,000 km over 30 days, ten days since the last reading.
		expect(meter.estimate.estimated).toBe(true);
		expect(meter.estimate.value).toBeGreaterThan(85_000);
	});

	it('creates an interval schedule that is not yet due', async () => {
		const res = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Oil change',
			conditions: [{ kind: 'interval', every: 30, unit: 'days' }],
			leadDays: 7,
		});
		expect(res.status).toBe(201);
		expect(res.body.schedule.status.state).toBe('ok');
		expect(res.body.schedule.status.dueAt).toBe(
			new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
		);
		oilChangeId = res.body.schedule.id;
	});

	it('satisfies the schedule with a maintenance entry, and backdates the baseline', async () => {
		const res = await call('POST', token, `/api/v1/home-assets/${assetId}/maintenance`, {
			scheduleId: oilChangeId,
			task: 'Oil change',
			performedAt: daysAgo(40),
			cost: 8_900,
			notes: 'Synthetic 5W-30',
			meterReadings: [{ meterId, value: 80_500 }],
		});
		expect(res.status).toBe(201);
		expect(res.body.entry.cost).toBe(8_900);
		expect(res.body.entry.performedAt).toBe(daysAgo(40));

		const care = await call('GET', token, `/api/v1/home-assets/${assetId}/care`);
		const schedule = care.body.schedules.find((s: any) => s.id === oilChangeId);
		// Done 40 days ago, due 30 days after that: ten days past due.
		expect(schedule.status.state).toBe('overdue');
		expect(schedule.status.conditions[0].remaining).toBe(-10);
		expect(care.body.rollup.total).toBe(8_900);
		expect(care.body.meters[0].readings).toHaveLength(3);
	});

	it('fires a meter trigger from the interpolated estimate', async () => {
		const res = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Tire rotation',
			conditions: [{ kind: 'meter', meterId, every: 2_000 }],
		});
		expect(res.status).toBe(201);
		// First reading is the zero point (80,000), so 2,000 km later is 82,000
		// and the estimate today is already past it.
		expect(res.body.schedule.status.state).toBe('overdue');
		expect(res.body.schedule.status.conditions[0].detail).toContain('last read');
	});

	it('rejects a meter condition naming a meter the asset does not have', async () => {
		const res = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Impossible',
			conditions: [{ kind: 'meter', meterId: meterId + 500, every: 1_000 }],
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('not on this asset');
	});

	it('opens a seasonal window, then checks it off with an entry', async () => {
		const created = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Swap to winter tires',
			conditions: [{ kind: 'seasonal', start: monthDay(30), end: monthDay(-5) }],
			leadDays: 14,
		});
		expect(created.status).toBe(201);
		seasonalId = created.body.schedule.id;
		expect(created.body.schedule.status.state).toBe('due');
		expect(created.body.schedule.status.season.state).toBe('open');

		await call('POST', token, `/api/v1/home-assets/${assetId}/maintenance`, {
			scheduleId: seasonalId,
			task: 'Swap to winter tires',
			performedAt: today(),
		});
		const care = await call('GET', token, `/api/v1/home-assets/${assetId}/care`);
		const schedule = care.body.schedules.find((s: any) => s.id === seasonalId);
		expect(schedule.status.state).toBe('ok');
		expect(schedule.status.season.satisfied).toBe(true);
	});

	it('reports a missed window as overdue', async () => {
		const res = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Clean the gutters',
			conditions: [{ kind: 'seasonal', start: monthDay(90), end: monthDay(60) }],
		});
		expect(res.body.schedule.status.state).toBe('overdue');
	});

	it('lets a family skip one season, with a reason', async () => {
		const created = await call('POST', token, `/api/v1/home-assets/${assetId}/schedules`, {
			task: 'Open the cabin',
			conditions: [{ kind: 'seasonal', start: monthDay(20), end: monthDay(-10) }],
		});
		const windowStart = created.body.schedule.status.season.window.start;
		const skipped = await call('POST', token, `/api/v1/home-assets/schedules/${created.body.schedule.id}/skip`, {
			windowStart, reason: 'We are away this year',
		});
		expect(skipped.body.schedule.status.state).toBe('ok');
		expect(skipped.body.schedule.status.season.skipped).toBe(true);
		expect(skipped.body.schedule.status.season.skipReason).toBe('We are away this year');
	});

	it('consumes inventory on an entry and restores it on delete', async () => {
		const item = await call('POST', token, '/api/v1/inventory', {
			name: 'Furnace filter', category: 'household', quantity: 4, unit: 'each',
		});
		expect(item.status).toBe(201);
		itemId = item.body.item.id;

		const entry = await call('POST', token, `/api/v1/home-assets/${assetId}/maintenance`, {
			task: 'Changed the furnace filter',
			performedAt: today(),
			consumedItems: [{ itemId, quantity: 2 }],
		});
		expect(entry.status).toBe(201);
		expect(entry.body.entry.consumedItems[0].name).toBe('Furnace filter');

		let stock = await call('GET', token, '/api/v1/inventory');
		expect(stock.body.items.find((i: any) => i.id === itemId).quantity).toBe(2);

		const tooMany = await call('POST', token, `/api/v1/home-assets/${assetId}/maintenance`, {
			task: 'Impossible filter change',
			performedAt: today(),
			consumedItems: [{ itemId, quantity: 9 }],
		});
		expect(tooMany.status).toBe(400);

		const deleted = await call('DELETE', token, `/api/v1/home-assets/maintenance/${entry.body.entry.id}`);
		expect(deleted.status).toBe(200);
		stock = await call('GET', token, '/api/v1/inventory');
		expect(stock.body.items.find((i: any) => i.id === itemId).quantity).toBe(4);
	});

	it('serves what’s due across assets, overdue first', async () => {
		const res = await call('GET', token, '/api/v1/home-assets/due');
		expect(res.status).toBe(200);
		const states = res.body.items.map((item: any) => item.state);
		expect(states.length).toBeGreaterThan(0);
		expect(states[0]).toBe('overdue');
		expect(res.body.items[0].assetName).toBe('The Mazda');
		// Nothing that is not due leaks into the list.
		expect(states.every((state: string) => state === 'overdue' || state === 'due')).toBe(true);
	});

	it('keeps one family out of another family’s care records', async () => {
		// Each family is its own encrypted database, so an id that is real here
		// simply does not exist there — a 404, never a 403 that confirms it.
		const missing = assetId + 500;
		const res = await call('GET', otherToken, `/api/v1/home-assets/${missing}/care`);
		expect(res.status).toBe(404);
		const entry = await call('POST', otherToken, `/api/v1/home-assets/${missing}/maintenance`, {
			task: 'Trespassing', performedAt: today(),
		});
		expect(entry.status).toBe(404);
	});

	it('archives a schedule out of the due list', async () => {
		await call('POST', token, `/api/v1/home-assets/schedules/${oilChangeId}/archive`);
		const res = await call('GET', token, '/api/v1/home-assets/due');
		expect(res.body.items.some((item: any) => item.scheduleId === oilChangeId)).toBe(false);
	});

	it('stores an asset photo, serves it back, and replaces rather than accumulates', async () => {
		const first = await uploadAssetPicture(token, assetId);
		expect(first.status).toBe(200);
		const pictureId = Number((await first.json() as any).picture);
		expect(pictureId).toBeGreaterThan(0);

		const served = await app.fetch(new Request(`http://localhost/api/v1/home-assets/${assetId}/picture`, {
			headers: { Authorization: `Bearer ${token}` },
		}));
		expect(served.status).toBe(200);
		expect(served.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await served.arrayBuffer()).length).toBe(PNG_BYTES.length);

		// The marker rides on the asset in the care aggregate the page loads.
		const care = await call('GET', token, `/api/v1/home-assets/${assetId}/care`);
		expect(care.body.asset.picture).toBe(pictureId);

		// Replacing moves the marker and deletes the old attachment with its bytes.
		const second = await uploadAssetPicture(token, assetId);
		expect(second.status).toBe(200);
		expect(Number((await second.json() as any).picture)).not.toBe(pictureId);
		const gone = await app.fetch(new Request(`http://localhost/api/v1/attachments/${pictureId}/file`, {
			headers: { Authorization: `Bearer ${token}` },
		}));
		expect(gone.status).toBe(404);
	});

	it('attaches receipts to an entry and files to the asset, listing both in one read', async () => {
		const entry = await call('POST', token, `/api/v1/home-assets/${assetId}/maintenance`, {
			task: 'Brake pads', performedAt: today(), cost: 23_000,
		});
		expect(entry.status).toBe(201);
		const entryId = entry.body.entry.id;

		expect((await uploadAttachment(token, 'maintenance', entryId, 'receipt.pdf')).status).toBe(201);
		expect((await uploadAttachment(token, 'asset', assetId, 'manual.pdf')).status).toBe(201);

		const care = await call('GET', token, `/api/v1/home-assets/${assetId}/care`);
		const refs = care.body.attachments.map((a: any) => `${a.refType}:${a.refId}`);
		expect(refs).toContain(`maintenance:${entryId}`);
		expect(refs).toContain(`asset:${assetId}`);

		// Deleting the entry takes its receipt with it; the asset's own file stays.
		await call('DELETE', token, `/api/v1/home-assets/maintenance/${entryId}`);
		const after = await call('GET', token, `/api/v1/home-assets/${assetId}/care`);
		expect(after.body.attachments.some((a: any) => a.refType === 'maintenance' && a.refId === entryId)).toBe(false);
		expect(after.body.attachments.some((a: any) => a.refType === 'asset' && a.refId === assetId)).toBe(true);
	});
});

describe('home care: OCR and search (#69)', () => {
	let token = '';
	let mazdaId = 0;
	let truckId = 0;
	let furnaceId = 0;
	let annualId = 0;
	let service60kId = 0;

	beforeAll(async () => {
		token = await register('home-ocr@example.com');

		const mazda = await call('POST', token, '/api/v1/home-assets', { name: 'The Mazda', category: 'vehicle' });
		mazdaId = mazda.body.asset.id;
		const truck = await call('POST', token, '/api/v1/home-assets', { name: 'The Truck', category: 'vehicle' });
		truckId = truck.body.asset.id;
		const furnace = await call('POST', token, '/api/v1/home-assets', {
			name: 'Furnace', category: 'hvac',
			manualUrl: 'https://example.com/furnace-manual.pdf',
		});
		furnaceId = furnace.body.asset.id;

		// The task names are deliberately generic: the searchable detail lives
		// in the receipt, which is the whole point of the OCR path.
		const annual = await call('POST', token, `/api/v1/home-assets/${mazdaId}/maintenance`, {
			task: 'Annual shop visit', performedAt: '2026-02-14', cost: 41_200,
		});
		annualId = annual.body.entry.id;
		const service = await call('POST', token, `/api/v1/home-assets/${truckId}/maintenance`, {
			task: '60k service', performedAt: '2025-08-10', cost: 76_500,
		});
		service60kId = service.body.entry.id;

		// A furnace manual whose filter size is only in the scan.
		await uploadReceipt(token, 'asset', furnaceId, 'furnace-manual-2024.pdf', 'Replace filter with MERV 11 16x25x4 every 90 days');
	});

	it('stores the manual URL on the asset', async () => {
		const res = await call('GET', token, `/api/v1/home-assets/${furnaceId}`);
		expect(res.body.asset.manualUrl).toBe('https://example.com/furnace-manual.pdf');
	});

	it('extracts OCR text from uploaded receipts onto the entries', async () => {
		const first = await uploadReceipt(token, 'maintenance', annualId, 'midtown-auto.pdf', 'Replaced front brake pads and rotors');
		expect(first.status).toBe(201);
		const firstBody = await first.json() as any;
		expect(firstBody.attachment.ocrStatus).toBe('done');
		expect(firstBody.attachment.ocrText).toContain('brake pads');

		const second = await uploadReceipt(token, 'maintenance', service60kId, '60k-invoice.pdf', 'Rear brake caliper service');
		expect(second.status).toBe(201);

		const entries = await call('GET', token, `/api/v1/home-assets/${mazdaId}/maintenance`);
		const annual = entries.body.entries.find((e: any) => e.id === annualId);
		expect(annual.attachments).toHaveLength(1);
		expect(annual.attachments[0].ocrStatus).toBe('done');
		expect(annual.attachments[0].ocrText).toContain('Replaced front brake pads');
	});

	it('searches brake work across vehicles with dates, costs and OCR snippets', async () => {
		const res = await call('GET', token, '/api/v1/home-assets/search?q=brake&category=vehicle');
		expect(res.status).toBe(200);

		const brake = res.body.results.filter((r: any) => r.kind === 'maintenance');
		expect(brake).toHaveLength(2);
		expect(brake.map((r: any) => r.assetName).sort()).toEqual(['The Mazda', 'The Truck']);
		// Newest first.
		expect(brake[0].entry.performedAt).toBe('2026-02-14');
		expect(brake[1].entry.performedAt).toBe('2025-08-10');
		expect(brake[0].entry.cost).toBe(41_200);
		expect(brake[1].entry.cost).toBe(76_500);

		for (const result of brake) {
			expect(result.matchedIn).toContain('ocr');
			expect(result.snippet.toLowerCase()).toContain('brake');
			expect(result.attachments.length).toBeGreaterThanOrEqual(1);
			expect(result.attachments[0].ocrText.toLowerCase()).toContain('brake');
		}
	});

	it('filters one asset’s maintenance log by keyword', async () => {
		const matching = await call('GET', token, `/api/v1/home-assets/${mazdaId}/maintenance?q=brake`);
		expect(matching.body.entries.map((e: any) => e.id)).toEqual([annualId]);

		const missing = await call('GET', token, `/api/v1/home-assets/${mazdaId}/maintenance?q=carburetor`);
		expect(missing.body.entries).toHaveLength(0);
	});

	it('searches asset manuals by their OCR text', async () => {
		const res = await call('GET', token, '/api/v1/home-assets/search?q=16x25x4');
		expect(res.status).toBe(200);
		const doc = res.body.results.find((r: any) => r.kind === 'document' && r.attachments[0].filename === 'furnace-manual-2024.pdf');
		expect(doc).toBeTruthy();
		expect(doc.assetName).toBe('Furnace');
		expect(doc.matchedIn).toContain('ocr');
		expect(doc.snippet).toContain('MERV 11');
	});

	it('still succeeds, with an unavailable status, when OCR cannot run', async () => {
		setOcrExtractor(async () => ({ status: 'unavailable', text: null }));
		try {
			const up = await uploadReceipt(token, 'maintenance', annualId, 'unreadable-fax.pdf', 'anything');
			expect(up.status).toBe(201);
			const body = await up.json() as any;
			expect(body.attachment.ocrStatus).toBe('unavailable');
			expect(body.attachment.ocrText).toBeNull();
		} finally {
			setOcrExtractor(null);
		}
	});

	it('keeps search scoped to the caller’s own family', async () => {
		const otherToken = await register('home-ocr-other@example.com');
		const res = await call('GET', otherToken, '/api/v1/home-assets/search?q=brake&category=vehicle');
		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(0);
	});
});

describe('home care: schedule evaluation', () => {
	const base = {
		match: 'any' as const,
		leadDays: 7,
		today: '2026-06-01',
		since: '2026-01-01',
		entries: [] as string[],
		skips: new Map<string, string | null>(),
		meters: new Map(),
	};

	it('treats `any` as the worst condition and `all` as the binding one', () => {
		const conditions = [
			{ kind: 'interval' as const, every: 365, unit: 'days' as const },
			{ kind: 'seasonal' as const, start: '05-01', end: '06-15' },
		];
		const any = evaluateSchedule({ ...base, conditions, match: 'any' });
		expect(any.state).toBe('due');
		const all = evaluateSchedule({ ...base, conditions, match: 'all' });
		expect(all.state).toBe('ok');
	});

	it('wraps a window that crosses the new year', () => {
		const window = seasonalWindow('11-15', '03-01', 2026);
		expect(window.start).toBe('2026-11-15');
		expect(window.end).toBe('2027-03-01');
	});
});
