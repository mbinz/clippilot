import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord, HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { measureFrames, jitterBand, type JitterBand, type JitterBandConfig } from './motion.js';
import { decodeFrames, type FrameSource } from './frames.js';

export type { FrameSource } from './frames.js';
export { jitterBand, type JitterBand } from './motion.js';

const RANGE_EPS = 0.01;
const DEFAULT_FPS = 25;

/** A moment counts as measured when it has a score and its current range equals the measured one (+-0.01 s). */
export function isMeasured(h: Pick<HighlightRecord, 'start_sec' | 'end_sec' | 'jitter_score' | 'motion_start_sec' | 'motion_end_sec'>): boolean {
  return h.jitter_score !== null && h.jitter_score !== undefined
    && h.motion_start_sec !== null && h.motion_end_sec !== null
    && Math.abs(h.motion_start_sec - h.start_sec) <= RANGE_EPS
    && Math.abs(h.motion_end_sec - h.end_sec) <= RANGE_EPS;
}

export interface MotionOptions {
  cfg: JitterBandConfig;
  /** Redo moments that are already measured. */
  force?: boolean;
  source?: FrameSource;
  /** File existence check (injectable for tests). */
  exists?: (p: string) => boolean;
  onProgress?: (done: number, total: number, fileName: string) => void;
}

export interface MotionResult {
  measured: number;
  /** Already measured and unchanged. */
  skipped: number;
  failed: number;
  /** Band counts over all measured moments of the processed clips (including earlier runs). */
  bands: Record<JitterBand, number>;
  errors: { clip_id: number; moment_id: number; message: string }[];
}

/**
 * Measure jitter and stillness of every unmeasured or stale moment, one after another (resumable). Decodes the
 * original (proxy when it is missing) at the clip's native fps. Writes only the motion columns: ranges, status,
 * speed and tier of a moment are never touched, protected or not.
 */
export async function measureClips(
  clips: Clip[],
  deps: { highlights: HighlightRepository },
  opts: MotionOptions,
): Promise<MotionResult> {
  const source = opts.source ?? decodeFrames;
  const exists = opts.exists ?? existsSync;
  const result: MotionResult = { measured: 0, skipped: 0, failed: 0, bands: { locked: 0, stabilize: 0, shaky: 0 }, errors: [] };
  const work = clips.filter((c) => !c.hidden && c.has_video);
  let done = 0;
  for (const clip of work) {
    for (const m of deps.highlights.findByClip(clip.id)) {
      if (!opts.force && isMeasured(m)) { result.skipped++; continue; }
      try {
        const file = decodeSource(clip, exists);
        const fps = clip.fps ?? DEFAULT_FPS;
        const set = await source({ file, startSec: m.start_sec, durationSec: m.end_sec - m.start_sec, fps });
        deps.highlights.setMotion(m.id, measureFrames(set, fps), m.start_sec, m.end_sec);
        result.measured++;
      } catch (err) {
        result.failed++;
        result.errors.push({ clip_id: clip.id, moment_id: m.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const m of deps.highlights.findByClip(clip.id)) {
      if (isMeasured(m)) result.bands[jitterBand(m.jitter_score!, opts.cfg)]++;
    }
    opts.onProgress?.(++done, work.length, path.basename(clip.file_path));
  }
  return result;
}

function decodeSource(clip: Pick<Clip, 'file_path' | 'proxy_path'>, exists: (p: string) => boolean): string {
  if (exists(clip.file_path)) return clip.file_path;
  if (clip.proxy_path && exists(path.resolve(clip.proxy_path))) return path.resolve(clip.proxy_path);
  throw new Error(`Neither the original nor the proxy of ${path.basename(clip.file_path)} is available`);
}
