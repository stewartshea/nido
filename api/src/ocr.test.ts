// src/ocr.test.ts
//
// HOME module milestone 5 (issue #69): best-effort attachment text extraction.
//
// The point of this module is that it can never fail an upload, so the tests
// cover both the happy paths (text, PDF, PNG) and the two honest non-answers
// ('unavailable' when a binary is missing, 'failed' when one errors) without
// depending on which tools happen to be installed on the runner.
import { describe, it, expect, afterEach } from 'vitest';
import app from './server';
import {
	embedPngText,
	extractAttachmentText,
	extractPngTextChunks,
	extractPdfTextFromStreams,
	mergeOcrPasses,
	parseReceiptHints,
	setOcrExtractor,
	sniffContentType,
} from './ocr';

/** A minimal, structurally valid single-page PDF with one text operator. */
function minimalPdf(text: string): Buffer {
	const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
	const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
	const objects = [
		'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
		'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
		'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
		`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
		'5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
	];
	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (const object of objects) {
		offsets.push(pdf.length);
		pdf += object;
	}
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
	return Buffer.from(pdf, 'latin1');
}

// A valid 1x1 PNG, used as the carrier for an inserted tEXt chunk.
const PNG_BYTES = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

async function call(method: string, token: string, path: string, body?: unknown) {
	const res = await app.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function upload(token: string, refType: string, refId: number, name: string, content: BlobPart, type: string) {
	const form = new FormData();
	form.set('refType', refType);
	form.set('refId', String(refId));
	form.set('file', new File([content], name, { type }));
	const res = await app.fetch(new Request('http://localhost/api/v1/attachments', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	}));
	return { status: res.status, body: (await res.json()) as Record<string, any> };
}

afterEach(() => setOcrExtractor(null));

describe('ocr: plain text', () => {
	it('decodes a text file and reports done', async () => {
		const result = await extractAttachmentText({
			buffer: Buffer.from('  Brake pads replaced at 84,200 km  '),
			contentType: 'text/plain',
			filename: 'note.txt',
		});
		expect(result.status).toBe('done');
		expect(result.text).toBe('Brake pads replaced at 84,200 km');
	});

	it('reports empty for whitespace-only text', async () => {
		const result = await extractAttachmentText({
			buffer: Buffer.from('   \n\t  '),
			contentType: 'text/plain',
			filename: 'blank.txt',
		});
		expect(result).toEqual({ status: 'empty', text: null });
	});
});

describe('ocr: merging the psm 3 and psm 6 passes', () => {
	it('recovers a table row clipped at a divider and keeps the psm 3 order', () => {
		// `--psm 3` loses the row that touches a horizontal rule, leaving only a
		// fragment; the header and total it read are correct and stay first.
		const psm3 = [
			'Qty Description Price Tx Discount Rebate Amount',
			'S, Ceramic Brake Pad Set',
			'Total: $130.50',
		].join('\n');
		// `--psm 6` reads the whole row, but repeats the header and total.
		const psm6 = [
			'Qty Description Price Tx Discount Rebate Amount',
			'2 Front Ceramic Brake Pad Set 90mm $65.25 $130.50',
			'Total: $130.50',
		].join('\n');

		const merged = mergeOcrPasses(psm3, psm6);

		// The primary text is untouched and still comes first.
		expect(merged.startsWith(psm3)).toBe(true);
		// The row the primary clipped is recovered from the secondary pass.
		expect(merged).toContain('2 Front Ceramic Brake Pad Set 90mm $65.25 $130.50');
		// Lines whose words the primary already read are not duplicated.
		expect(merged.match(/Qty Description Price/g)).toHaveLength(1);
		expect(merged.match(/Total: \$130\.50/g)).toHaveLength(1);
	});

	it('leaves a 2-column manual unchanged when the passes agree', () => {
		const psm3 = [
			'Qty Description Price',
			'1 Front Ceramic Brake Pad Set $65.25',
			'2 Rear Rotor Assembly $65.25',
			'Total: $130.50',
		].join('\n');
		// `--psm 6` interleaves the columns, but every word is already known.
		const psm6 = [
			'1 Front Ceramic Brake Pad Set $65.25',
			'2 Rear Rotor Assembly $65.25',
			'Total: $130.50',
		].join('\n');

		expect(mergeOcrPasses(psm3, psm6)).toBe(psm3);
	});

	it('appends only the new lines from the secondary pass, in their order', () => {
		const psm3 = 'Header\nPrice $65.25';
		const psm6 = 'Header\nPrice $65.25\n2 Rear Rotor Assembly $65.25\nAmount $130.50';

		const merged = mergeOcrPasses(psm3, psm6);

		expect(merged).toBe('Header\nPrice $65.25\n2 Rear Rotor Assembly $65.25\nAmount $130.50');
	});

	it('falls back to whichever pass produced text', () => {
		expect(mergeOcrPasses('', 'Total: $5.00')).toBe('Total: $5.00');
		expect(mergeOcrPasses('Total: $5.00', '')).toBe('Total: $5.00');
		expect(mergeOcrPasses('', '')).toBe('');
	});
});

describe('ocr: receipt hints across pages', () => {
	it('reads the task, date and total from separate pages', () => {
		const hints = parseReceiptHints({
			texts: [
				'Midtown Auto - Date: 2026-03-15',
				'Replaced front brake pads and rotors\nTotal: $645.50',
			],
			filenames: ['page1.pdf', 'page2.pdf'],
			today: '2026-04-01',
		});
		expect(hints.task).toBe('Brake service');
		expect(hints.performedAt).toBe('2026-03-15');
		expect(hints.cost).toBe(64550);
		// The page that carried the date and the page that carried the total are
		// one receipt: both survive in the combined text.
		expect(hints.combinedText).toContain('Midtown Auto');
		expect(hints.combinedText).toContain('Total: $645.50');
	});

	it('prefers a schedule the family already tracks', () => {
		const hints = parseReceiptHints({
			texts: ['Midtown Auto\nSwap to winter tires — completed\nTotal: $120.00'],
			schedules: [{ id: 7, task: 'Swap to winter tires' }],
			today: '2026-11-02',
		});
		expect(hints.scheduleId).toBe(7);
		expect(hints.task).toBe('Swap to winter tires');
	});

	it('joins the distinct common tasks a receipt names', () => {
		const hints = parseReceiptHints({
			texts: ['Oil change and front brake pads replaced'],
			today: '2026-05-01',
		});
		expect(hints.task).toBe('Brake service & Oil change');
	});

	it('falls back to the caller’s date and the largest dollar amount', () => {
		const hints = parseReceiptHints({
			texts: ['Shop visit — parts $40.00, labour $120.00'],
			today: '2026-07-04',
		});
		expect(hints.performedAt).toBe('2026-07-04');
		expect(hints.cost).toBe(12000);
	});

	it('reads a multi-column printed receipt: date, real total and merchant header', () => {
		const hints = parseReceiptHints({
			texts: [
				[
					'Harbourview Auto & Alignment',
					'100 Industrial Pkwy',
					'Springfield, Ontario',
					'(555) 019-2834',
					'Bill to: Alex Driver',
					'2026-10-26',
					'Invoice date:',
					'Price Tx Rebate Amount',
					'36520 $130.50',
					's $0.00',
					'Total: $0.00',
					'otal: $130.50',
					'Payments: $130.50',
					'Third-P. Balance: $0.00',
					'Account Balance: $0.00',
				].join('\n'),
			],
			filenames: ['WhatsApp Image 2026-11-19 at 09.47.31.jpeg'],
			today: '2026-11-19',
		});
		expect(hints.performedAt).toBe('2026-10-26');
		// `$0.00` is the tax/remaining-balance line, not what was paid.
		expect(hints.cost).toBe(13050);
		// The camera filename is not a task; the merchant header is.
		expect(hints.task).not.toBe('WhatsApp Image 2026 11 19 at 09.47.31');
		expect(hints.task).toBe('Harbourview Auto & Alignment');
	});
});

describe('ocr: PDF', () => {
	it('extracts text from a real PDF content stream', async () => {
		const result = await extractAttachmentText({
			buffer: minimalPdf('Replaced front brake pads and rotors'),
			contentType: 'application/pdf',
			filename: 'service.pdf',
		});
		expect(result.status).toBe('done');
		expect(result.text).toContain('Replaced front brake pads');
	});

	it('parses text operators directly, including escapes', () => {
		const pdf = minimalPdf('Front (left) pads');
		const text = extractPdfTextFromStreams(pdf);
		expect(text).toContain('Front (left) pads');
	});

	it('falls back to printable text for a text-backed PDF fixture', async () => {
		const result = await extractAttachmentText({
			buffer: Buffer.from('Brake pads replaced at 84,200 km'),
			contentType: 'application/pdf',
			filename: 'receipt.pdf',
		});
		expect(result.status).toBe('done');
		expect(result.text).toBe('Brake pads replaced at 84,200 km');
	});

	it('reports empty for a PDF with no text and no OCR-able pages', async () => {
		const result = await extractAttachmentText({
			buffer: minimalPdf(''),
			contentType: 'application/pdf',
			filename: 'empty.pdf',
		});
		expect(['empty', 'unavailable']).toContain(result.status);
		expect(result.text).toBeNull();
	});

	it('reports unavailable for a content type it cannot read', async () => {
		const result = await extractAttachmentText({
			buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
			contentType: 'application/octet-stream',
			filename: 'blob.bin',
		});
		expect(result).toEqual({ status: 'unavailable', text: null });
	});
});

describe('ocr: images', () => {
	it('round-trips text through a PNG tEXt chunk', () => {
		const png = embedPngText(PNG_BYTES, 'MERV 11 16x25x4');
		expect(extractPngTextChunks(png)).toContain('MERV 11 16x25x4');
	});

	it('extracts embedded PNG text when tesseract is unavailable or silent', async () => {
		const png = embedPngText(PNG_BYTES, 'Replaced front brake pads and rotors');
		const result = await extractAttachmentText({
			buffer: png,
			contentType: 'image/png',
			filename: 'scan.png',
		});
		expect(result.status).toBe('done');
		expect(result.text).toContain('Replaced front brake pads and rotors');
	});

	it('reports unavailable for an image with no readable text and no tesseract', async () => {
		const result = await extractAttachmentText({
			buffer: PNG_BYTES,
			contentType: 'image/png',
			filename: 'plain.png',
		});
		expect(['unavailable', 'empty', 'done']).toContain(result.status);
		if (result.status !== 'done') expect(result.text).toBeNull();
	});
});

describe('ocr: the override seam', () => {
	it('delegates to a custom extractor and can be reset', async () => {
		setOcrExtractor(async () => ({ status: 'unavailable', text: null }));
		expect(await extractAttachmentText({ buffer: Buffer.from('x'), contentType: 'text/plain', filename: null }))
			.toEqual({ status: 'unavailable', text: null });

		setOcrExtractor(async () => ({ status: 'failed', text: null }));
		expect(await extractAttachmentText({ buffer: Buffer.from('x'), contentType: 'text/plain', filename: null }))
			.toEqual({ status: 'failed', text: null });

		setOcrExtractor(null);
		const reset = await extractAttachmentText({ buffer: Buffer.from('x'), contentType: 'text/plain', filename: null });
		expect(reset.status).toBe('done');
	});

	it('never throws when a custom extractor throws', async () => {
		setOcrExtractor(async () => {
			throw new Error('extractor exploded');
		});
		await expect(
			extractAttachmentText({ buffer: Buffer.from('x'), contentType: 'text/plain', filename: null }),
		).resolves.toEqual({ status: 'failed', text: null });
	});
});

describe('ocr: an upload is never failed by extraction', () => {
	it('stores the attachment with an unavailable status', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'ocr-unavailable@example.com', password: 'StrongP4ss!', firstName: 'Ocr', lastName: 'Test',
		});
		const token = reg.body.token as string;
		const asset = await call('POST', token, '/api/v1/home-assets', { name: 'The Mazda', category: 'vehicle' });

		setOcrExtractor(async () => ({ status: 'unavailable', text: null }));
		const up = await upload(token, 'asset', asset.body.asset.id, 'manual.pdf', 'not-really-a-pdf', 'application/pdf');
		expect(up.status).toBe(201);
		expect(up.body.attachment.ocrStatus).toBe('unavailable');
		expect(up.body.attachment.ocrText).toBeNull();
	});

	it('stores the attachment with a failed status', async () => {
		const reg = await call('POST', '', '/api/v1/auth/register', {
			email: 'ocr-failed@example.com', password: 'StrongP4ss!', firstName: 'Ocr', lastName: 'Fail',
		});
		const token = reg.body.token as string;
		const asset = await call('POST', token, '/api/v1/home-assets', { name: 'The Truck', category: 'vehicle' });

		setOcrExtractor(async () => ({ status: 'failed', text: null }));
		const up = await upload(token, 'asset', asset.body.asset.id, 'receipt.pdf', 'bytes', 'application/pdf');
		expect(up.status).toBe(201);
		expect(up.body.attachment.ocrStatus).toBe('failed');
		expect(up.body.attachment.ocrText).toBeNull();
	});
});

describe('ocr: content-type sniffing', () => {
	it('reads the magic bytes rather than trusting a vague claim', () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		expect(sniffContentType(jpeg, 'application/octet-stream', 'IMG_4821.jpg')).toBe('image/jpeg');

		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(sniffContentType(png, null, null)).toBe('image/png');

		const gif = Buffer.from('GIF89a------', 'ascii');
		expect(sniffContentType(gif, 'application/octet-stream', null)).toBe('image/gif');

		const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
		expect(sniffContentType(webp, 'application/octet-stream', null)).toBe('image/webp');

		const pdf = Buffer.from('%PDF-1.7\n', 'ascii');
		expect(sniffContentType(pdf, 'application/octet-stream', null)).toBe('application/pdf');
	});

	it('keeps a specific claim and falls back to the filename', () => {
		expect(sniffContentType(Buffer.from([0x00, 0x01]), 'image/heic', 'x.heic')).toBe('image/heic');
		expect(sniffContentType(Buffer.from([0x00, 0x01]), 'application/octet-stream', 'receipt.JPEG')).toBe('image/jpeg');
		expect(sniffContentType(Buffer.from([0x00, 0x01]), null, 'notes.txt')).toBe('text/plain');
		expect(sniffContentType(Buffer.from([0x00, 0x01]), null, 'mystery.bin')).toBe('application/octet-stream');
	});

	it('still OCRs an image that arrives mislabelled as octet-stream', async () => {
		const png = embedPngText(PNG_BYTES, 'Cabin air filter replaced');
		const result = await extractAttachmentText({
			buffer: png,
			contentType: 'application/octet-stream',
			filename: 'IMG_0001.jpg',
		});
		expect(result.status).toBe('done');
		expect(result.text).toContain('Cabin air filter replaced');
	});
});
