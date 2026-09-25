// Minimal RFC-4180-style CSV parser for the known Narababy export format.
// Splits on commas with double-quote escaping, handles BOM + CRLF + embedded
// commas/newlines in quoted fields, and "escaped" quote pairs ("").

export type CsvRow = string[];

export function parseCsvLines(text: string): CsvRow[] {
	const lines: CsvRow[] = [];
	const field = new Array<string>();
	let cur = '';
	let inQuotes = false;
	const src = text.replace(/^\uFEFF/, '');

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			field.push(cur);
			cur = '';
		} else if (ch === '\n') {
			field.push(cur);
			cur = '';
			lines.push(field.splice(0, field.length));
		} else if (ch === '\r') {
			// strip CR; rely on \n for row breaks (CRLF handled)
		} else {
			cur += ch;
		}
	}

	if (cur.length > 0 || field.length > 0) {
		field.push(cur);
		lines.push(field);
	}

	return lines.filter((r) => {
		return r.length > 0 && !(r.length === 1 && (r[0] ?? '').trim() === '');
	});
}

export function headerToMap(header: CsvRow): Map<string, number> {
	const m = new Map<string, number>();
	for (let i = 0; i < header.length; i++) {
		const col = header[i];
		if (col !== undefined) m.set(col.trim(), i);
	}
	return m;
}

export function rowToRecord(header: CsvRow, row: CsvRow): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < header.length; i++) {
		const col = header[i];
		if (col !== undefined) out[col.trim()] = (row[i] ?? '').trim();
	}
	return out;
}