/**
 * Similar moments by look (SM2): pure ranking over fingerprints. Role/shot labels and stars are not part of the score.
 *
 * Constants (start values, to be tuned by eye on the board, SM-9). Chosen from the Odeceixe spread (19 moments, one
 * event, 171 pairs): cosine p10 0.58 / median 0.70 / p75 0.82 / p90 0.93 / max 0.99; pairs recorded < 5 min apart
 * average 0.82. A threshold of 0.80 keeps the upper quarter (~5 similar moments per moment, 48 of 171 pairs), clear
 * of the median where unrelated shots of the same place sit. The time boost is small (0.05 at zero distance, linear
 * to 0 at 5 min): enough to put a take recorded right after the subject ahead of an equally alike one hours later,
 * too small to pull a different shot over the line on its own.
 */
export const LOOK_THRESHOLD = 0.80;
export const TIME_BOOST = 0.05;
export const TIME_BOOST_WINDOW_SEC = 300;

export interface LookMoment {
  id: number;
  event_id: number | null;
  /** Recording time in epoch seconds (clip start + offset into the clip). */
  rec_sec: number;
  /** Rejected moment or hidden clip. */
  out: boolean;
  /** Fresh, normalized fingerprint; null = missing or stale. */
  vec: Float32Array | null;
}

/** Cosine similarity of the fingerprints (they are normalized) plus a boost fading with recording-time distance. */
export function score(a: LookMoment, b: LookMoment): number {
  if (!a.vec || !b.vec) return -Infinity;
  let dot = 0;
  for (let i = 0; i < a.vec.length; i++) dot += a.vec[i]! * b.vec[i]!;
  const dt = Math.abs(a.rec_sec - b.rec_sec);
  return dot + TIME_BOOST * Math.max(0, 1 - dt / TIME_BOOST_WINDOW_SEC);
}

/**
 * Same-event moments with a fingerprint, not out and not the subject, nearest first, split at `LOOK_THRESHOLD`.
 * A subject without a fingerprint has nothing similar (SM-5).
 */
export function similarTo(subject: LookMoment, moments: LookMoment[]): { similar: number[]; other: number[] } {
  if (!subject.vec) return { similar: [], other: [] };
  const scored = moments
    .filter((m) => m.id !== subject.id && !m.out && m.vec && m.event_id === subject.event_id)
    .map((m) => ({ id: m.id, s: score(subject, m) }))
    .sort((a, b) => b.s - a.s || a.id - b.id);
  return {
    similar: scored.filter((x) => x.s >= LOOK_THRESHOLD).map((x) => x.id),
    other: scored.filter((x) => x.s < LOOK_THRESHOLD).map((x) => x.id),
  };
}
