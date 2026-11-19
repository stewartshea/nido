// api/src/ocr.ts
//
// HOME module milestone 5 (issue #69, PRD §7.2): best-effort text extraction
// for attachments, so a receipt or a scanned manual becomes searchable.
//
// The whole module is written on one rule: text extraction NEVER fails an
// upload. Every path returns an OcrResult describing what happened, and an
// unexpected throw is caught here rather than allowed to bubble into the
// request that is storing the file. The status is what the UI reads to decide
// whether to show a "Not searchable" badge.
//
// Extraction is deliberately layered, cheapest and most reliable first, and
// degrades rather than giving up:
//   text      — decoded directly.
//   PDF       — pdftotext, then a pure-TypeScript stream parser, then a
//               pdftoppm + tesseract OCR of the first pages.
//   images    — tesseract, with an embedded PNG tEXt/iTXt chunk as a fallback
//               so a fixture can carry searchable text even without tesseract.
//   anything  — 'unavailable', which is an honest answer, not a failure.
//
// No npm dependency is used: every external tool is a binary already present
// in the image (see api/Dockerfile) and every fallback is a Node built-in.
import { execFile, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync, unzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

export type OcrStatus = 'done' | 'empty' | 'unavailable' | 'failed';

export interface OcrResult {
	status: OcrStatus;
	text: string | null;
}

export interface OcrInput {
	buffer: Buffer;
	contentType: string;
	filename: string | null;
}

export type OcrExtractor = (input: OcrInput) => Promise<OcrResult>;

/** A hard ceiling so a pathological PDF cannot fill the row. */
const MAX_TEXT = 100_000;

/**
 * A test seam: when set, extraction is delegated entirely to the override, so
 * a test can assert the 'unavailable' and 'failed' branches deterministically
 * without depending on which binaries happen to be installed on the runner.
 */
let customExtractor: OcrExtractor | null = null;

export function setOcrExtractor(custom: OcrExtractor | null): void {
	customExtractor = custom;
}

/**
 * The one entry point the upload path calls. It can never throw: any error,
 * from a custom override or from a parser, is reported as 'failed'.
 */
export async function extractAttachmentText(input: OcrInput): Promise<OcrResult> {
	try {
		if (customExtractor) {
			const result = await customExtractor(input);
			return { status: result.status, text: result.text ?? null };
		}
		return await extract(input);
	} catch {
		return { status: 'failed', text: null };
	}
}

async function extract(input: OcrInput): Promise<OcrResult> {
	const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer);
	const contentType = (input.contentType ?? '').toLowerCase();
	const filename = (input.filename ?? '').toLowerCase();

	if (contentType.startsWith('text/') || filename.endsWith('.txt')) {
		return fromText(buffer.toString('utf8'));
	}

	if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
		return extractPdf(buffer);
	}

	if (contentType.startsWith('image/')) {
		return extractImage(buffer);
	}

	return { status: 'unavailable', text: null };
}

/** Normalize raw text and decide done vs empty. */
function fromText(raw: string | null | undefined): OcrResult {
	const text = normalizeText(raw);
	return text ? { status: 'done', text } : { status: 'empty', text: null };
}

/**
 * Collapse runs of whitespace, blank lines and NULs into something a search
 * query can match against, then cap it. Newlines are kept because a receipt's
 * line structure is often the only separator between fields.
 */
export function normalizeText(raw: string | null | undefined): string {
	if (!raw) return '';
	return raw
		.replace(/\r\n?/g, '\n')
		.replace(/\u0000/g, '')
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{2,}/g, '\n')
		.trim()
		.slice(0, MAX_TEXT);
}

/**
 * Combine two Tesseract passes over the same page.
 *
 * The default `--psm 3` pass understands a whole page and is the better text,
 * but it can drop a table row that touches a horizontal rule (it reads the
 * rule as the row above). A `--psm 6` pass treats the page as one uniform
 * block, which usually recovers that row but scrambles the surrounding
 * columns. So `--psm 3` stays the primary text, in its original order, and any
 * line from `--psm 6` that carries a token the primary did not already read is
 * appended. A line whose words are all known adds nothing, which is what keeps
 * a 2-column manual from being duplicated wholesale.
 */
export function mergeOcrPasses(primary: string, secondary: string): string {
	const first = normalizeText(primary);
	const second = normalizeText(secondary);
	if (!first) return second;
	if (!second) return first;

	const seen = new Set(first.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
	const recovered: string[] = [];
	for (const line of second.split('\n')) {
		const tokens = line.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
		// Only recover a line that teaches us at least one new word.
		if (!tokens.some((token) => !seen.has(token))) continue;
		if (recovered.includes(line)) continue;
		recovered.push(line);
		for (const token of tokens) seen.add(token);
	}

	return recovered.length ? `${first}\n${recovered.join('\n')}` : first;
}

// ---------------------------------------------------------------------------
// Receipt hints
// ---------------------------------------------------------------------------
//
// Automatic maintenance logging starts from the receipt text. The pages of a
// multi-page receipt are OCR'd independently, so a header (and its date) often
// lives on page one while the itemized total lives on page two. These helpers
// read the combined text and make one best guess at what happened, when, and
// what it cost — a starting point a person confirms, never a fact asserted on
// its own.

export interface ReceiptHints {
	task: string;
	scheduleId: number | null;
	performedAt: string;
	/** Cents, or null when no unambiguous total was found. */
	cost: number | null;
	notes: string | null;
	/** Combined OCR text across all uploaded pages. */
	combinedText: string | null;
}

const ISO_DATE = /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const SLASH_DATE = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/((?:19|20)\d{2})\b/;
const NAMED_DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})/i;

const LABELLED_TOTAL = /(?:grand\s*total|invoice\s*total|total\s*due|amount\s*due|balance\s*due|total\s*paid|subtotal|(?:^|\s)total|(?:^|\s)otal|payments?(?:\s*received)?|amount\s*paid)\s*[:$-]*\s*\$?\s*(\d{1,6}(?:,\d{3})*\.\d{2})\b/gim;
const DOLLAR_AMOUNT = /\$\s*(\d{1,6}(?:,\d{3})*\.\d{2})\b/g;

const MONTH_NUMBERS: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
	jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** What OCR commonly says, and the task name it maps to, in priority order. */
const COMMON_TASKS: ReadonlyArray<{ pattern: RegExp; task: string }> = [
	{ pattern: /brake\s*(?:pad|rotor|caliper|fluid|shoe|service|inspection|job|replacement)s?/i, task: 'Brake service' },
	{ pattern: /oil\s*(?:and\s*filter\s*)?change|synthetic\s*\d+w-?\d+/i, task: 'Oil change' },
	{ pattern: /tire\s*(?:rotation|swap|change|mount|balance|replacement)/i, task: 'Tire service' },
	{ pattern: /wheel\s*alignment/i, task: 'Wheel alignment' },
	{ pattern: /battery\s*(?:replacement|install|service|test)/i, task: 'Battery service' },
	{ pattern: /air\s*filter|cabin\s*filter|furnace\s*filter|filter\s*(?:replacement|change)/i, task: 'Filter replacement' },
	{ pattern: /coolant\s*(?:flush|service)|antifreeze/i, task: 'Coolant service' },
	{ pattern: /transmission\s*(?:fluid|flush|service)/i, task: 'Transmission service' },
	{ pattern: /spark\s*plug/i, task: 'Spark plug replacement' },
	{ pattern: /wiper\s*blade/i, task: 'Wiper blade replacement' },
];

/** A real calendar date as YYYY-MM-DD, or null when the parts are not a day. */
function isoIfValid(year: number, month: number, day: number): string | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return null;
	}
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first readable date in the text, trying the unambiguous shapes first. */
function findDate(text: string): string | null {
	const iso = text.match(ISO_DATE);
	if (iso) {
		const date = isoIfValid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
		if (date) return date;
	}
	const slash = text.match(SLASH_DATE);
	if (slash) {
		const date = isoIfValid(Number(slash[3]), Number(slash[1]), Number(slash[2]));
		if (date) return date;
	}
	const named = text.match(NAMED_DATE);
	const monthName = named?.[1];
	if (monthName) {
		const month = MONTH_NUMBERS[monthName.slice(0, 3).toLowerCase()];
		if (month) {
			const date = isoIfValid(Number(named?.[3]), month, Number(named?.[2]));
			if (date) return date;
		}
	}
	return null;
}

/** `"1,234.50"` -> `123450` cents, or null when it cannot be parsed. */
function toCents(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseFloat(value.replace(/,/g, ''));
	return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * A task name from a file's own name, when it is descriptive. A camera or
 * scanner default (`IMG_4821.pdf`, `scan-0001.pdf`) carries no meaning, so it
 * is rejected rather than turned into a task like "Img 4821".
 */
function taskFromFilename(name: string): string | null {
	const base = name.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').trim();
	if (!/[a-z]/i.test(base)) return null;
	// Camera, phone, screenshot and messaging app defaults carry no meaning.
	if (/^(?:img|dsc|pxl|mvimg|whatsapp\s*image|screenshot|signal|photo|image|picture|scan|receipt|document|file|page)\b/i.test(base)) {
		return null;
	}
	return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Opening lines that describe a field, not the merchant or service. */
const HEADER_STOPWORDS = [
	'bill to', 'ship to', 'invoice', 'date', 'tel', 'phone', 'http', 'www',
	'qty', 'description', 'price', 'total', 'subtotal', 'thank you',
];

/**
 * A merchant or document title from the top of the text.
 *
 * A photographed receipt often opens with the business name, which is a far
 * better task label than the camera's filename (`IMG_4821.jpeg`). Only the
 * first few lines are considered, and address, phone, date and column-header
 * lines are skipped so the guess lands on the name.
 */
function headerFromText(combined: string): string | null {
	const lines = combined
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, 5);
	for (const line of lines) {
		if (line.length < 3 || line.length > 60) continue;
		if (!/[a-z]/i.test(line)) continue;
		const lower = line.toLowerCase();
		if (HEADER_STOPWORDS.some((word) => lower.startsWith(word))) continue;
		// Addresses and postal codes start with a digit; a phone number is
		// mostly digits. Neither names the merchant.
		if (/^[\d(#]/.test(line)) continue;
		if (/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(line)) continue;
		const digits = (line.match(/\d/g) ?? []).length;
		const letters = (line.match(/[a-z]/gi) ?? []).length;
		if (digits > letters) continue;
		return line;
	}
	return null;
}

/**
 * Read the OCR text of every page of a receipt and guess the log entry it
 * describes.
 *
 * The order is deliberate: a schedule the family already tracks is the most
 * specific answer, so it wins over a generic pattern; a known task pattern
 * beats a guess from the file name; and a labeled total beats the largest
 * dollar figure on the page. Nothing here is destructive — the caller shows
 * these hints for confirmation.
 */
export function parseReceiptHints(input: {
	texts: (string | null | undefined)[];
	filenames?: (string | null | undefined)[];
	schedules?: ReadonlyArray<{ id: number; task: string }>;
	today: string;
}): ReceiptHints {
	const parts = input.texts
		.filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
		.map((text) => text.trim());
	const combined = parts.join('\n\n');
	const combinedText = combined || null;
	const lower = combined.toLowerCase();

	const performedAt = findDate(combined) ?? input.today;

	let scheduleId: number | null = null;
	let task = '';
	for (const schedule of input.schedules ?? []) {
		const scheduleTask = String(schedule.task ?? '').trim();
		if (!scheduleTask) continue;
		const matchesWhole = lower.includes(scheduleTask.toLowerCase());
		const words = scheduleTask.split(/\s+/).filter((word) => word.length >= 4);
		const matchesWords = words.length > 0 && words.every((word) => lower.includes(word.toLowerCase()));
		if (matchesWhole || matchesWords) {
			scheduleId = schedule.id;
			task = schedule.task;
			break;
		}
	}

	if (!task) {
		const matches: string[] = [];
		for (const { pattern, task: label } of COMMON_TASKS) {
			if (matches.length >= 2) break;
			if (pattern.test(combined) && !matches.includes(label)) matches.push(label);
		}
		if (matches.length) task = matches.join(' & ');
	}

	if (!task) {
		const filename = (input.filenames ?? []).find(
			(name): name is string => typeof name === 'string' && name.trim().length > 0,
		);
		task =
			(filename ? taskFromFilename(filename) : null) ??
			headerFromText(combined) ??
			'Maintenance receipt';
	}

	let cost: number | null = null;
	// A `$0.00` total on a receipt with real charges is almost always the tax
	// line or the balance left after payment (e.g. `Patient Balance: $0.00`),
	// so a positive labelled amount wins. OCR of a multi-column layout also
	// splits the label (`otal: $130.50`), which the broadened pattern catches.
	const labelled = [...combined.matchAll(LABELLED_TOTAL)]
		.map((match) => toCents(match[1]))
		.filter((value): value is number => value !== null);
	const positiveLabelled = labelled.filter((value) => value > 0);
	if (positiveLabelled.length) {
		cost = positiveLabelled[positiveLabelled.length - 1] ?? null;
	} else {
		const amounts = [...combined.matchAll(DOLLAR_AMOUNT)]
			.map((match) => toCents(match[1]))
			.filter((value): value is number => value !== null)
			.filter((value) => value > 0);
		if (amounts.length) {
			cost = Math.max(...amounts);
		} else if (labelled.length) {
			cost = labelled[labelled.length - 1] ?? 0;
		}
	}

	const notes = combined ? combined.slice(0, 500) : null;

	return { task, scheduleId, performedAt, cost, notes, combinedText };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function extractPdf(buffer: Buffer): Promise<OcrResult> {
	// A real PDF starts with the magic comment. A file that carries PDF
	// metadata but does not (a fixture, or a plain-text export renamed .pdf) is
	// read as text instead — which is the honest, useful answer.
	if (!isPdf(buffer)) {
		const text = normalizeText(printableText(buffer));
		return text ? { status: 'done', text } : { status: 'empty', text: null };
	}

	// 1. pdftotext — the high-fidelity path when poppler is present.
	const viaBinaries = normalizeText(await runPdftotext(buffer));
	if (viaBinaries) return { status: 'done', text: viaBinaries };

	// 2. Pure-TypeScript stream parser — no binaries required, works for the
	//    common uncompressed / FlateDecode text operators.
	const viaStreams = normalizeText(extractPdfTextFromStreams(buffer));
	if (viaStreams) return { status: 'done', text: viaStreams };

	// 3. Rasterize the first pages and OCR them — the scanned-receipt path.
	const viaRaster = normalizeText(await ocrPdfPages(buffer));
	if (viaRaster) return { status: 'done', text: viaRaster };

	return { status: 'empty', text: null };
}

function isPdf(buffer: Buffer): boolean {
	return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Text from a buffer that is not really a PDF. Reject anything with a NUL
 * byte (a binary masquerading as a PDF) so the answer is never produced from
 * compressed garbage.
 */
function printableText(buffer: Buffer): string {
	if (buffer.includes(0)) return '';
	return buffer.toString('utf8');
}

async function runPdftotext(buffer: Buffer): Promise<string> {
	const result = await run('pdftotext', ['-', '-'], { timeout: 10_000, input: buffer });
	return result.ok ? result.stdout : '';
}

/**
 * Extract text from a PDF's content streams without an external binary.
 *
 * Scans for `stream` … `endstream` blocks, inflates them when they are
 * FlateDecode (both zlib and raw-deflate are tried), and pulls text out of the
 * `Tj`, `TJ` and `'` operators.
 */
export function extractPdfTextFromStreams(buffer: Buffer): string {
	const raw = buffer.toString('latin1');
	const pieces: string[] = [];
	let index = 0;
	while (index < raw.length) {
		const start = raw.indexOf('stream', index);
		if (start === -1) break;
		// `indexOf('stream')` also matches inside `endstream`; the keyword we
		// want is never preceded by the 'd' of the terminator.
		if (raw[start - 1] === 'd') {
			index = start + 6;
			continue;
		}
		let dataStart = start + 'stream'.length;
		if (raw[dataStart] === '\r') dataStart += 1;
		if (raw[dataStart] === '\n') dataStart += 1;
		const end = raw.indexOf('endstream', dataStart);
		if (end === -1) break;
		const bytes = Buffer.from(raw.slice(dataStart, end), 'latin1');
		const decoded = decodeStream(bytes);
		const text = extractTextOperators(decoded);
		if (text) pieces.push(text);
		index = end + 'endstream'.length;
	}
	return pieces.join('\n');
}

/** Inflate a stream block when compressed, else read it as Latin-1. */
function decodeStream(bytes: Buffer): string {
	const trimmed = trimTrailingEol(bytes);
	for (const candidate of [bytes, trimmed]) {
		try {
			return inflateSync(candidate).toString('latin1');
		} catch {
			/* not zlib */
		}
		try {
			return unzipSync(candidate).toString('latin1');
		} catch {
			/* not raw deflate */
		}
	}
	return bytes.toString('latin1');
}

function trimTrailingEol(bytes: Buffer): Buffer {
	let end = bytes.length;
	while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end -= 1;
	return bytes.subarray(0, end);
}

/**
 * Walk a decoded content stream and collect the strings the text operators
 * show. `(...) Tj`, `[...] TJ` and `(...) '` are the three the PRD names; each
 * becomes one line, with the pieces of a TJ array concatenated (the numbers
 * between them are kerning, not characters).
 */
function extractTextOperators(content: string): string {
	const lines: string[] = [];
	let i = 0;
	while (i < content.length) {
		const ch = content[i];
		if (ch === '(') {
			const { text, next } = readLiteralString(content, i);
			i = next;
			if (nextOperator(content, i)) lines.push(text);
		} else if (ch === '[') {
			const { text, next } = readArray(content, i);
			i = next;
			if (nextOperator(content, i)) lines.push(text);
		} else {
			i += 1;
		}
	}
	return lines.join('\n');
}

/** The operator immediately following a string operand, or '' for none. */
function nextOperator(content: string, start: number): string {
	let i = start;
	while (i < content.length && /\s/.test(content[i] ?? '')) i += 1;
	let j = i;
	while (j < content.length && /[A-Za-z'"*]/.test(content[j] ?? '')) j += 1;
	const op = content.slice(i, j);
	return op === 'Tj' || op === 'TJ' || op === "'" || op === '"' ? op : '';
}

function readLiteralString(content: string, start: number): { text: string; next: number } {
	let i = start + 1;
	let depth = 1;
	let out = '';
	while (i < content.length) {
		const ch = content[i];
		if (ch === '\\') {
			const [decoded, next] = decodeEscape(content, i);
			out += decoded;
			i = next;
			continue;
		}
		if (ch === '(') {
			depth += 1;
			out += ch;
			i += 1;
			continue;
		}
		if (ch === ')') {
			depth -= 1;
			i += 1;
			if (depth === 0) break;
			out += ch;
			continue;
		}
		out += ch;
		i += 1;
	}
	return { text: out, next: i };
}

function readArray(content: string, start: number): { text: string; next: number } {
	let i = start + 1;
	let depth = 1;
	let out = '';
	while (i < content.length) {
		const ch = content[i];
		if (ch === '(') {
			const { text, next } = readLiteralString(content, i);
			out += text;
			i = next;
			continue;
		}
		if (ch === '[') {
			depth += 1;
			i += 1;
			continue;
		}
		if (ch === ']') {
			depth -= 1;
			i += 1;
			if (depth === 0) break;
			continue;
		}
		i += 1;
	}
	return { text: out, next: i };
}

function decodeEscape(content: string, i: number): [string, number] {
	const next = content[i + 1];
	if (next === undefined) return ['', i + 1];
	switch (next) {
		case 'n': return ['\n', i + 2];
		case 'r': return ['\r', i + 2];
		case 't': return ['\t', i + 2];
		case 'b': return ['\b', i + 2];
		case 'f': return ['\f', i + 2];
		case '(': return ['(', i + 2];
		case ')': return [')', i + 2];
		case '\\': return ['\\', i + 2];
		case '\n': return ['', i + 2];
		case '\r': return ['', content[i + 2] === '\n' ? i + 3 : i + 2];
		default: {
			if (next >= '0' && next <= '7') {
				let oct = '';
				let j = i + 1;
				while (j < content.length && oct.length < 3) {
					const c = content[j];
					if (c === undefined || c < '0' || c > '7') break;
					oct += c;
					j += 1;
				}
				return [String.fromCharCode(parseInt(oct, 8)), j];
			}
			return [next, i + 2];
		}
	}
}

/**
 * A scanned PDF has no text operators, so the pages are rasterized and OCR'd.
 * Up to ten pages are attempted: a multi-page receipt is common (a statement,
 * an itemized invoice and a payment slip), and capping too low silently drops
 * the page that carries the total.
 */
async function ocrPdfPages(buffer: Buffer): Promise<string> {
	const dir = join(tmpdir(), `nido-ocr-${randomBytes(8).toString('hex')}`);
	const pdfPath = join(dir, 'input.pdf');
	const prefix = join(dir, 'page');
	try {
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(pdfPath, buffer);
		const raster = await run('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '10', pdfPath, prefix], { timeout: 30_000 });
		if (!raster.ok) return '';
		const files = (await fs.readdir(dir)).filter((name) => name.startsWith('page') && name.endsWith('.png')).sort();
		const texts: string[] = [];
		for (const file of files) {
			const pngPath = join(dir, file);
			// `--psm 3` reads the page as a whole; `--psm 6` is the fallback that
			// recovers a table row touching a divider. Merge the two per page.
			const psm3 = await run('tesseract', [pngPath, 'stdout', '-l', 'eng', '--psm', '3'], { timeout: 15_000 });
			if (!psm3.ok) continue;
			const psm6 = await run('tesseract', [pngPath, 'stdout', '-l', 'eng', '--psm', '6'], { timeout: 15_000 });
			const merged = psm6.ok ? mergeOcrPasses(psm3.stdout, psm6.stdout) : psm3.stdout;
			if (merged.trim()) texts.push(merged);
		}
		return texts.join('\n');
	} catch {
		return '';
	} finally {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function extractImage(buffer: Buffer): Promise<OcrResult> {
	const embedded = isPng(buffer) ? normalizeText(extractPngTextChunks(buffer)) : '';
	const tesseract = await runTesseract(buffer);

	// tesseract not installed — an embedded chunk is still a real answer.
	if (!tesseract.ok && tesseract.missing) {
		return embedded ? { status: 'done', text: embedded } : { status: 'unavailable', text: null };
	}
	// tesseract ran but failed — an honest failure, not a fake success.
	if (!tesseract.ok) {
		return { status: 'failed', text: null };
	}
	const text = normalizeText(tesseract.stdout);
	if (text) return { status: 'done', text };
	if (embedded) return { status: 'done', text: embedded };
	return { status: 'empty', text: null };
}

type RunResult =
	| { ok: true; stdout: string }
	| { ok: false; missing: boolean };

function runTesseract(buffer: Buffer): Promise<RunResult> {
	return (async () => {
		const file = join(tmpdir(), `nido-ocr-${randomBytes(8).toString('hex')}.png`);
		try {
			await fs.writeFile(file, buffer);
			const psm3 = await run('tesseract', [file, 'stdout', '-l', 'eng', '--psm', '3'], { timeout: 15_000 });
			if (!psm3.ok) return { ok: false, missing: psm3.missing };
			// The second pass is a supplement, never a reason to fail: if it does
			// not run, the primary text is still a good answer.
			const psm6 = await run('tesseract', [file, 'stdout', '-l', 'eng', '--psm', '6'], { timeout: 15_000 });
			const merged = psm6.ok ? mergeOcrPasses(psm3.stdout, psm6.stdout) : psm3.stdout;
			return { ok: true, stdout: merged };
		} catch {
			return { ok: false, missing: false };
		} finally {
			await fs.rm(file, { force: true }).catch(() => {});
		}
	})();
}

// ---------------------------------------------------------------------------
// PNG embedded text (tEXt / iTXt)
// ---------------------------------------------------------------------------

function isPng(buffer: Buffer): boolean {
	return (
		buffer.length >= 8 &&
		buffer.readUInt32BE(0) === 0x89504e47 &&
		buffer.readUInt32BE(4) === 0x0d0a1a0a
	);
}

/**
 * Text carried in a PNG's `tEXt` and `iTXt` chunks.
 *
 * This is not a general OCR path — it exists so a test can build a valid PNG
 * with searchable text and have it work on a machine with no tesseract, and so
 * an export that already embeds text is not thrown away.
 */
export function extractPngTextChunks(png: Uint8Array | Buffer): string {
	const buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
	if (!isPng(buffer)) return '';
	const parts: string[] = [];
	let offset = 8;
	while (offset + 8 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('latin1', offset + 4, offset + 8);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd > buffer.length) break;
		if (type === 'tEXt') {
			const data = buffer.subarray(dataStart, dataEnd);
			const nul = data.indexOf(0);
			const text = nul === -1 ? data.toString('latin1') : data.subarray(nul + 1).toString('latin1');
			if (text) parts.push(text);
		} else if (type === 'iTXt') {
			const text = parseITxt(buffer.subarray(dataStart, dataEnd));
			if (text) parts.push(text);
		}
		offset = dataEnd + 4; // skip the CRC
		if (type === 'IEND') break;
	}
	return parts.join('\n');
}

function parseITxt(data: Buffer): string {
	let idx = data.indexOf(0);
	if (idx === -1) return '';
	idx += 1; // past the keyword terminator
	if (idx + 2 > data.length) return '';
	const compressionFlag = data[idx];
	idx += 2; // past compression flag + method
	const langEnd = data.indexOf(0, idx);
	if (langEnd === -1) return '';
	idx = langEnd + 1;
	const translatedEnd = data.indexOf(0, idx);
	if (translatedEnd === -1) return '';
	idx = translatedEnd + 1;
	const textBytes = data.subarray(idx);
	if (compressionFlag === 1) {
		try {
			return inflateSync(textBytes).toString('utf8');
		} catch {
			return '';
		}
	}
	return textBytes.toString('utf8');
}

/**
 * Insert a `tEXt` chunk before IEND, producing a valid PNG that carries
 * searchable text. Exported so tests can build such a fixture.
 */
export function embedPngText(png: Uint8Array | Buffer, text: string): Buffer {
	const source = Buffer.isBuffer(png) ? png : Buffer.from(png);
	const chunkData = Buffer.concat([
		Buffer.from('Comment', 'latin1'),
		Buffer.from([0]),
		Buffer.from(text, 'latin1'),
	]);
	const type = Buffer.from('tEXt', 'latin1');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(chunkData.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([type, chunkData])), 0);
	const chunk = Buffer.concat([length, type, chunkData, crc]);

	const iendAt = findChunk(source, 'IEND');
	if (iendAt === -1) return Buffer.concat([source, chunk]);
	return Buffer.concat([source.subarray(0, iendAt), chunk, source.subarray(iendAt)]);
}

function findChunk(buffer: Buffer, wanted: string): number {
	let offset = 8;
	while (offset + 8 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('latin1', offset + 4, offset + 8);
		if (type === wanted) return offset;
		offset += 8 + length + 4;
	}
	return -1;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) {
		c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// A tiny execFile wrapper
// ---------------------------------------------------------------------------

interface ExecOutcome {
	ok: boolean;
	stdout: string;
	missing: boolean;
}

/**
 * Run a binary, feeding it `input` on stdin when given. Never rejects: a
 * missing binary is reported as `missing`, which is what lets the caller tell
 * "not installed" (unavailable) apart from "ran and failed" (failed).
 */
function run(
	command: string,
	args: string[],
	options: { timeout: number; input?: Buffer },
): Promise<ExecOutcome> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = execFile(
				command,
				args,
				{
					timeout: options.timeout,
					maxBuffer: 32 * 1024 * 1024,
					// OpenMP spawns one thread per core by default, which thrashes
					// a Kubernetes 200m CPU limit and makes tesseract take far
					// longer than a single-threaded run.
					env: { ...process.env, OMP_THREAD_LIMIT: '1' },
				},
				(err, stdout) => {
					if (err) {
						resolve({ ok: false, stdout: String(stdout ?? ''), missing: (err as NodeJS.ErrnoException).code === 'ENOENT' });
					} else {
						resolve({ ok: true, stdout: String(stdout ?? ''), missing: false });
					}
				},
			);
		} catch (err) {
			resolve({ ok: false, stdout: '', missing: (err as NodeJS.ErrnoException)?.code === 'ENOENT' });
			return;
		}
		if (options.input && child.stdin) {
			child.stdin.on('error', () => {});
			child.stdin.end(options.input);
		}
	});
}
