import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { renderPreview, previewDuration, type PreviewSegment } from '../../src/core/critic/preview.js';
import { renderStrip } from '../../src/core/critic/strips.js';

const run = promisify(execFile);

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await run(cmd, args); return true; } catch { return false; }
}
const ready = await has('ffmpeg', ['-version']) && await has('ffprobe', ['-version']);

async function probe(file: string, entry: string): Promise<string> {
  return (await run('ffprobe', ['-v', 'error', '-show_entries', entry, '-of', 'csv=p=0', file])).stdout.trim();
}

describe.skipIf(!ready)('critic integration (real ffmpeg)', () => {
  let dir: string;
  let withAudio: string;
  let silent: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-critic-int-'));
    withAudio = path.join(dir, 'a.mp4');
    silent = path.join(dir, 'b.mp4');
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', withAudio]);
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', silent]);
  }, 60000);

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('renders a 480p preview of mixed clips (slowed, silent, other size) with the expected length', async () => {
    const segs: PreviewSegment[] = [
      { label: 'S1·P1', file: withAudio, start: 1, end: 3, speed: 1, keepAudio: true, hasAudio: true },
      { label: 'S1·P2', file: silent, start: 0, end: 1, speed: 0.5, keepAudio: false, hasAudio: false },
      { label: 'S2·P1', file: withAudio, start: 2, end: 3, speed: 0.25, keepAudio: false, hasAudio: true },
    ];
    const out = path.join(dir, 'preview.mp4');
    const r = await renderPreview(segs, out);
    expect(r.duration_sec).toBe(previewDuration(segs));
    expect(r.duration_sec).toBe(8);
    expect(await probe(out, 'stream=width,height')).toContain('854,480');
    expect(Number(await probe(out, 'format=duration'))).toBeGreaterThan(7.5);
    expect(Number(await probe(out, 'format=duration'))).toBeLessThan(8.6);
    expect(await probe(out, 'stream=codec_name')).toContain('aac');
  }, 120000);

  it('renders a strip PNG of a range with the real ffmpeg grabber', async () => {
    const out = path.join(dir, 'strip.png');
    const frames = await renderStrip(withAudio, 1, 3, 25, out);
    expect(frames.map((f) => f.t)).toEqual([1, 1.5, 2, 2.5, 2.96]);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(4 * 320 + 5 * 8);
    expect(meta.height).toBe(2 * (180 + 24) + 3 * 8);
  }, 60000);
});
