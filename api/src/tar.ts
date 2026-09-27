// tar.ts
// Minimal streaming ustar writer, just enough to bundle a backup directory.
// Avoids a tar dependency for what is a fixed, well-specified header format.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const BLOCK = 512;

export interface TarEntry {
  /** Path recorded in the archive, always relative and slash-separated. */
  name: string;
  /** Absolute path on disk to read the bytes from. */
  sourcePath: string;
  size: number;
  mode?: number;
  mtime?: Date;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function writeString(block: Buffer, value: string, offset: number, length: number): void {
  block.write(value.slice(0, length - 1), offset, length - 1, 'utf8');
}

/**
 * Build one 512-byte ustar header. The checksum is computed with its own field
 * filled with spaces, which is what every tar implementation expects.
 */
function header(entry: TarEntry): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  writeString(block, entry.name, 0, 100);
  writeString(block, octal(entry.mode ?? 0o600, 8), 100, 8);
  writeString(block, octal(0, 8), 108, 8);
  writeString(block, octal(0, 8), 116, 8);
  writeString(block, octal(entry.size, 12), 124, 12);
  writeString(block, octal(Math.floor((entry.mtime?.getTime() ?? Date.now()) / 1000), 12), 136, 12);
  block.write('        ', 148, 8, 'ascii');
  block.write('0', 156, 1, 'ascii');
  writeString(block, 'ustar\0', 257, 6);
  writeString(block, '00', 263, 2);

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

function padding(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder, 0);
}

/** SHA-256 of a file, streamed so a large photo never lands in memory. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function writeTarGz(entries: TarEntry[], destination: string): Promise<void> {
  const tempTar = `${destination}.tmp-tar`;
  const sink = createWriteStream(tempTar);
  // Every piped entry attaches error/close listeners to this one stream;
  // size the cap to the work instead of tripping MaxListeners warnings.
  sink.setMaxListeners(entries.length * 2 + 8);

  for (const entry of entries) {
    sink.write(header(entry));
    await pipeline(createReadStream(entry.sourcePath), sink, { end: false });
    const pad = padding(entry.size);
    if (pad.length > 0) sink.write(pad);
  }

  sink.write(Buffer.alloc(BLOCK * 2, 0));
  await sink.end();

  await pipeline(createReadStream(tempTar), createGzip(), createWriteStream(destination));
  rmSync(tempTar, { force: true });
}
