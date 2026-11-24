import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { decodeFrames } from '../../src/core/motion/frames.js';
import { measureFrames } from '../../src/core/motion/motion.js';

const run = promisify(execFile);

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await run(cmd, args); return true; } catch { return false; }
}
const ready = await has('ffmpeg', ['-version']) && await has('ffprobe', ['-version']);

describe.skipIf(!ready)('motion integration (real ffmpeg)', () => {
  let dir: string;
  let still: string;
  let shaky: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'clippilot-motion-int-'));
    // One still textured frame looped, so only the camera (crop window) moves, not the content.
    const png = path.join(dir, 'scene.png');
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=384x216', '-frames:v', '1', '-y', png]);
    const gen = (out: string, crop: string) => run('ffmpeg', ['-loglevel', 'error', '-loop', '1', '-framerate', '25', '-i', png, '-t', '4',
      '-vf', `crop=320:180:${crop}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', out]);
    still = path.join(dir, 'still.mp4');
    shaky = path.join(dir, 'shaky.mp4');
    await gen(still, '32:18');
    await gen(shaky, "x='32+12*sin(n*2.3)':y='18+8*cos(n*3.1)'");
  }, 60000);

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('decodes a range at native fps and scores a locked clip far below a shaky one', async () => {
    const a = await decodeFrames({ file: still, startSec: 0.5, durationSec: 3, fps: 25 });
    expect(a.w).toBe(320);
    expect(a.frames.length).toBe(75);
    const locked = measureFrames(a, 25);
    const b = measureFrames(await decodeFrames({ file: shaky, startSec: 0.5, durationSec: 3, fps: 25 }), 25);
    expect(locked.score).toBeLessThan(0.05);
    expect(b.score).toBeGreaterThan(0.4);
    expect(b.maxPx).toBeGreaterThan(locked.maxPx);
  }, 60000);
});
