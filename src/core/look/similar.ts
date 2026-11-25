/**
 * Similar moments by look (SM2): pure ranking over fingerprints. Role/shot labels and stars are not part of the score.
 *
 * Constants (start values, to be tuned by eye on the board, SM-9). Chosen from the Odeceixe spread (19 moments, one
 * event, 171 pairs): cosine p10 0.58 / median 0.70 / p75 0.82 / p90 0.93 / max 0.99; pairs recorded < 5 min apart
 * average 0.82. A threshold of 0.80 kept the upper quarter (~5 similar moments per moment, 48 of 171 pairs), clear
 * of the median where unrelated shots of the same place sit. The time boost is small (0.05 at zero distance, linear
 * to 0 at 5 min): enough to put a take recorded right after the subject ahead of an equally alike one hours later,
 * too small to pull a different shot over the line on its own.
 */
export const LOOK_THRESHOLD = 0.85; // raised from 0.80 after the first board round (groups too large)
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
 * With `groups` (see `lookGroups`) the subject's group members always count as similar (SM-7), whatever their pair
 * score. A subject without a fingerprint has nothing similar (SM-5).
 */
export function similarTo(
  subject: LookMoment, moments: LookMoment[], groups?: Map<number, number | null>,
): { similar: number[]; other: number[] } {
  if (!subject.vec) return { similar: [], other: [] };
  const group = groups?.get(subject.id) ?? null;
  const scored = moments
    .filter((m) => m.id !== subject.id && !m.out && m.vec && m.event_id === subject.event_id)
    .map((m) => ({ id: m.id, s: score(subject, m), member: group !== null && groups!.get(m.id) === group }))
    .sort((a, b) => b.s - a.s || a.id - b.id);
  const above = (x: { s: number; member: boolean }) => x.member || x.s >= LOOK_THRESHOLD;
  return {
    similar: scored.filter(above).map((x) => x.id),
    other: scored.filter((x) => !above(x)).map((x) => x.id),
  };
}

/**
 * Look groups (SM-7): average-linkage clustering per event, merging while the best average score between two clusters
 * is at least `LOOK_THRESHOLD` (so A~B and B~C never pull A and C together on their own). Moments without a
 * fingerprint, out moments and singletons map to null; a group's id is its smallest member id. Deterministic: ties go
 * to the pair with the smallest ids, whatever the input order.
 */
export function lookGroups(moments: LookMoment[]): Map<number, number | null> {
  const groups = new Map<number, number | null>(moments.map((m) => [m.id, null]));
  const byEvent = new Map<number | null, LookMoment[]>();
  for (const m of moments) {
    if (!m.vec || m.out) continue;
    const list = byEvent.get(m.event_id) ?? [];
    list.push(m);
    byEvent.set(m.event_id, list);
  }
  for (const ms of byEvent.values()) {
    const sorted = [...ms].sort((a, b) => a.id - b.id);
    const pair = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) pair.set(`${i}|${j}`, score(sorted[i]!, sorted[j]!));
    }
    const s = (i: number, j: number): number => pair.get(i < j ? `${i}|${j}` : `${j}|${i}`)!;
    // clusters as ascending member index lists, kept ordered by their first member
    let clusters: number[][] = sorted.map((_, i) => [i]);
    for (;;) {
      let best = -Infinity, bi = -1, bj = -1;
      for (let a = 0; a < clusters.length; a++) {
        for (let b = a + 1; b < clusters.length; b++) {
          let sum = 0;
          for (const x of clusters[a]!) for (const y of clusters[b]!) sum += s(x, y);
          const avg = sum / (clusters[a]!.length * clusters[b]!.length);
          if (avg > best + 1e-12) { best = avg; bi = a; bj = b; }
        }
      }
      if (bi < 0 || best < LOOK_THRESHOLD) break;
      const merged = [...clusters[bi]!, ...clusters[bj]!].sort((x, y) => x - y);
      clusters = clusters.filter((_, k) => k !== bi && k !== bj);
      clusters.push(merged);
      clusters.sort((x, y) => x[0]! - y[0]!);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      const id = sorted[c[0]!]!.id;
      for (const i of c) groups.set(sorted[i]!.id, id);
    }
  }
  return groups;
}
