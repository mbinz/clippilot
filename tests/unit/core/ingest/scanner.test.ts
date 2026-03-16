import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanDirectory } from '../../../../src/core/ingest/scanner.js';

describe('scanDirectory', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('finds video files', async () => {
    await writeFile(path.join(tmpDir, 'clip.mp4'), 'fake');
    await writeFile(path.join(tmpDir, 'clip.mov'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('clip.mov');
    expect(files[1]).toContain('clip.mp4');
  });

  it('ignores non-video files', async () => {
    await writeFile(path.join(tmpDir, 'photo.jpg'), 'fake');
    await writeFile(path.join(tmpDir, 'readme.txt'), 'fake');
    await writeFile(path.join(tmpDir, 'clip.mp4'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('clip.mp4');
  });

  it('scans subdirectories recursively', async () => {
    const subDir = path.join(tmpDir, 'day1');
    await mkdir(subDir);
    await writeFile(path.join(subDir, 'clip.mp4'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('day1');
  });

  it('ignores hidden directories', async () => {
    const hidden = path.join(tmpDir, '.hidden');
    await mkdir(hidden);
    await writeFile(path.join(hidden, 'clip.mp4'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('ignores .clippilot directory', async () => {
    const clippilotDir = path.join(tmpDir, '.clippilot');
    await mkdir(clippilotDir);
    await writeFile(path.join(clippilotDir, 'proxy.mp4'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('returns empty for empty directory', async () => {
    const files = await scanDirectory(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('returns sorted results', async () => {
    await writeFile(path.join(tmpDir, 'z_clip.mp4'), 'fake');
    await writeFile(path.join(tmpDir, 'a_clip.mp4'), 'fake');

    const files = await scanDirectory(tmpDir);
    expect(path.basename(files[0])).toBe('a_clip.mp4');
    expect(path.basename(files[1])).toBe('z_clip.mp4');
  });
});
