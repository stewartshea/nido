// src/db-core.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const VALID_KEY = '0123456789abcdef'.repeat(4);

const ORIGINAL_MASTER_KEY = process.env.NIDO_MASTER_KEY;

function setMasterKey(value: string | undefined) {
  if (value === undefined) delete process.env.NIDO_MASTER_KEY;
  else process.env.NIDO_MASTER_KEY = value;
}

async function freshModule() {
  vi.resetModules();
  return import('./db-core');
}

async function readKey(): Promise<string> {
  const { getMasterKeyHex } = await freshModule();
  return getMasterKeyHex();
}

afterEach(() => {
  setMasterKey(ORIGINAL_MASTER_KEY);
  vi.resetModules();
});

describe('getMasterKeyHex', () => {
  beforeEach(() => {
    setMasterKey(VALID_KEY);
  });

  it('returns a 64-hex key lowercased', async () => {
    setMasterKey(VALID_KEY.toUpperCase());
    await expect(readKey()).resolves.toBe(VALID_KEY);
  });

  it('trims surrounding whitespace', async () => {
    setMasterKey(`  ${VALID_KEY}\n`);
    await expect(readKey()).resolves.toBe(VALID_KEY);
  });

  it('caches the first key it sees', async () => {
    const { getMasterKeyHex } = await freshModule();
    expect(getMasterKeyHex()).toBe(VALID_KEY);
    setMasterKey('f'.repeat(64));
    expect(getMasterKeyHex()).toBe(VALID_KEY);
  });

  it('rejects an unset key', async () => {
    setMasterKey(undefined);
    await expect(readKey()).rejects.toThrow(/not set/);
  });

  it('rejects an empty or whitespace-only key', async () => {
    for (const empty of ['', '   ', '\t\n']) {
      setMasterKey(empty);
      await expect(readKey()).rejects.toThrow(/not set/);
    }
  });

  it('rejects non-hex input', async () => {
    setMasterKey('z'.repeat(64));
    await expect(readKey()).rejects.toThrow(/hex/);
  });

  it('rejects hex of the wrong length', async () => {
    for (const [label, value] of [
      ['too short', 'abcd'],
      ['16 hex chars', '0123456789abcdef'],
      ['one char short', 'a'.repeat(63)],
      ['one char long', 'a'.repeat(65)],
      ['twice the length', 'a'.repeat(128)],
    ] as const) {
      setMasterKey(value);
      await expect(readKey(), label).rejects.toThrow(/exactly 64 hex characters/);
    }
  });
});

describe('deriveKey', () => {
  it('produces a distinct 64-hex subkey per namespace', async () => {
    vi.resetModules();
    const { deriveKey } = await import('./db-core');
    const registry = deriveKey(VALID_KEY, 'nido:registry', 'nido:registry');
    const family = deriveKey(VALID_KEY, 'family-abc', 'nido:db');
    expect(registry).toMatch(/^[0-9a-f]{64}$/);
    expect(family).toMatch(/^[0-9a-f]{64}$/);
    expect(registry).not.toBe(family);
  });
});
