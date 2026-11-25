import type { Clip } from '../../types/clip.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { lookFrameTimes, grabFrameJpeg, type FrameGrabber } from './frames.js';
import { averageNormalize } from './vector.js';
import { lookState } from './stale.js';

/** Image embedder behind a small interface (real: SigLIP via transformers.js; tests: fake). */
export interface LookEmbedder {
  model: string;
  embed(images: Buffer[]): Promise<Float32Array[]>;
}

export interface LookDeps { embedder: LookEmbedder; grab?: FrameGrabber }
export interface LookResult { created: number; redone: number; missing: number; seconds: number; moments: number }

/**
 * Fill missing and stale look fingerprints of the clips' moments (never calls the AI analysis). A moment that fails
 * (no frame, embedder error) stays missing and is counted.
 */
export async function fillLookFingerprints(
  clips: Clip[],
  repos: { highlights: HighlightRepository },
  deps: LookDeps,
  onMoment?: (clip: Clip, momentId: number, seconds: number) => void,
): Promise<LookResult> {
  const grab = deps.grab ?? grabFrameJpeg;
  const r: LookResult = { created: 0, redone: 0, missing: 0, seconds: 0, moments: 0 };
  for (const clip of clips) {
    if (!clip.has_video) continue;
    const file = clip.proxy_path ?? clip.file_path;
    for (const h of repos.highlights.findByClip(clip.id)) {
      const state = lookState(h);
      if (state === 'fresh') continue;
      const t0 = Date.now();
      try {
        const frames: Buffer[] = [];
        for (const t of lookFrameTimes(h.start_sec, h.end_sec)) frames.push(await grab(file, t));
        const vec = averageNormalize(await deps.embedder.embed(frames));
        repos.highlights.setLook(h.id, vec, deps.embedder.model, h.start_sec, h.end_sec);
        if (state === 'missing') r.created++; else r.redone++;
      } catch {
        r.missing++;
      }
      const sec = (Date.now() - t0) / 1000;
      r.seconds += sec; r.moments++;
      onMoment?.(clip, h.id, sec);
    }
  }
  return r;
}

export function lookSummaryLine(r: LookResult): string {
  return `look fingerprints: ${r.created} new, ${r.redone} stale redone, ${r.missing} missing`;
}
