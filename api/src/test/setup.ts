// Test bootstrap: runs before every test file (see vitest.config.ts). Points
// KAMORI_DATA_DIR at a throwaway tmp folder and pins the master key + JWT
// secret so tests never touch developer data. Sync-only on purpose: this file
// is compiled by tsc (it is not a *.test.ts) and CJS forbids top-level await.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.KAMORI_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'nido-test-'));
process.env.KAMORI_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = 'nido-test-secret';