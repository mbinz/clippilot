// Pure helpers for "New moment" (BE4): the free footage around a point of a clip, and the selection clamped to it.

export interface Span { start_sec: number; end_sec: number }
export interface Stretch { a: number; b: number }

/**
 * The stretch of footage around `t` that no moment covers (bounded by the neighbouring moments and the clip);
 * null when `t` is inside a moment. A drag starts in this stretch and may not leave it.
 */
export function freeStretch(moments: Span[], t: number, duration: number): Stretch | null {
  let a = 0;
  let b = duration;
  for (const m of moments) {
    if (t > m.start_sec && t < m.end_sec) return null;
    if (m.end_sec <= t) a = Math.max(a, m.end_sec);
    if (m.start_sec >= t) b = Math.min(b, m.start_sec);
  }
  return { a, b };
}

const tenth = (x: number): number => Math.round(x * 10) / 10;

/** A drag from `from` to `to` (either order), clamped to the free stretch and rounded to 0.1 s. */
export function clampSelection(free: Stretch, from: number, to: number): Stretch {
  const clamp = (x: number) => Math.min(free.b, Math.max(free.a, tenth(x)));
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { a: clamp(lo), b: clamp(hi) };
}
