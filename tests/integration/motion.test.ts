import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { decodeClipFrames } from '../../src/core/motion/frames.js';
import { measureCurve, detectShakes, momentMotion } from '../../src/core/motion/curve.js';

const run = promisify(execFile);

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await run(cmd, args); return true; } catch { return false; }
}
const ready = await has('ffmpeg', ['-version']) && await has('ffprobe', ['-version']);

describe.skipIf(!ready)('motion integration (real ffmpeg)', () => {
  let dir: string;
  let still: string;
  let shaky: string;
  let jolt: string;

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
    jolt = path.join(dir, 'jolt.mp4');
    await gen(jolt, "x='32+14*between(n,50,52)-14*between(n,53,55)'");
  }, 60000);

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const curveOf = async (file: string) => {
    const f = await decodeClipFrames({ file, fps: 25 });
    expect(f.w).toBe(320);
    expect(f.srcWidth).toBe(320);
    return measureCurve(f.frames, { w: f.w, h: f.h, fps: 25, srcWidth: f.srcWidth });
  };

  it('decodes a whole clip as a stream, derives jitter from the curve: locked far below shaky', async () => {
    const a = await curveOf(still);
    expect(a.dx.length).toBe(99); // 100 frames, frame count checked against the container
    const locked = momentMotion(a, 0.5, 3.5);
    const b = momentMotion(await curveOf(shaky), 0.5, 3.5);
    expect(locked.jitter.score).toBeLessThan(0.05);
    expect(b.jitter.score).toBeGreaterThan(0.4);
    expect(b.jitter.maxPx).toBeGreaterThan(locked.jitter.maxPx);
  }, 60000);

  it('finds a single jolt as one shake near 2 s and none in a still clip', async () => {
    expect(detectShakes(await curveOf(still)).shakes).toHaveLength(0);
    const d = detectShakes(await curveOf(jolt));
    expect(d.shakes).toHaveLength(1);
    expect(d.shakes[0].start_sec).toBeGreaterThan(1.7);
    expect(d.shakes[0].end_sec).toBeLessThan(2.6);
  }, 60000);
});
