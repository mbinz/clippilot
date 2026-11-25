import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderContactSheet } from '../contact-sheet.js';

const exec = promisify(execFile);

export const STRIP_STEP_SEC = 0.5;
export const STRIP_MAX_FRAMES = 12;
const STRIP_COLS = 4;

export interface StripFrame { t: number; label: string }

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Source times of the frames of a panel's strip: one every 0.5 s of the played range plus its exact last frame
 * (`end - 1 frame`). More than 12 frames: the regular ones are sampled evenly (first one kept), the last always stays.
 */
export function stripTimes(startSec: number, endSec: number, fps: number | null | undefined): StripFrame[] {
  const frame = 1 / (fps && fps > 0 ? fps : 25);
  const last = r3(Math.max(startSec, endSec - frame));
  let regular: number[] = [];
  for (let k = 0; startSec + k * STRIP_STEP_SEC < last - 0.25 + 1e-9; k++) regular.push(r3(startSec + k * STRIP_STEP_SEC));
  if (last > startSec && regular.length === 0) regular = [r3(startSec)];
  if (regular.length > STRIP_MAX_FRAMES - 1) {
    const m = STRIP_MAX_FRAMES - 1;
    regular = Array.from({ length: m }, (_, i) => regular[Math.round((i * (regular.length - 1)) / (m - 1))]!);
  }
  const times = last > startSec ? [...regular, last] : [r3(startSec)];
  return times.map((t, i) => ({ t, label: `${t.toFixed(2)}s${i === times.length - 1 && times.length > 1 ? ' end' : ''}` }));
}

/**
 * Short explanation for the critic when a regular frame was left out because it fell within 0.25 s of the last frame
 * (so the gap before the last frame is intentional); undefined when nothing was dropped.
 */
export function stripNote(startSec: number, endSec: number, fps: number | null | undefined): string | undefined {
  const frame = 1 / (fps && fps > 0 ? fps : 25);
  const last = r3(Math.max(startSec, endSec - frame));
  for (let k = 0; startSec + k * STRIP_STEP_SEC < last - 1e-9; k++) {
    if (startSec + k * STRIP_STEP_SEC >= last - 0.25 - 1e-9) {
      return 'A regular frame was dropped because it fell within 0.25 s of the last frame; the gap before the last frame is intentional.';
    }
  }
  return undefined;
}

/** Adapter: write one frame of `file` at source time `t` to a PNG. Injectable for tests. */
export type FrameGrabber = (file: string, t: number, outPath: string) => Promise<void>;

export const grabFrame: FrameGrabber = async (file, t, outPath) => {
  await exec('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-an', '-y', outPath]);
};

/** Render the strip PNG of a range (frames labelled with their time) and return the frames it holds. */
export async function renderStrip(
  file: string, startSec: number, endSec: number, fps: number | null | undefined, outPath: string,
  grab: FrameGrabber = grabFrame,
): Promise<StripFrame[]> {
  const frames = stripTimes(startSec, endSec, fps);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'clippilot-strip-'));
  try {
    const cells = [];
    for (const [i, f] of frames.entries()) {
      const p = path.join(tmp, `f${i}.png`);
      await grab(file, f.t, p);
      cells.push({ clip_id: 0, thumbnail_path: p, label: f.label });
    }
    const cols = Math.min(STRIP_COLS, cells.length);
    await renderContactSheet(cells, outPath, { cols, rows: Math.ceil(cells.length / cols), cellWidth: 320, cellHeight: 180 });
    return frames;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
