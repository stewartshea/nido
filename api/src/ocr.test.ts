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
	setOcrExtractor,
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
