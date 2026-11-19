export interface HighlightVerdictInput {
  highlight_id?: number;
  clip_id: number;
  verdicts: string[];
}
export interface MissedInput {
  clip_id: number;
  at_sec: number;
  note?: string;
}
export interface ScoreVerdictInput {
  clip_id: number;
  score: string;
  verdict: 'low' | 'ok' | 'high';
}

export interface RoundMetrics {
  reviewed_highlights: number;
  good_only: number;
  precision: number;
  flags: { timing: number; description: number; quality: number; not_highlight: number };
  missed_moments: number;
  reviewed_clips: number;
  missed_per_clip: number;
  score_verdicts: Record<string, { low: number; ok: number; high: number }>;
  stop_rule_met: boolean;
}

export const STOP_PRECISION = 0.8;
export const STOP_MISSED_PER_CLIP = 0.3;

export function computeRoundMetrics(
  verdicts: HighlightVerdictInput[],
  missed: MissedInput[],
  reviewedClipIds: Iterable<number>,
  scoreVerdicts: ScoreVerdictInput[] = [],
): RoundMetrics {
  const reviewed = verdicts.filter((v) => v.verdicts.length > 0);
  const goodOnly = reviewed.filter((v) => v.verdicts.every((x) => x === 'good')).length;
  const has = (flag: string) => reviewed.filter((v) => v.verdicts.includes(flag)).length;
  const reviewedClips = new Set(reviewedClipIds).size;

  const score_verdicts: RoundMetrics['score_verdicts'] = {};
  for (const s of scoreVerdicts) {
    (score_verdicts[s.score] ??= { low: 0, ok: 0, high: 0 })[s.verdict]++;
  }

  const precision = reviewed.length ? goodOnly / reviewed.length : 0;
  const missedPerClip = reviewedClips ? missed.length / reviewedClips : 0;
  return {
    reviewed_highlights: reviewed.length,
    good_only: goodOnly,
    precision,
    flags: { timing: has('timing'), description: has('description'), quality: has('quality'), not_highlight: has('not_highlight') },
    missed_moments: missed.length,
    reviewed_clips: reviewedClips,
    missed_per_clip: missedPerClip,
    score_verdicts,
    // epsilon: 3/10 must count as exactly 0.3
    stop_rule_met:
      reviewed.length > 0 && reviewedClips > 0 &&
      precision >= STOP_PRECISION - 1e-9 && missedPerClip <= STOP_MISSED_PER_CLIP + 1e-9,
  };
}
