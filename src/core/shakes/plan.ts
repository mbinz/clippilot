export interface Span { start_sec: number; end_sec: number }
export interface Part { start: number; end: number }

/** A part shorter than this is dropped; the parts together must reach `MIN_TOTAL_SEC`. */
export const MIN_PART_SEC = 1.0;
export const MIN_TOTAL_SEC = 2.0;

export type ShakeKeptReason = 'no_clean_range' | 'speech';

export type ShakePlan =
  | { kind: 'clean' }
  | { kind: 'trim'; parts: [Part] }
  | { kind: 'split'; parts: Part[] }
  | { kind: 'kept'; reason: ShakeKeptReason };

const EPS = 1e-9;
// Rounded towards the inside of a clean part so the 0.01 s grid never reaches back into a shake.
const up = (x: number): number => Math.ceil(x * 100 - 1e-6) / 100;
const down = (x: number): number => Math.floor(x * 100 + 1e-6) / 100;

/**
 * F1 step 1: what to do with a moment `range` (clip seconds) given every shake of its clip. Clean parts = the range
 * minus each overlapping shake (+- 1 frame); parts under 1 s are dropped. One part left (>= 2 s) = trim; several
 * parts (>= 2 s together) = split; nothing usable = kept. A plan that would newly cut a sentence (a new boundary
 * inside a sentence) is kept as well. `sentences` are the clip's spoken sentences.
 */
export function planShakeFix(
  range: Part,
  shakes: Span[],
  sentences: { start: number; end: number }[],
  opts: { fps?: number } = {},
): ShakePlan {
  const frame = 1 / (opts.fps ?? 25);
  const cuts = shakes
    .map((k) => ({ s: k.start_sec - frame, e: k.end_sec + frame }))
    .filter((c) => Math.min(c.e, range.end) - Math.max(c.s, range.start) > EPS)
    .sort((a, b) => a.s - b.s);
  if (cuts.length === 0) return { kind: 'clean' };

  const parts: Part[] = [];
  let at = range.start;
  const push = (s: number, e: number) => {
    const p = { start: s === range.start ? s : up(s), end: e === range.end ? e : down(e) };
    if (p.end - p.start >= MIN_PART_SEC - EPS) parts.push(p);
  };
  for (const c of cuts) {
    if (c.s > at) push(at, Math.min(c.s, range.end));
    at = Math.max(at, c.e);
  }
  if (at < range.end) push(at, range.end);

  const total = parts.reduce((a, p) => a + (p.end - p.start), 0);
  if (parts.length === 0 || total < MIN_TOTAL_SEC - EPS) return { kind: 'kept', reason: 'no_clean_range' };

  const cutsSentence = (t: number) => sentences.some((s) => s.start < t && t < s.end);
  const newCut = parts.some((p) => (p.start > range.start && cutsSentence(p.start)) || (p.end < range.end && cutsSentence(p.end)));
  if (newCut) return { kind: 'kept', reason: 'speech' };

  return parts.length === 1 ? { kind: 'trim', parts: [parts[0]!] } : { kind: 'split', parts };
}

export const KEPT_NOTES: Record<ShakeKeptReason | 'protected', string> = {
  no_clean_range: 'No clean range of at least 2 s around the shake',
  speech: 'Cutting out the shake would cut a sentence',
  protected: 'Protected (you changed or confirmed it)',
};
