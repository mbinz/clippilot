/** Verdicts of the user on shake candidates, keyed `<clip file name>@<start sec>`; `end` is the candidate's end. */
export type Verdicts = Record<string, { verdict: 'yes' | 'no'; end: number }>;

export interface Detection { file: string; start: number; end: number }

export interface ShakeEval {
  judged: number;
  yes: number;
  /** Judged candidates that a detection overlaps. */
  kept: number;
  kept_yes: number;
  precision: number;
  recall: number;
  /** Detections that overlap no judged candidate (never looked at by the user). */
  unjudged: number;
}

/** Compare detected shakes with the user's verdicts (match = time overlap in the same file). */
export function evaluateShakes(detections: Detection[], verdicts: Verdicts): ShakeEval {
  const entries = Object.entries(verdicts).map(([key, v]) => {
    const at = key.lastIndexOf('@');
    return { file: key.slice(0, at), start: Number(key.slice(at + 1)), end: v.end, yes: v.verdict === 'yes' };
  });
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
  const kept = entries.filter((e) => detections.some((d) => d.file === e.file && overlaps(d, e)));
  const keptYes = kept.filter((e) => e.yes).length;
  const yes = entries.filter((e) => e.yes).length;
  const unjudged = detections.filter((d) => !entries.some((e) => e.file === d.file && overlaps(d, e))).length;
  return {
    judged: entries.length, yes, kept: kept.length, kept_yes: keptYes,
    precision: kept.length ? keptYes / kept.length : 0, recall: yes ? keptYes / yes : 0, unjudged,
  };
}
