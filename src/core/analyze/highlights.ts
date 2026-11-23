import type { HighlightResponse, SlowmoLevel } from './schema.js';

const MIN_LENGTH_SEC = 0.5;
const MIN_MOMENT_SEC = 2;
export const MAX_MOMENT_SEC = 8;

/** Minimum source fps for 50 % / 25 % playback (assumes a 25 fps timeline). */
export const MIN_FPS_HALF_SPEED = 48;
export const MIN_FPS_QUARTER_SPEED = 90;

/** Whether footage at `fps` has enough frames for playback at `speed` (1, 0.5 or 0.25). */
export function speedAllowed(speed: number, fps: number | null | undefined): boolean {
  if (speed === 1) return true;
  if (speed === 0.5) return !!fps && fps >= MIN_FPS_HALF_SPEED;
  if (speed === 0.25) return !!fps && fps >= MIN_FPS_QUARTER_SPEED;
  return false;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NormalizedHighlight {
  start_sec: number;
  end_sec: number;
  description: string;
  tier: HighlightResponse['tier'];
  shot: HighlightResponse['shot'];
  role: HighlightResponse['role'];
  issues: NonNullable<HighlightResponse['issues']>;
  slowmo: SlowmoLevel;
  slowmo_reason: string;
  suggested_speed: number;
  audio_keep: boolean;
  audio_type: NonNullable<HighlightResponse['audio_type']>;
}

/**
 * Playback speed suggested for a moment. The model only judges whether slow motion suits the moment;
 * whether the footage has enough frames for it is decided here (assumes a 25 fps timeline).
 */
export function suggestedSpeed(slowmo: SlowmoLevel, fps: number | null | undefined): number {
  if (slowmo === 'none' || !fps || fps < MIN_FPS_HALF_SPEED) return 1;
  if (slowmo === 'strong' && fps >= MIN_FPS_QUARTER_SPEED) return 0.25;
  return 0.5;
}

/** Widen a range to MIN_MOMENT_SEC around its midpoint, shifted to stay inside [0, duration]. */
function widen(start: number, end: number, durationSec: number): [number, number] {
  if (end - start >= MIN_MOMENT_SEC) return [start, end];
  if (durationSec < MIN_MOMENT_SEC) return [0, durationSec];
  const mid = (start + end) / 2;
  let s = mid - MIN_MOMENT_SEC / 2;
  let e = mid + MIN_MOMENT_SEC / 2;
  if (s < 0) [s, e] = [0, MIN_MOMENT_SEC];
  if (e > durationSec) [s, e] = [durationSec - MIN_MOMENT_SEC, durationSec];
  return [s, e];
}

/** Shorten a range longer than MAX_MOMENT_SEC to MAX_MOMENT_SEC around its midpoint (stays inside the clamped range). */
function shorten(start: number, end: number): [number, number] {
  if (end - start <= MAX_MOMENT_SEC) return [start, end];
  const mid = (start + end) / 2;
  return [mid - MAX_MOMENT_SEC / 2, mid + MAX_MOMENT_SEC / 2];
}

/**
 * Clamp to [0, duration], drop junk (< 0.5 s), widen to a 2 s minimum, shorten to an 8 s maximum (centred),
 * sort by start, resolve overlaps, round to 0.01 s, add suggested_speed.
 *
 * Overlap rule: walking the moments in start order, a moment that starts before the previous kept moment ends
 * is shifted to start at that end (its end stays); if less than MIN_MOMENT_SEC remains it is dropped.
 * Fully contained moments are therefore dropped. Moments are never merged, so the model's cut points survive.
 */
export function normalizeHighlights(
  raw: HighlightResponse[],
  durationSec: number,
  fps?: number | null,
): NormalizedHighlight[] {
  const sized = raw
    .map((h) => ({
      ...h,
      start_sec: Math.max(0, h.start_sec),
      end_sec: Math.min(durationSec, h.end_sec),
    }))
    .filter((h) => h.end_sec - h.start_sec >= MIN_LENGTH_SEC)
    .map((h) => {
      const [ws, we] = widen(h.start_sec, h.end_sec, durationSec);
      const [start_sec, end_sec] = shorten(ws, we);
      return { ...h, start_sec, end_sec };
    })
    .sort((a, b) => a.start_sec - b.start_sec);

  const kept: typeof sized = [];
  for (const h of sized) {
    const prevEnd = kept.length ? kept[kept.length - 1].end_sec : 0;
    const start_sec = Math.max(h.start_sec, prevEnd);
    if (start_sec !== h.start_sec && h.end_sec - start_sec < MIN_MOMENT_SEC) continue;
    kept.push({ ...h, start_sec });
  }

  return kept
    .map((h) => {
      const slowmo = h.slowmo ?? 'none';
      return {
        start_sec: round2(h.start_sec),
        end_sec: round2(h.end_sec),
        description: h.description ?? '',
        tier: h.tier,
        shot: h.shot,
        role: h.role,
        issues: h.issues ?? [],
        slowmo,
        slowmo_reason: h.slowmo_reason ?? '',
        suggested_speed: suggestedSpeed(slowmo, fps),
        audio_keep: h.audio_keep ?? false,
        audio_type: h.audio_type ?? 'noise',
      };
    });
}
