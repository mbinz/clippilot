import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord, HighlightRepository } from '../../db/repositories/highlight.repository.js';
import type { MotionRepository } from '../../db/repositories/motion.repository.js';
import { jitterBand, type JitterBand, type JitterBandConfig } from './motion.js';
import { measureCurve, detectShakes, momentMotion, type RawCurve } from './curve.js';
import { decodeClipFrames, type ClipFrameSource } from './frames.js';

export type { ClipFrameSource } from './frames.js';
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

/** Turns a decoded clip into its raw curve (injectable: tests skip the pixel work). */
export type CurveMeasurer = (
  frames: AsyncIterable<Uint8Array>,
  dims: { w: number; h: number; fps: number; srcWidth: number },
) => Promise<RawCurve>;

export interface MotionOptions {
  cfg: JitterBandConfig;
  /** Measure clips that already have a curve. */
  force?: boolean;
  source?: ClipFrameSource;
  measurer?: CurveMeasurer;
  /** File existence check (injectable for tests). */
  exists?: (p: string) => boolean;
  onProgress?: (done: number, total: number, fileName: string) => void;
}

export interface MotionResult {
  /** Clips decoded and measured in this run. */
  measured: number;
  /** Clips that already had a curve (not decoded again). */
  skipped: number;
  failed: number;
  /** Shakes of the clips measured in this run. */
  shakes: { high: number; low: number };
  /** Band counts over all moments of the processed clips. */
  bands: Record<JitterBand, number>;
  errors: { clip_id: number; message: string }[];
}

export interface MotionDeps {
  highlights: HighlightRepository;
  motion: MotionRepository;
}

/**
 * [D-4] Measure every clip with a usable moment once, as a whole: decode it, store the curve and its shakes, then
 * write the jitter / camera / change columns of every moment from the curve (so trims never need a new decode).
 * Ranges, status, speed and tier of moments are never touched here (the shake fit, F1, is a separate step).
 */
export async function measureClips(clips: Clip[], deps: MotionDeps, opts: MotionOptions): Promise<MotionResult> {
  const source = opts.source ?? decodeClipFrames;
  const measurer = opts.measurer ?? measureCurve;
  const exists = opts.exists ?? existsSync;
  const result: MotionResult = {
    measured: 0, skipped: 0, failed: 0, shakes: { high: 0, low: 0 },
    bands: { locked: 0, stabilize: 0, shaky: 0 }, errors: [],
  };
  const work = clips.filter((c) => !c.hidden && c.has_video && deps.highlights.findByClip(c.id).some((m) => m.status !== 'rejected'));
  let done = 0;
  for (const clip of work) {
    try {
      if (!opts.force && deps.motion.getCurve(clip.id)) {
        result.skipped++;
      } else {
        const fps = clip.fps ?? DEFAULT_FPS;
        const frames = await source({ file: decodeSource(clip, exists), fps });
        const raw = await measurer(frames.frames, { w: frames.w, h: frames.h, fps, srcWidth: frames.srcWidth });
        const d = detectShakes(raw);
        deps.motion.save(clip.id, { curve: raw, medianResidual: d.medianResidual, continuous: d.continuous, shakes: d.shakes });
        deps.highlights.clearShakeStatus(clip.id); // new shakes: the shake fit has to look again
        result.measured++;
        for (const k of d.shakes) result.shakes[k.confidence]++;
      }
      writeMomentColumns(clip.id, deps);
      for (const m of deps.highlights.findByClip(clip.id)) {
        if (isMeasured(m)) result.bands[jitterBand(m.jitter_score!, opts.cfg)]++;
      }
    } catch (err) {
      result.failed++;
      result.errors.push({ clip_id: clip.id, message: err instanceof Error ? err.message : String(err) });
    }
    opts.onProgress?.(++done, work.length, path.basename(clip.file_path));
  }
  return result;
}

/** Derive the stored moment columns from the clip's curve (every moment, whatever its protection). */
export function writeMomentColumns(clipId: number, deps: MotionDeps): void {
  const curve = deps.motion.getCurve(clipId);
  if (!curve) return;
  for (const m of deps.highlights.findByClip(clipId)) {
    const v = momentMotion(curve, m.start_sec, m.end_sec);
    deps.highlights.setMotion(m.id, { score: v.jitter.score, maxPx: v.jitter.maxPx, camera: v.camera, change: v.change }, m.start_sec, m.end_sec);
  }
}

function decodeSource(clip: Pick<Clip, 'file_path' | 'proxy_path'>, exists: (p: string) => boolean): string {
  if (exists(clip.file_path)) return clip.file_path;
  if (clip.proxy_path && exists(path.resolve(clip.proxy_path))) return path.resolve(clip.proxy_path);
  throw new Error(`Neither the original nor the proxy of ${path.basename(clip.file_path)} is available`);
}
