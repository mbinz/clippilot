import { describe, it, expect } from 'vitest';
import { computeRoundMetrics } from '../../../../src/core/calibration/metrics.js';

const hl = (highlight_id: number, clip_id: number, verdicts: string[]) => ({ highlight_id, clip_id, verdicts });

describe('computeRoundMetrics', () => {
  it('computes precision and flag counts for mixed verdicts', () => {
    const m = computeRoundMetrics(
      [
        hl(1, 10, ['good']),
        hl(2, 10, ['good', 'timing']),
        hl(3, 11, ['timing', 'description']),
        hl(4, 11, ['quality']),
        hl(5, 12, []), // note only: not reviewed
      ],
      [],
      [10, 11, 12],
    );
    expect(m.reviewed_highlights).toBe(4);
    expect(m.good_only).toBe(1);
    expect(m.precision).toBe(0.25);
    expect(m.flags).toEqual({ timing: 2, description: 1, quality: 1 });
    expect(m.reviewed_clips).toBe(3);
  });

  it('counts missed moments per reviewed clip', () => {
    const m = computeRoundMetrics(
      [hl(1, 10, ['good'])],
      [{ clip_id: 10, at_sec: 3, note: '' }, { clip_id: 20, at_sec: 5, note: 'face' }],
      [10, 20],
    );
    expect(m.missed_moments).toBe(2);
    expect(m.reviewed_clips).toBe(2);
    expect(m.missed_per_clip).toBe(1);
  });

  it('aggregates score verdicts per score name', () => {
    const m = computeRoundMetrics([], [], [1, 2, 3], [
      { clip_id: 1, score: 'stability', verdict: 'high' },
      { clip_id: 2, score: 'stability', verdict: 'high' },
      { clip_id: 3, score: 'stability', verdict: 'ok' },
      { clip_id: 1, score: 'focus', verdict: 'low' },
    ]);
    expect(m.score_verdicts).toEqual({
      stability: { low: 0, ok: 1, high: 2 },
      focus: { low: 1, ok: 0, high: 0 },
    });
  });

  it('handles an empty review without dividing by zero', () => {
    const m = computeRoundMetrics([], [], []);
    expect(m.precision).toBe(0);
    expect(m.missed_per_clip).toBe(0);
    expect(m.stop_rule_met).toBe(false);
  });

  describe('stop rule', () => {
    // 5 reviewed highlights; precision 4/5 = 0.8 exactly
    const fourGoodOneBad = [
      hl(1, 1, ['good']), hl(2, 1, ['good']), hl(3, 2, ['good']), hl(4, 2, ['good']), hl(5, 3, ['timing']),
    ];
    const tenClips = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it('is met at the boundary: precision 0.8 and 3 missed over 10 clips (0.3)', () => {
      const missed = [1, 2, 3].map((c) => ({ clip_id: c, at_sec: 1, note: '' }));
      const m = computeRoundMetrics(fourGoodOneBad, missed, tenClips);
      expect(m.precision).toBe(0.8);
      expect(m.missed_per_clip).toBeCloseTo(0.3);
      expect(m.stop_rule_met).toBe(true);
    });

    it('is not met when missed per clip exceeds 0.3 (4 over 10 clips)', () => {
      const missed = [1, 2, 3, 4].map((c) => ({ clip_id: c, at_sec: 1, note: '' }));
      expect(computeRoundMetrics(fourGoodOneBad, missed, tenClips).stop_rule_met).toBe(false);
    });

    it('is not met when precision is below 0.8 (3 of 4 good)', () => {
      const m = computeRoundMetrics(
        [hl(1, 1, ['good']), hl(2, 1, ['good']), hl(3, 2, ['good']), hl(4, 2, ['quality'])], [], [1, 2]);
      expect(m.precision).toBe(0.75);
      expect(m.stop_rule_met).toBe(false);
    });
  });
});
