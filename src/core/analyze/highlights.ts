import type { HighlightResponse } from './schema.js';

const MIN_LENGTH_SEC = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Clamp to [0, duration], drop too-short entries, sort by start, round to 0.01 s. */
export function normalizeHighlights(
  raw: HighlightResponse[],
  durationSec: number,
): HighlightResponse[] {
  return raw
    .map((h) => ({
      ...h,
      start_sec: Math.max(0, h.start_sec),
      end_sec: Math.min(durationSec, h.end_sec),
    }))
    .filter((h) => h.end_sec - h.start_sec >= MIN_LENGTH_SEC)
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((h) => ({ ...h, start_sec: round2(h.start_sec), end_sec: round2(h.end_sec) }));
}
