// blob-store.ts
//
// Attachment bytes for a family namespace.
//
// Two concerns are kept apart on purpose, because entangling them is how tenant
// boundaries get lost:
//
//   BlobBackend        raw byte storage addressed by a storage key. Local
//                      filesystem today, S3-compatible later. Knows nothing about
//                      encryption, so no backend can accidentally ship plaintext.
//
//   EncryptedBlobStore wraps a backend and is the only handle callers get, so a
//                      new backend cannot be wired up without the same sealing.
//
// The tenancy argument in one paragraph: the storage key embeds a familyId
// validated against FAMILY_ID_RE, the content key is derived from that same
// familyId, and the storage key is authenticated as AEAD associated data. Naming
// a different family therefore yields a different key, and relocating a blob to
// another family's path fails authentication instead of decrypting under a
// borrowed key. Path namespacing is the first gate, key derivation the second,
// AAD binding the third — any one alone would be thin.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import type { Writable } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertFamilyId, deriveKey, getDataDir, getMasterKeyHex } from './db-core';

/**
 * Frame: MAGIC(4) | VERSION(1) | IV(12) | ciphertext | TAG(16)
 *
 * One AEAD pass over the whole file rather than per-chunk tags: a single
 * construction to audit beats a more flexible one, and attachments are photos
 * and PDFs, not video. GCM emits its tag at the end, which is why reads hold
 * back the final 16 bytes until the stream is otherwise finished.
 */
const MAGIC = Buffer.from('NIDB', 'ascii');
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + IV_LEN;

const BLOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Key-derivation input, distinct from 'nido:db' so a blob subkey can never
 * decrypt a database or the reverse. Changing it re-derives every blob key and
 * makes existing attachments unreadable.
 */
const BLOB_KEY_INFO = 'nido:blobs';

export const DEFAULT_MAX_BLOB_BYTES = 25 * 1024 * 1024;

export interface PutResult {
	blobId: string;
	storageKey: string;
	size: number;
	/** Digest of the plaintext that was stored, never of the ciphertext. */
	sha256: string;
	createdAt: string;
}

export interface PutOptions {
	createdAt?: Date;
	maxBytes?: number;
}

function assertBlobId(blobId: string): void {
	if (!BLOB_ID_RE.test(blobId)) {
		throw new Error(`Invalid blobId "${blobId}"`);
	}
}

/**
 * Backend address of a blob. Fanned out by month: one flat directory with every
 * attachment in it becomes unusable on a filesystem once a family has thousands,
 * and the same shape works unchanged as an S3 key prefix.
 */
export function storageKey(familyId: string, blobId: string, createdAt: Date): string {
	assertFamilyId(familyId);
	assertBlobId(blobId);
	const y = createdAt.getUTCFullYear();
	const m = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
	return `blobs/${familyId}/${y}/${m}/${blobId}.bin`;
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export interface BlobBackend {
	readonly kind: string;
	/**
	 * A sink for this key, plus a promise for when the bytes are durable.
	 *
	 * Handing back a stream rather than accepting one keeps a single pipeline in
	 * charge of the write. A bridge stream owned by two pipelines gets destroyed
	 * by whichever finishes first, which shows up as an ABORT_ERR on the other.
	 */
	createWriteStream(key: string): Promise<{ stream: Writable; done: Promise<void> }>;
	/** Raw (still encrypted) bytes, or null when absent. */
	read(key: string): Promise<Readable | null>;
	remove(key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
}

/**
 * Local filesystem backend.
 *
 * NIDO_BLOB_DIR is deliberately separate from NIDO_DATA_DIR. SQLite over a
 * network filesystem is a corruption risk, so the database directory has to stay
 * local to a single replica, while attachment bytes carry no such constraint and
 * belong on a shared mount. Sharing one volume for both would tie them together
 * again and block scaling the API and web tiers independently.
 */
export class LocalBlobBackend implements BlobBackend {
	readonly kind = 'local';
	constructor(private readonly root: string) {}

	static fromEnv(): LocalBlobBackend {
		return new LocalBlobBackend(process.env.NIDO_BLOB_DIR || path.join(getDataDir(), 'blobs'));
	}

	private resolve(key: string): string {
		const base = path.resolve(this.root);
		const full = path.resolve(base, key);
		// Keys are built from validated ids, so this cannot escape; kept as a
		// backstop against a caller passing a hand-written key.
		if (full !== base && !full.startsWith(base + path.sep)) {
			throw new Error('Blob path escapes the blob root');
		}
		return full;
	}

	async createWriteStream(key: string): Promise<{ stream: Writable; done: Promise<void> }> {
		const full = this.resolve(key);
		await fsp.mkdir(path.dirname(full), { recursive: true });
		// A sibling temp file, so the rename below is atomic on one filesystem, and
		// 0600 because even ciphertext should not be world-readable.
		const tmp = `${full}.tmp-${randomUUID()}`;
		const stream = fs.createWriteStream(tmp, { mode: 0o600 });
		const done = new Promise<void>((resolve, reject) => {
			stream.on('error', reject);
			// 'finish' means every byte reached the file; only then is the blob
			// allowed to appear under its real name.
			stream.on('finish', () => {
				fsp.rename(tmp, full).then(resolve, reject);
			});
		}).catch(async (err) => {
			await fsp.rm(tmp, { force: true }).catch(() => {});
			throw err;
		});
		return { stream, done };
	}

	async read(key: string): Promise<Readable | null> {
		const full = this.resolve(key);
		try {
			await fsp.access(full, fs.constants.R_OK);
		} catch {
			return null;
		}
		return fs.createReadStream(full);
	}

	async remove(key: string): Promise<void> {
		await fsp.rm(this.resolve(key), { force: true });
	}

	async exists(key: string): Promise<boolean> {
		try {
			await fsp.access(this.resolve(key), fs.constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}
}

// ---------------------------------------------------------------------------
// Encrypted store
// ---------------------------------------------------------------------------

/** Emits a fixed prefix, then passes every subsequent chunk through untouched. */
class Prepend extends Transform {
	private sent = false;
	constructor(private readonly prefix: Buffer) {
		super();
	}
	override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
		if (this.sent) {
			cb(null, chunk);
			return;
		}
		this.sent = true;
		cb(null, Buffer.concat([this.prefix, chunk]));
	}
	override _flush(cb: TransformCallback): void {
		// An empty payload still needs the header, or the file would not be
		// recognisable as a blob at all.
		if (!this.sent) this.push(this.prefix);
		cb();
	}
}

/** Passes bytes through, then appends the AEAD tag once the cipher is done. */
class AppendTag extends Transform {
	constructor(private readonly cipher: CipherGCM) {
		super();
	}
	override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
		cb(null, chunk);
	}
	override _flush(cb: TransformCallback): void {
		try {
			this.push(this.cipher.getAuthTag());
			cb();
		} catch (err) {
			cb(err as Error);
		}
	}
}

/**
 * Removes the trailing 16-byte tag from the ciphertext and feeds the rest to the
 * decipher, holding the tag back until the end because GCM needs the tag before
 * it can produce its final bytes.
 */
class StripTag extends Transform {
	private held: Buffer[] = [];
	constructor(private readonly decipher: DecipherGCM) {
		super();
	}
	override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
		this.held.push(chunk);
		const buf = Buffer.concat(this.held);
		this.held = [];
		const cut = Math.max(0, buf.length - TAG_LEN);
		this.held = [buf.subarray(cut)];
		if (cut > 0) this.push(this.decipher.update(buf.subarray(0, cut)));
		cb();
	}
	override _flush(cb: TransformCallback): void {
		const tail = Buffer.concat(this.held);
		if (tail.length !== TAG_LEN) {
			cb(new Error('Attachment is truncated'));
			return;
		}
		try {
			this.decipher.setAuthTag(tail);
			this.push(this.decipher.final());
			cb();
		} catch (err) {
			cb(err as Error);
		}
	}
}

/** Enforces the size ceiling and digests the plaintext on its way through. */
class Meter extends Transform {
	size = 0;
	readonly digest = createHash('sha256');
	constructor(private readonly maxBytes: number) {
		super();
	}
	override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
		this.size += chunk.length;
		if (this.size > this.maxBytes) {
			cb(new Error(`Attachment exceeds the ${this.maxBytes} byte limit`));
			return;
		}
		this.digest.update(chunk);
		cb(null, chunk);
	}
}

export class EncryptedBlobStore {
	constructor(private readonly backend: BlobBackend) {}

	static fromEnv(): EncryptedBlobStore {
		return new EncryptedBlobStore(LocalBlobBackend.fromEnv());
	}

	private key(familyId: string): Buffer {
		return Buffer.from(deriveKey(getMasterKeyHex(), familyId, BLOB_KEY_INFO), 'hex');
	}

	async put(familyId: string, source: Readable, opts: PutOptions = {}): Promise<PutResult> {
		assertFamilyId(familyId);
		const createdAt = opts.createdAt ?? new Date();
		const blobId = randomUUID();
		const key = storageKey(familyId, blobId, createdAt);
		const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BLOB_BYTES;

		const iv = randomBytes(IV_LEN);
		const cipher = createCipheriv('aes-256-gcm', this.key(familyId), iv);
		// Binding the address into the AEAD is what makes a relocated blob fail.
		cipher.setAAD(Buffer.from(key, 'utf8'));

		// The header is plaintext and must not pass through the cipher, nor be
		// counted or digested as payload, so it is injected after the cipher:
		//   source -> meter -> cipher -> header+ct -> tag
		const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), iv]);
		const meter = new Meter(maxBytes);
		const { stream, done } = await this.backend.createWriteStream(key);
		try {
			await pipeline(source, meter, cipher, new Prepend(header), new AppendTag(cipher), stream);
			await done;
		} catch (err) {
			// Settle the backend side so a failed write cannot also surface as an
			// unhandled rejection, then report the real cause.
			await done.catch(() => {});
			throw err;
		}

		return {
			blobId,
			storageKey: key,
			size: meter.size,
			sha256: meter.digest.digest('hex'),
			createdAt: createdAt.toISOString(),
		};
	}

	/**
	 * Decrypted bytes. Decryption failures surface on the returned stream rather
	 * than as a rejection, because only the header is validated up front.
	 */
	async open(familyId: string, blobId: string, createdAt: Date): Promise<Readable> {
		assertFamilyId(familyId);
		assertBlobId(blobId);
		const key = storageKey(familyId, blobId, createdAt);
		const raw = await this.backend.read(key);
		if (!raw) throw new Error('Attachment not found');

		const header = await readAtLeast(raw, HEADER_LEN);
		if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('Attachment is not a Nido blob');
		if (header[4] !== VERSION) throw new Error(`Unsupported attachment version ${header[4]}`);

		const decipher = createDecipheriv('aes-256-gcm', this.key(familyId), header.subarray(5, HEADER_LEN));
		decipher.setAAD(Buffer.from(key, 'utf8'));

		// The header read may have pulled in payload bytes with it; unshift puts
		// them back so the stream below still sees the whole file.
		if (header.length > HEADER_LEN) raw.unshift(header.subarray(HEADER_LEN));

		const out = new PassThrough();
		void pipeline(raw, new StripTag(decipher), out).catch(() => out.destroy());
		return out;
	}

	async remove(familyId: string, blobId: string, createdAt: Date): Promise<void> {
		await this.backend.remove(storageKey(familyId, blobId, createdAt));
	}

	async exists(familyId: string, blobId: string, createdAt: Date): Promise<boolean> {
		return this.backend.exists(storageKey(familyId, blobId, createdAt));
	}
}

/**
 * Read at least n bytes in paused mode.
 *
 * Deliberately not `for await ... break`: breaking out of a readable's async
 * iterator destroys it, which left the caller holding a dead stream. Paused
 * reads consume only what they ask for and leave the rest for the pipeline.
 */
async function readAtLeast(stream: Readable, n: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let got = 0;
	while (got < n) {
		const chunk = stream.read() as Buffer | null;
		if (chunk !== null) {
			chunks.push(chunk);
			got += chunk.length;
			continue;
		}
		if (stream.readableEnded || stream.destroyed) break;
		// Waiting only on 'readable' hangs on a file that ended short, because a
		// readable never emits again at EOF — 'end' is the event that arrives.
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				stream.off('readable', settle);
				stream.off('end', settle);
				stream.off('error', fail);
			};
			const settle = () => { cleanup(); resolve(); };
			const fail = (err: Error) => { cleanup(); reject(err); };
			stream.on('readable', settle);
			stream.on('end', settle);
			stream.on('error', fail);
		});
	}
	const all = Buffer.concat(chunks);
	if (all.length < n) throw new Error('Attachment is truncated');
	return all;
}