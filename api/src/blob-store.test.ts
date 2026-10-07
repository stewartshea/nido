// src/blob-store.test.ts
//
// These tests are as much about the tenancy boundary as the round trip. A blob
// store that encrypts correctly but can be made to open another family's file is
// worse than one that does not encrypt at all, because it looks safe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import path from 'node:path';

let root = '';
let store: import('./blob-store').EncryptedBlobStore;
let storageKey: typeof import('./blob-store').storageKey;

const FAMILY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FAMILY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const collect = async (r: Readable): Promise<Buffer> => {
	const chunks: Buffer[] = [];
	for await (const c of r) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
};

beforeAll(async () => {
	root = mkdtempSync(path.join(os.tmpdir(), 'nido-blob-test-'));
	process.env.NIDO_MASTER_KEY = 'a'.repeat(64);
	process.env.NIDO_BLOB_DIR = root;
	const mod = await import('./blob-store');
	store = mod.EncryptedBlobStore.fromEnv();
	storageKey = mod.storageKey;
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.NIDO_BLOB_DIR;
});

describe('blob store: the round trip', () => {
	it('returns exactly the bytes that went in', async () => {
		const payload = Buffer.from('vaccination report, page one', 'utf8');
		const put = await store.put(FAMILY_A, Readable.from([payload]));

		expect(put.size).toBe(payload.length);
		const back = await collect(await store.open(FAMILY_A, put.blobId, new Date(put.createdAt)));
		expect(back.equals(payload)).toBe(true);
	});

	it('handles a payload that spans several chunks', async () => {
		const payload = Buffer.alloc(300_000);
		for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
		const put = await store.put(FAMILY_A, Readable.from([payload.subarray(0, 100_000), payload.subarray(100_000)]));
		const back = await collect(await store.open(FAMILY_A, put.blobId, new Date(put.createdAt)));
		expect(back.length).toBe(payload.length);
		expect(back.equals(payload)).toBe(true);
	});

	it('reports the digest of the plaintext, not the ciphertext', async () => {
		const payload = Buffer.from('digest me', 'utf8');
		const put = await store.put(FAMILY_A, Readable.from([payload]));
		const { createHash } = await import('node:crypto');
		expect(put.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
	});

	it('reports absence rather than throwing for an unknown blob', async () => {
		const missing = 'cccccccc-3333-4333-8333-cccccccccccc';
		expect(await store.exists(FAMILY_A, missing, new Date())).toBe(false);
		await expect(store.open(FAMILY_A, missing, new Date())).rejects.toThrow(/not found/i);
	});
});

describe('blob store: what lands on disk', () => {
	it('never contains the plaintext', async () => {
		const secret = 'THE-PLAINTEXT-MUST-NOT-APPEAR';
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from(secret, 'utf8')]));
		const onDisk = readFileSync(path.join(root, put.storageKey));
		expect(onDisk.includes(Buffer.from(secret, 'utf8'))).toBe(false);
		expect(onDisk.subarray(0, 4).toString('ascii')).toBe('NIDB');
	});

	it('writes nothing but the blob — no temp file is left behind', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('atomic', 'utf8')]));
		const dir = path.dirname(path.join(root, put.storageKey));
		expect(readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
	});

	it('fans out by month so one directory does not hold everything', () => {
		const key = storageKey(FAMILY_A, 'dddddddd-4444-4444-8444-dddddddddddd', new Date('2026-03-09T00:00:00Z'));
		expect(key).toBe(`blobs/${FAMILY_A}/2026/03/dddddddd-4444-4444-8444-dddddddddddd.bin`);
	});
});

describe('blob store: the tenancy boundary', () => {
	it('will not open one family\u2019s blob under another family\u2019s id', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('family A only', 'utf8')]));
		// Same blobId, same date, wrong family: a different derived key and a
		// different storage key, so it must not resolve at all.
		await expect(store.open(FAMILY_B, put.blobId, new Date(put.createdAt))).rejects.toThrow(/not found/i);
	});

	it('rejects a blob relocated into another family\u2019s path', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('relocate me', 'utf8')]));
		const createdAt = new Date(put.createdAt);
		const target = storageKey(FAMILY_B, put.blobId, createdAt);

		// Simulate an operator copying the file into B's directory. It is
		// readable and the id is valid, so only the AAD binding stands in the way.
		const { mkdirSync } = await import('node:fs');
		const dest = path.join(root, target);
		mkdirSync(path.dirname(dest), { recursive: true });
		writeFileSync(dest, readFileSync(path.join(root, put.storageKey)));

		const stream = await store.open(FAMILY_B, put.blobId, createdAt);
		await expect(collect(stream)).rejects.toThrow();
	});

	it('refuses a family id that could escape the root', async () => {
		expect(() => storageKey('../../etc', 'dddddddd-4444-4444-8444-dddddddddddd', new Date())).toThrow(/Invalid familyId/);
		await expect(store.put('../evil', Readable.from([Buffer.from('x')]))).rejects.toThrow(/Invalid familyId/);
	});
});

describe('blob store: refusing damaged input', () => {
	// A cut into the trailing tag fails authentication rather than length, and a
	// cut before the header fails length. Both must refuse the bytes; which error
	// surfaces depends only on where the cut lands, so neither is pinned.
	it('refuses a blob cut into the tag', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('truncate me please', 'utf8')]));
		const full = path.join(root, put.storageKey);
		const bytes = readFileSync(full);
		writeFileSync(full, bytes.subarray(0, bytes.length - 8));

		const stream = await store.open(FAMILY_A, put.blobId, new Date(put.createdAt));
		await expect(collect(stream)).rejects.toThrow();
	});

	it('refuses a blob too short to hold a header', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('short', 'utf8')]));
		writeFileSync(path.join(root, put.storageKey), Buffer.from('NID'));
		await expect(store.open(FAMILY_A, put.blobId, new Date(put.createdAt))).rejects.toThrow(/truncated/i);
	});

	it('refuses a payload altered in the middle', async () => {
		const payload = Buffer.alloc(4096, 7);
		const put = await store.put(FAMILY_A, Readable.from([payload]));
		const full = path.join(root, put.storageKey);
		const bytes = readFileSync(full);
		bytes[bytes.length - 40] ^= 0xff;   // flip a ciphertext bit
		writeFileSync(full, bytes);

		const stream = await store.open(FAMILY_A, put.blobId, new Date(put.createdAt));
		await expect(collect(stream)).rejects.toThrow();
	});

	it('rejects a file that is not a Nido blob', async () => {
		const put = await store.put(FAMILY_A, Readable.from([Buffer.from('fine', 'utf8')]));
		writeFileSync(path.join(root, put.storageKey), Buffer.from('this is a plain jpeg, not a blob'));
		await expect(store.open(FAMILY_A, put.blobId, new Date(put.createdAt))).rejects.toThrow(/not a Nido blob/i);
	});

	it('enforces the size ceiling while streaming, not after', async () => {
		const big = Buffer.alloc(5_000);
		await expect(
			store.put(FAMILY_A, Readable.from([big]), { maxBytes: 1_000 }),
		).rejects.toThrow(/exceeds/);
	});
});
