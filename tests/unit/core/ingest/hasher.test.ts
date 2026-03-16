import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computeFileHash } from '../../../../src/core/ingest/hasher.js';

describe('computeFileHash', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-hash-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('produces a hex sha256 hash', async () => {
    const file = path.join(tmpDir, 'test.bin');
    await writeFile(file, 'hello world');

    const hash = await computeFileHash(file);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces consistent hash for same content', async () => {
    const file1 = path.join(tmpDir, 'file1.bin');
    const file2 = path.join(tmpDir, 'file2.bin');
    await writeFile(file1, 'same content');
    await writeFile(file2, 'same content');

    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', async () => {
    const file1 = path.join(tmpDir, 'file1.bin');
    const file2 = path.join(tmpDir, 'file2.bin');
    await writeFile(file1, 'content A');
    await writeFile(file2, 'content B');

    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);
    expect(hash1).not.toBe(hash2);
  });
});
